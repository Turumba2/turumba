# High-Scale Messaging Architecture

> **Status:** Brainstorm / Architecture Proposal
> **Date:** 2026-02-16
> **Goal:** Design Turumba to handle millions of messages per day across Telegram, WhatsApp, Messenger, SMS, SMPP, Email, and future channels

---

## 1. Current State

The messaging infrastructure has solid foundations already built:

- **5 CRUD entities** — channels, messages, templates, group_messages, scheduled_messages (all implemented in `turumba_messaging_api`)
- **Transactional Outbox pattern** — EventBus -> PostgreSQL outbox -> Outbox Worker -> RabbitMQ
- **RabbitMQ topology** — topic exchange (`messaging`), DLX/DLQ, queues for `group_message_processing` and `scheduled_message_processing`
- **Channel data model** — per-type JSONB credentials, rate limits, retry config, status tracking

### The Critical Missing Piece

Nothing actually **dispatches** a message to Telegram, WhatsApp, SMS, etc. The entire dispatch pipeline — the part that turns a `Message` record into an actual delivered message on a real platform — doesn't exist yet. The RabbitMQ consumers are marked as "future" in the current docs.

---

## 2. The Scale Challenge

### Throughput Math

| Metric | Value |
|--------|-------|
| **1M messages/day** | ~42K msg/hour, ~700 msg/min, **~12 msg/sec average** |
| **Peak (10x burst)** | **~120 msg/sec** |
| **Group message spike** | 100K-500K messages enqueued in minutes |
| **1 year of data** | **365M rows** in the `messages` table |

Average throughput is manageable, but **burstiness** is the real challenge. A single group message to 100K contacts creates a massive spike that must be absorbed by the queue and dispatched within rate limits.

---

## 3. Architecture Overview

### Five Major Components

```
┌──────────────────────────────────────────────────────────────────┐
│                      Turumba Messaging Platform                   │
│                                                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────────────┐  │
│  │ Messaging   │    │ Webhook     │    │ KrakenD Gateway      │  │
│  │ API (REST)  │    │ Receiver    │    │                      │  │
│  └──────┬──────┘    └──────┬──────┘    └──────────────────────┘  │
│         │                  │                                      │
│         ▼                  ▼                                      │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                     RabbitMQ                               │   │
│  │  ┌──────────────────────────────────────────────────────┐ │   │
│  │  │  Exchange: messaging (topic, durable)                │ │   │
│  │  └──────────────────────┬───────────────────────────────┘ │   │
│  │                         │                                  │   │
│  │  ┌─────────┬────────┬───┴────┬─────────┬────────┬──────┐ │   │
│  │  │ group   │schedule│dispatch│dispatch │dispatch│status│ │   │
│  │  │ _msg    │_msg    │.sms    │.telegram│.whats  │.upd  │ │   │
│  │  │ _proc   │_proc   │        │         │app     │ate   │ │   │
│  │  └─────────┴────────┴────────┴─────────┴────────┴──────┘ │   │
│  └───────────────────────────────────────────────────────────┘   │
│         │                                                         │
│         ▼                                                         │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                    Worker Layer                             │   │
│  │                                                            │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │   │
│  │  │ Group Msg│ │ Schedule │ │ Dispatch │ │ Status Update│ │   │
│  │  │ Processor│ │ Trigger  │ │ Workers  │ │ Worker       │ │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │   │
│  └───────────────────────────────────────────────────────────┘   │
│         │                                                         │
│         ▼                                                         │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                Channel Adapter Layer                        │   │
│  │                                                            │   │
│  │  ┌──────┐ ┌────────┐ ┌────────┐ ┌─────┐ ┌─────┐ ┌─────┐ │   │
│  │  │ SMS  │ │Telegram│ │WhatsApp│ │SMPP │ │Msngr│ │Email│ │   │
│  │  └──┬───┘ └───┬────┘ └───┬────┘ └──┬──┘ └──┬──┘ └──┬──┘ │   │
│  └─────┼─────────┼──────────┼─────────┼───────┼───────┼─────┘   │
│        ▼         ▼          ▼         ▼       ▼       ▼          │
│    Twilio    Telegram   WhatsApp    SMSC   Facebook  SMTP       │
│    Vonage    Bot API    Cloud API          Graph API  Server    │
│    AT, etc.                                                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Component 1: Channel Adapter Layer

The core of the dispatch system — a **pluggable adapter per channel type** that knows how to talk to each provider's API.

### Directory Structure

```
src/adapters/
├── base.py                    # Abstract ChannelAdapter interface
├── registry.py                # Adapter registry (channel_type -> adapter class)
├── sms/
│   ├── __init__.py
│   ├── twilio.py              # Twilio SMS adapter
│   ├── africas_talking.py     # Africa's Talking adapter
│   └── vonage.py              # Vonage adapter
├── smpp/
│   └── smpp_adapter.py        # SMPP protocol adapter (persistent TCP)
├── telegram/
│   └── telegram_adapter.py    # Telegram Bot API adapter
├── whatsapp/
│   └── whatsapp_adapter.py    # WhatsApp Cloud API adapter
├── messenger/
│   └── messenger_adapter.py   # Facebook Messenger adapter
└── email/
    └── smtp_adapter.py        # SMTP email adapter
```

### Adapter Interface

Every adapter implements a common interface:

```python
class ChannelAdapter(ABC):
    """Base interface for all channel adapters."""

    @abstractmethod
    async def send(self, message: DispatchPayload) -> DispatchResult:
        """Send a single message through this channel.
        Returns DispatchResult with provider_message_id, status, metadata."""

    @abstractmethod
    async def verify_credentials(self, credentials: dict) -> bool:
        """Test that the provided credentials are valid."""

    @abstractmethod
    async def check_health(self) -> ChannelHealth:
        """Check the current health/connectivity of this channel."""

    @abstractmethod
    def parse_webhook(self, request: WebhookPayload) -> InboundMessage | StatusUpdate:
        """Parse an incoming webhook from this provider."""
```

### Data Types

```python
@dataclass
class DispatchPayload:
    message_id: UUID
    channel_id: UUID
    channel_type: str
    credentials: dict          # Decrypted channel credentials
    delivery_address: str      # Phone number, username, chat_id, email
    message_body: str          # Rendered message content
    metadata: dict             # Channel-specific options (e.g., parse_mode for Telegram)

@dataclass
class DispatchResult:
    success: bool
    provider_message_id: str | None    # e.g., Telegram message_id, Twilio SID
    status: str                        # "sent", "failed", "rate_limited"
    error_code: str | None
    error_message: str | None
    metadata: dict                     # Provider-specific response data

@dataclass
class ChannelHealth:
    status: str                # "connected", "disconnected", "error"
    latency_ms: int | None
    error_message: str | None
```

### Why Per-Provider Adapters

Each provider has wildly different APIs, rate limit behaviors, error codes, and webhook formats:

| Provider | Auth | Send API | Rate Limits | Webhooks |
|----------|------|----------|-------------|----------|
| **Twilio** | Account SID + Auth Token | REST POST | 100 msg/sec per account | HTTP callback per message |
| **Telegram** | Bot Token | HTTP POST `/sendMessage` | 30 msg/sec to different chats | Webhook or long polling |
| **WhatsApp** | Access Token | Graph API POST | Varies by tier (250-100K/day) | Webhook with HMAC signature |
| **SMPP** | System ID + Password | PDU over TCP | Negotiated per bind | Delivery receipts via PDU |
| **Messenger** | Page Token | Graph API POST | 200 calls/hour per page | Webhook with app secret |
| **Email** | SMTP credentials | SMTP SEND | Provider-dependent | Bounce notifications |

Abstraction at the adapter level keeps the dispatch workers clean and channel-agnostic.

### Adapter Registry

```python
# src/adapters/registry.py
ADAPTER_REGISTRY: dict[str, dict[str, type[ChannelAdapter]]] = {
    "sms": {
        "twilio": TwilioAdapter,
        "africas_talking": AfricasTalkingAdapter,
        "vonage": VonageAdapter,
    },
    "telegram": {
        "default": TelegramAdapter,
    },
    "whatsapp": {
        "default": WhatsAppAdapter,
    },
    "smpp": {
        "default": SMPPAdapter,
    },
    "messenger": {
        "default": MessengerAdapter,
    },
    "email": {
        "default": SMTPAdapter,
    },
}

def get_adapter(channel_type: str, provider: str | None = None) -> ChannelAdapter:
    """Resolve the correct adapter for a channel type and optional provider."""
    adapters = ADAPTER_REGISTRY[channel_type]
    return adapters.get(provider or "default", adapters["default"])()
```

---

## 5. Component 2: Message Dispatch Pipeline

### Two-Stage Pipeline

The current architecture goes:

```
API -> EventBus -> Outbox -> Outbox Worker -> RabbitMQ -> ???
```

The `???` becomes a **two-stage pipeline**:

**Stage 1: Fan-out** (for group messages / scheduled triggers)

```
group_message.queued event
    -> Group Message Processor (consumer)
        -> Fetches contacts from Account API (paginated batches)
        -> Batch-inserts N individual Message records (status: "queued")
        -> Publishes N dispatch events to channel-specific queues
        -> Updates group_message progress counters
```

**Stage 2: Dispatch** (per-channel workers)

```
message.dispatch.{channel_type} event
    -> Channel Dispatch Worker
        -> Loads Message record + Channel credentials
        -> Checks rate limiter (Redis token bucket)
        -> Calls ChannelAdapter.send()
        -> Updates Message status (sent/failed)
        -> Handles retry on transient failure
```

### Expanded RabbitMQ Queue Topology

```
Exchange: messaging (topic, durable)
│
├── group_message_processing       ← group_message.*
│   Consumer: Group Message Processor
│
├── scheduled_message_processing   ← scheduled_message.*
│   Consumer: Schedule Trigger Service
│
├── message.dispatch.sms           ← message.dispatch.sms
│   Consumer: SMS Dispatch Worker (scalable, N instances)
│
├── message.dispatch.smpp          ← message.dispatch.smpp
│   Consumer: SMPP Dispatch Worker (persistent connections)
│
├── message.dispatch.telegram      ← message.dispatch.telegram
│   Consumer: Telegram Dispatch Worker (scalable)
│
├── message.dispatch.whatsapp      ← message.dispatch.whatsapp
│   Consumer: WhatsApp Dispatch Worker (scalable)
│
├── message.dispatch.messenger     ← message.dispatch.messenger
│   Consumer: Messenger Dispatch Worker (scalable)
│
├── message.dispatch.email         ← message.dispatch.email
│   Consumer: Email Dispatch Worker (scalable)
│
├── message.status.update          ← message.status.*
│   Consumer: Status Update Worker
│
├── webhook.inbound                ← webhook.inbound.*
│   Consumer: Inbound Message Worker
│
├── messaging.dlq                  ← (dead letters from all queues)
│   Manual investigation
│
└── messaging_audit (optional)     ← # (all events)
    Debugging and audit logging
```

### Why Per-Channel-Type Dispatch Queues

This design enables:

- **Independent scaling** — Scale SMS workers independently from Telegram workers based on demand
- **Channel isolation** — Pause or drain one channel type without affecting others
- **Channel-specific rate limiting** — Each consumer respects the specific rate limits of its channel type
- **Protocol specialization** — SMPP workers maintain persistent TCP connections while SMS workers are stateless HTTP
- **Failure isolation** — A Telegram API outage doesn't back up the SMS queue

### Dispatch Worker Implementation Pattern

```python
class DispatchWorker:
    """Generic dispatch worker that consumes from a channel-type queue."""

    def __init__(self, channel_type: str):
        self.channel_type = channel_type
        self.rate_limiter = ChannelRateLimiter(redis)
        self.credential_cache = CredentialCache(redis)

    async def process_message(self, event: DispatchEvent) -> None:
        # 1. Load message record
        message = await self.load_message(event.message_id)

        # 2. Load channel credentials (Redis cache -> DB fallback)
        channel = await self.credential_cache.get(event.channel_id)

        # 3. Check rate limit
        allowed = await self.rate_limiter.acquire(
            channel_id=str(channel.id),
            rate_limit=channel.rate_limit,
        )
        if not allowed:
            # Requeue with delay
            await self.requeue_with_delay(event, delay_seconds=5)
            return

        # 4. Get adapter and dispatch
        adapter = get_adapter(channel.channel_type, channel.provider)
        result = await adapter.send(DispatchPayload(
            message_id=message.id,
            channel_id=channel.id,
            channel_type=channel.channel_type,
            credentials=channel.credentials,
            delivery_address=message.delivery_address,
            message_body=message.message_body,
            metadata=message.metadata or {},
        ))

        # 5. Update message status
        if result.success:
            await self.update_status(message, "sent", result)
        else:
            await self.handle_failure(message, result)
```

---

## 6. Component 3: Rate Limiting & Backpressure

At millions of messages/day, rate limiting is critical — providers **will** throttle you, and exceeding limits can get accounts suspended.

### Three Levels of Rate Limiting

| Level | Where | Mechanism | Purpose |
|-------|-------|-----------|---------|
| **Per-channel instance** | Dispatch worker | Redis token bucket (channel.rate_limit) | Respect the rate_limit configured on each channel |
| **Per-provider global** | Shared Redis counter | Account-level limits (e.g., Twilio 100 msg/sec) | Avoid hitting provider account limits when multiple channels use the same provider |
| **Per-tenant quota** | API layer | Account-level daily/monthly caps | Business-level usage control (free tier vs. pro tier) |

### Redis Token Bucket Implementation

```python
class ChannelRateLimiter:
    """Per-channel rate limiter using Redis token bucket algorithm."""

    def __init__(self, redis: Redis):
        self.redis = redis

    async def acquire(self, channel_id: str, rate_limit: int) -> bool:
        """
        Returns True if the message can be sent now.
        Returns False if the channel's rate limit has been reached.

        Uses a sliding window counter in Redis:
        - Key: rate_limit:{channel_id}
        - Value: count of messages in the current window
        - TTL: 60 seconds (rate_limit is per minute)
        """
        key = f"rate_limit:{channel_id}"
        current = await self.redis.incr(key)
        if current == 1:
            await self.redis.expire(key, 60)
        return current <= rate_limit
```

### Backpressure Strategy

When a channel hits its rate limit:

1. **Worker pauses consumption** — uses RabbitMQ `basic.nack` with `requeue=True` + short sleep
2. **Exponential backoff** — delay increases: 1s, 2s, 4s, 8s (capped at 30s)
3. **Provider 429 responses** — trigger automatic rate limit detection, temporarily reduce consumption rate
4. **Group message fan-out throttling** — the Group Message Processor can throttle the rate at which it enqueues dispatch events based on channel capacity

### Redis as New Infrastructure Dependency

Redis becomes required for:

| Use Case | Key Pattern | TTL |
|----------|-------------|-----|
| **Rate limiting** | `rate_limit:{channel_id}` | 60s |
| **Credential caching** | `channel_creds:{channel_id}` | 5 min |
| **Group message progress** | `gm_progress:{group_message_id}` | 24h |
| **Dispatch deduplication** | `dispatch_lock:{message_id}` | 5 min |
| **Channel health** | `channel_health:{channel_id}` | 30s |

---

## 7. Component 4: Webhook Receiver

Every messaging platform pushes events back via webhooks — both inbound messages and delivery status updates.

### Webhook Flow

```
External Provider                  Turumba
─────────────────                  ───────
Telegram       ──webhook──>  POST /webhooks/telegram/{channel_id}
WhatsApp       ──webhook──>  POST /webhooks/whatsapp/{channel_id}
Twilio (SMS)   ──webhook──>  POST /webhooks/sms/{channel_id}
Messenger      ──webhook──>  POST /webhooks/messenger/{channel_id}
                                    │
                                    ▼
                           1. Verify signature (HMAC / token)
                           2. Return 200 immediately
                           3. Parse payload type:
                              ├── Inbound message -> webhook.inbound queue
                              └── Status update   -> message.status.update queue
                                    │
                                    ▼
                           Workers process asynchronously:
                           ├── Inbound Worker: Create Message(direction=inbound)
                           └── Status Worker: Update Message status + counters
```

### Webhook Route Structure

```
src/routers/webhooks/
├── __init__.py
├── telegram.py       # POST /webhooks/telegram/{channel_id}
├── whatsapp.py       # POST /webhooks/whatsapp/{channel_id}
├── sms.py            # POST /webhooks/sms/{channel_id}
├── messenger.py      # POST /webhooks/messenger/{channel_id}
└── email.py          # POST /webhooks/email/{channel_id} (bounce notifications)
```

### Critical Webhook Requirements

| Requirement | Why | How |
|-------------|-----|-----|
| **Respond within 1-2 seconds** | Providers retry on timeout, creating duplicates | Enqueue to RabbitMQ immediately, process async |
| **Signature verification** | Prevent spoofed webhooks | Each provider has its own HMAC scheme (Telegram: secret_token, WhatsApp: x-hub-signature-256, Twilio: X-Twilio-Signature) |
| **Idempotency** | Providers retry on failure | Deduplicate by provider message ID using Redis |
| **Channel routing** | Identify which tenant owns the webhook | `{channel_id}` in the URL maps to a specific channel record with its `account_id` |
| **No auth required** | Webhooks come from external providers, not authenticated users | Signature verification replaces JWT auth |

### Webhook Registration

When a channel is created or updated, the system must register/update the webhook URL with the provider:

| Provider | Registration Method |
|----------|-------------------|
| **Telegram** | `POST /setWebhook` with URL + secret_token |
| **WhatsApp** | Configure in Meta Business Manager (manual or API) |
| **Twilio** | Set webhook URL in Twilio console or via API |
| **Messenger** | Configure in Facebook App Dashboard + verify token |

This can be handled in the Channel creation/update flow — after saving the channel record, call the provider's API to register the webhook URL.

### Deployment Decision

Webhook routes should **live in the Messaging API** (they need access to the same database and RabbitMQ), but they should be designed to run as **a separate process/deployment** if webhook traffic becomes high:

```bash
# Normal: webhooks are part of the main API
uvicorn src.main:app --reload

# Scaled: webhooks run as a separate process
uvicorn src.main:app --reload --root-path /webhooks
```

---

## 8. Component 5: SMPP Gateway

SMPP (Short Message Peer-to-Peer) is fundamentally different from REST-based channels. It uses **persistent TCP connections** to telecom SMS Centers (SMSCs). This requires special handling.

### Why SMPP Is Different

| Aspect | REST-based (Twilio, Telegram) | SMPP |
|--------|-------------------------------|------|
| **Connection** | Stateless HTTP per request | Persistent TCP bind |
| **Authentication** | API key in header | System ID + Password in bind PDU |
| **Send** | HTTP POST | submit_sm PDU |
| **Delivery receipt** | HTTP webhook callback | deliver_sm PDU on same connection |
| **Keep-alive** | Not needed | enquire_link every 30-60s |
| **Connection loss** | Irrelevant (stateless) | Must detect + rebind |

### SMPP Gateway Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  SMPP Gateway Service                      │
│                                                            │
│  ┌────────────────────┐  ┌────────────────────┐          │
│  │  SMPP Connection 1 │  │  SMPP Connection 2 │  ...     │
│  │  (Channel A)       │  │  (Channel B)       │          │
│  │  Transceiver bind  │  │  Transceiver bind  │          │
│  └─────────┬──────────┘  └─────────┬──────────┘          │
│            │                        │                      │
│       SMSC (Telecom 1)         SMSC (Telecom 2)          │
│                                                            │
│  Consumes: message.dispatch.smpp queue                    │
│  Publishes: message.status.update (delivery receipts)     │
│  Manages: persistent TCP connections per channel          │
│  Handles: enquire_link keepalive                          │
│  Handles: delivery receipts (deliver_sm PDU)              │
└──────────────────────────────────────────────────────────┘
```

### Implementation Options

| Option | Pros | Cons |
|--------|------|------|
| **1. Python (aiosmpplib)** | Fits existing stack, full control | Must handle connection management, keepalive, rebind |
| **2. Jasmin SMPP Gateway** | Battle-tested, HTTP API, connection management built-in | Additional service to deploy, less control |
| **3. Start with Jasmin, migrate to Python later** | Fast time-to-market, can replace when needed | Temporary dependency |

**Recommendation:** Start with **Option 2 (Jasmin)** for teams without SMPP experience. Jasmin handles the hard parts (connection management, DLR tracking, throttling) and exposes an HTTP API that dispatch workers can call like any other REST adapter. Replace with a custom Python service later if needed for deeper control.

---

## 9. Database Strategy at Scale

### The Messages Table Problem

At 1M messages/day:

| Timeframe | Row Count |
|-----------|-----------|
| 1 month | 30M rows |
| 6 months | 180M rows |
| 1 year | 365M rows |

Query performance degrades significantly beyond 50-100M rows without partitioning.

### Table Partitioning by Month

```sql
-- Partition messages table by created_at
CREATE TABLE messages (
    id UUID NOT NULL,
    account_id UUID NOT NULL,
    channel_id UUID,
    status VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    -- ... other columns
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions (auto-create via pg_partman or Alembic migration)
CREATE TABLE messages_2026_01 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE messages_2026_02 PARTITION OF messages
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... auto-generated for future months
```

### Indexing Strategy

```sql
-- Most common queries
CREATE INDEX idx_messages_account_created ON messages (account_id, created_at DESC);
CREATE INDEX idx_messages_account_status ON messages (account_id, status);
CREATE INDEX idx_messages_group_message ON messages (group_message_id) WHERE group_message_id IS NOT NULL;
CREATE INDEX idx_messages_channel_status ON messages (channel_id, status);

-- Outbox (stays small due to cleanup)
CREATE INDEX idx_outbox_pending ON outbox_events (status, created_at) WHERE status = 'pending';
```

### Read/Write Separation

```
                      ┌──────────────┐
                      │  Application  │
                      └──────┬───────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
            ┌──────▼──────┐    ┌───────▼───────┐
            │  Primary DB  │    │  Read Replica  │
            │  (writes)    │───>│  (reads)       │
            │              │    │                │
            │ - INSERT msg │    │ - List queries │
            │ - UPDATE     │    │ - Search       │
            │   status     │    │ - Analytics    │
            │ - Outbox     │    │ - Exports      │
            └──────────────┘    └────────────────┘
```

- **Write path** (dispatch workers, status updates) -> Primary
- **Read path** (API list endpoints, dashboard queries, exports) -> Read Replica
- **Replication lag tolerance:** 1-5 seconds is acceptable for list views

### Archive Strategy

- **Hot data** (last 3 months): PostgreSQL primary + replica
- **Warm data** (3-12 months): PostgreSQL with compressed partitions
- **Cold data** (12+ months): Detach old partitions, export to S3 as Parquet files
- **Queryable archive**: Use pg_partman to automate partition management

---

## 10. Full Message Lifecycle (End to End)

### Single Message Send

```
1. User clicks "Send Message" in Turumba Web
       │
       ▼
2. POST /v1/messages/ { channel_id, contact_id, message_body, delivery_address }
       │
       ▼
3. Messaging API:
   ├── Creates Message record (status: "queued")
   ├── EventBus emits message.dispatch.{channel_type}
   ├── OutboxMiddleware flushes to outbox_events table
   ├── db.commit() — ATOMIC: Message + OutboxEvent
   └── pg_notify('outbox_channel')
       │
       ▼
4. Outbox Worker:
   ├── Reads pending event
   ├── Publishes to RabbitMQ (routing_key: message.dispatch.telegram)
   └── Marks as published
       │
       ▼
5. Telegram Dispatch Worker:
   ├── Consumes from message.dispatch.telegram queue
   ├── Loads Message record + Channel credentials (Redis cache)
   ├── Checks rate limiter (Redis token bucket)
   ├── Calls TelegramAdapter.send()
   │   └── HTTP POST to api.telegram.org/bot{token}/sendMessage
   ├── On success: Update Message status -> "sent", set sent_at
   └── On failure: Retry with backoff or mark as "failed"
       │
       ▼
6. Telegram sends delivery update via webhook:
   POST /webhooks/telegram/{channel_id}
       │
       ▼
7. Webhook Receiver:
   ├── Verify webhook signature
   ├── Return 200 immediately
   └── Enqueue to message.status.update queue
       │
       ▼
8. Status Update Worker:
   └── Update Message: status -> "delivered", set delivered_at
```

### Group Message Send (100K contacts)

```
1. User clicks "Send to Group" in Turumba Web
       │
       ▼
2. POST /v1/group-messages/ { status: "queued", channel_id, template_id, contact_group_ids }
       │
       ▼
3. Messaging API:
   ├── Creates GroupMessage record (status: "queued")
   ├── EventBus emits group_message.queued
   ├── OutboxMiddleware flushes to outbox_events table
   ├── db.commit() — ATOMIC: GroupMessage + OutboxEvent
   └── pg_notify('outbox_channel')
       │
       ▼
4. Outbox Worker -> RabbitMQ (routing_key: group_message.queued)
       │
       ▼
5. Group Message Processor (consumer):
   ├── Fetches GroupMessage record
   ├── Loads Template record
   ├── Calls Account API: GET /v1/contacts/?filter=group_id:in:{ids}
   │   (paginated, 1000 contacts per batch)
   │
   ├── For each batch of 1000 contacts:
   │   ├── Render template per contact (variable substitution)
   │   ├── Deduplicate contacts (skip if already processed)
   │   ├── Batch-INSERT 1000 Message records (status: "queued")
   │   ├── Publish 1000 dispatch events to message.dispatch.{channel_type}
   │   └── Update GroupMessage counters: pending_count += 1000
   │
   ├── Update GroupMessage status -> "processing"
   └── After all batches: Update GroupMessage status -> "completed" (or "partially_failed")
       │
       ▼
6. Channel Dispatch Workers process individual messages (same as single message, step 5-8 above)
       │
       ▼
7. As each message is delivered/failed:
   └── Status Update Worker also updates GroupMessage aggregate counters:
       delivered_count += 1  OR  failed_count += 1
```

---

## 11. Service Topology

### Docker Compose / Kubernetes Deployment

```
┌────────────────────────────────────────────────────────────────┐
│                     Production Deployment                       │
│                                                                 │
│  API Layer                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Messaging API│  │ Messaging API│  │ Account API          │ │
│  │ Instance 1   │  │ Instance 2   │  │                      │ │
│  │ (REST + WH)  │  │ (REST + WH)  │  │                      │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                 │
│  Processing Layer                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Outbox Worker│  │ Group Msg    │  │ Schedule Trigger     │ │
│  │              │  │ Processor    │  │ Service              │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                 │
│  Dispatch Layer (independently scalable per channel type)       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ SMS Dispatch │  │ Telegram     │  │ WhatsApp Dispatch    │ │
│  │ Worker (x3)  │  │ Dispatch (x2)│  │ Worker (x2)         │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │ Email Dispatch│  │ Messenger   │  │ SMPP Gateway         │ │
│  │ Worker       │  │ Worker      │  │ (Jasmin or custom)   │ │
│  └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                 │
│  Status Layer                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Status Update Worker (processes delivery receipts)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Infrastructure                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │PostgreSQL│ │ PG Read  │ │ RabbitMQ │ │ Redis            │  │
│  │ Primary  │ │ Replica  │ │ Cluster  │ │ (rate limit +    │  │
│  │          │ │          │ │          │ │  cache)           │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │
│                                                                 │
│  Gateway                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ KrakenD Gateway (port 8080)                               │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Worker Entry Points

All workers live in the `turumba_messaging_api` repo as separate entry points sharing models, adapters, and config:

```bash
# Outbox worker (already exists)
python -m src.workers.outbox_worker

# Group message processor
python -m src.workers.group_message_processor

# Schedule trigger service
python -m src.workers.schedule_trigger

# Dispatch workers (one per channel type, scalable)
python -m src.workers.dispatch_worker --channel-type sms
python -m src.workers.dispatch_worker --channel-type telegram
python -m src.workers.dispatch_worker --channel-type whatsapp
python -m src.workers.dispatch_worker --channel-type messenger
python -m src.workers.dispatch_worker --channel-type email

# Status update worker
python -m src.workers.status_update_worker
```

---

## 12. New Infrastructure Dependencies

| Dependency | Purpose | Priority | Already Have? |
|------------|---------|----------|---------------|
| **RabbitMQ** | Message broker, event routing | P0 | Yes (configured) |
| **Redis** | Rate limiting, credential caching, progress counters, dedup locks | P1 | **No — NEW** |
| **SMPP proxy (Jasmin)** | SMPP protocol handling for direct telco connections | P2 | **No — NEW** (only if SMPP needed early) |
| **PostgreSQL read replica** | Read scaling for list/search queries | P3 | **No — later** |
| **S3 / MinIO** | Media attachments (images, documents in messages) | P2 | **No — NEW** |

---

## 13. Key Architectural Decisions

### Decision 1: How does the Group Message Processor get contacts?

Contacts live in the Account API (separate service). Options:

| Option | Pros | Cons |
|--------|------|------|
| **A. HTTP call to Account API** | Clean service boundary, no shared DB | Slow for 100K contacts (paginated), network dependency |
| **B. Direct DB access** | Fast, single query | Breaks microservice boundary, tight coupling |
| **C. Event-based contact sync** | Messaging API has its own read model, fast queries | Complexity, eventual consistency, data duplication |

**Recommendation:** Start with **Option A (HTTP)** using paginated batch fetches (1000 per request). The Account API already supports efficient filtered list queries. Migrate to Option C only if HTTP latency becomes a bottleneck at very high scale.

### Decision 2: Webhook receiver — same service or separate?

| Option | Pros | Cons |
|--------|------|------|
| **Same Messaging API process** | Simpler deployment, shared DB access | Webhook traffic competes with API traffic |
| **Separate deployment** | Independent scaling, isolation | Additional service to manage |

**Recommendation:** Start **same service** (webhook routes in the Messaging API). Split into a separate deployment later if webhook traffic becomes high enough to affect API latency.

### Decision 3: Where do channel credentials get decrypted?

| Option | Pros | Cons |
|--------|------|------|
| **DB read per dispatch** | Always fresh | Slow at scale (1 query per message) |
| **Redis cache with TTL** | Fast, reduces DB load | Stale for up to TTL after credential update |
| **In-memory cache per worker** | Fastest | Stale until worker restart |

**Recommendation:** **Redis cache with 5-minute TTL**, with a cache-invalidation event published when credentials are updated. Workers check Redis first, fall back to DB on miss.

### Decision 4: Monorepo workers or separate services?

**Recommendation:** Keep all workers in the `turumba_messaging_api` repo as separate entry points. They share:
- Database models (`src/models/`)
- Channel adapters (`src/adapters/`)
- Configuration (`src/config/`)
- Event types (`src/events/`)

This avoids code duplication while allowing independent scaling via separate process deployments.

---

## 14. Implementation Priority

### P0 — Prove the dispatch pattern end-to-end

| Component | Description |
|-----------|-------------|
| Channel Adapter interface + Telegram adapter | First real adapter, prove the abstraction |
| Dispatch Worker (generic, channel-type routed) | The core runtime loop |
| Group Message Processor | Fan-out is the main scale challenge |
| Expanded RabbitMQ topology | Add dispatch queues per channel type |

### P1 — Close the loop + second channel

| Component | Description |
|-----------|-------------|
| Webhook receiver (Telegram) | Receive inbound messages and delivery status |
| SMS adapter (Twilio) | Second channel type validates the adapter abstraction |
| Redis + rate limiter | Required before any real traffic |
| Status Update Worker | Track delivery confirmations |
| Credential caching | Avoid DB hit per dispatch |

### P2 — Additional channels + scheduling

| Component | Description |
|-----------|-------------|
| WhatsApp adapter | Third channel, template approval logic |
| Schedule Trigger Service | Cron-like worker for scheduled messages |
| SMPP gateway (Jasmin integration) | For high-volume SMS via direct telco connections |
| Messenger adapter | Facebook Messenger support |
| Email adapter (SMTP) | Email dispatch + bounce handling |

### P3 — Scale infrastructure

| Component | Description |
|-----------|-------------|
| Table partitioning (messages) | When approaching 10M+ rows |
| PostgreSQL read replica | When read queries start competing with writes |
| Archive strategy | Cold storage for messages older than 12 months |
| Account-level quotas | Tenant usage caps for billing/fair use |
| Observability (metrics, tracing) | Prometheus, OpenTelemetry, alerting |

---

## 15. Observability & Monitoring

### Key Metrics to Track

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Messages dispatched/sec (per channel type) | Dispatch workers | < expected baseline |
| Queue depth (per queue) | RabbitMQ | > 10K for dispatch queues |
| Dispatch latency (p50, p95, p99) | Dispatch workers | p95 > 5s |
| Failure rate (per channel type) | Status update worker | > 5% |
| Rate limit hits (per channel) | Redis | Sustained for > 5 min |
| Group message fan-out time | Group message processor | > 10 min for 100K contacts |
| Outbox lag (pending events) | Outbox worker | > 100 pending |
| Webhook response time | Webhook receiver | p95 > 500ms |

### Distributed Tracing

Every message should carry a `trace_id` from creation through dispatch:

```
API Request (trace_id: abc-123)
  -> Message created (trace_id in metadata)
    -> Outbox event (trace_id in payload)
      -> RabbitMQ message (trace_id in header)
        -> Dispatch worker (logs with trace_id)
          -> Provider API call (trace_id in custom header if supported)
```

This enables tracking a single message through the entire pipeline for debugging.

---

## Related Documentation

- **Current messaging spec:** [Turumba Messaging](./TURUMBA_MESSAGING.md)
- **Delivery channels spec:** [Turumba Delivery Channels](./TURUMBA_DELIVERY_CHANNELS.md)
- **Platform overview:** [What is Turumba?](./WHAT_IS_TURUMBA.md)
- **Event infrastructure:** [Event Infrastructure](./TURUMBA_MESSAGING.md#5-event-infrastructure) (section in messaging doc)
- **Roadmap:** [Roadmap](../ROADMAP.md)
