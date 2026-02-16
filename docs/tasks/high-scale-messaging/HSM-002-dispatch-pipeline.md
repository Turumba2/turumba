# HSM-002: Message Dispatch Pipeline

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P0
**Feature Area:** High-Scale Messaging — Message Dispatch Pipeline
**Architecture Reference:** [High-Scale Messaging Architecture](../../HIGH_SCALE_MESSAGING_ARCHITECTURE.md)

---

## Summary

Build the complete message dispatch pipeline: expand the RabbitMQ topology with per-channel dispatch queues, implement the generic dispatch worker that sends messages through adapters, implement the group message processor that fans out group messages into individual dispatches, and implement the schedule trigger service.

This is the core runtime that transforms Turumba from a CRUD platform into a system that actually delivers messages.

**Scope:**
- Expanded RabbitMQ topology (6 per-channel dispatch queues + status + inbound queues)
- New event types for dispatch, status, and inbound events
- Generic dispatch worker (channel-type parameterized, independently scalable)
- Group message processor (fan-out consumer)
- Schedule trigger service
- Template rendering engine

---

## Part 1: Expanded RabbitMQ Topology

### Current State (from BE-006)

```
Exchange: messaging (topic)
├── group_message_processing     ← group_message.*
├── scheduled_message_processing ← scheduled_message.*
└── messaging.dlq               ← dead letters
```

### Target State

```
Exchange: messaging (topic)
│
│  Existing
├── group_message_processing       ← group_message.*
├── scheduled_message_processing   ← scheduled_message.*
│
│  New: Per-channel dispatch
├── message.dispatch.sms           ← message.dispatch.sms
├── message.dispatch.smpp          ← message.dispatch.smpp
├── message.dispatch.telegram      ← message.dispatch.telegram
├── message.dispatch.whatsapp      ← message.dispatch.whatsapp
├── message.dispatch.messenger     ← message.dispatch.messenger
├── message.dispatch.email         ← message.dispatch.email
│
│  New: Status & inbound
├── message.status.update          ← message.status.*
├── webhook.inbound                ← webhook.inbound.*
│
│  Existing
├── messaging.dlq                  ← dead letters
└── messaging_audit (optional)     ← #
```

### New Event Types

Add to `src/events/event_types.py`:

```python
class EventType:
    # --- Existing ---
    GROUP_MESSAGE_CREATED = "group_message.created"
    GROUP_MESSAGE_QUEUED = "group_message.queued"
    GROUP_MESSAGE_CANCELLED = "group_message.cancelled"
    SCHEDULED_MESSAGE_CREATED = "scheduled_message.created"
    SCHEDULED_MESSAGE_UPDATED = "scheduled_message.updated"
    SCHEDULED_MESSAGE_CANCELLED = "scheduled_message.cancelled"
    SCHEDULED_MESSAGE_PAUSED = "scheduled_message.paused"
    SCHEDULED_MESSAGE_RESUMED = "scheduled_message.resumed"

    # --- New: Dispatch ---
    MESSAGE_DISPATCH_SMS = "message.dispatch.sms"
    MESSAGE_DISPATCH_SMPP = "message.dispatch.smpp"
    MESSAGE_DISPATCH_TELEGRAM = "message.dispatch.telegram"
    MESSAGE_DISPATCH_WHATSAPP = "message.dispatch.whatsapp"
    MESSAGE_DISPATCH_MESSENGER = "message.dispatch.messenger"
    MESSAGE_DISPATCH_EMAIL = "message.dispatch.email"

    # --- New: Status ---
    MESSAGE_STATUS_SENT = "message.status.sent"
    MESSAGE_STATUS_DELIVERED = "message.status.delivered"
    MESSAGE_STATUS_FAILED = "message.status.failed"
    MESSAGE_STATUS_READ = "message.status.read"

    # --- New: Inbound ---
    WEBHOOK_INBOUND_TELEGRAM = "webhook.inbound.telegram"
    WEBHOOK_INBOUND_WHATSAPP = "webhook.inbound.whatsapp"
    WEBHOOK_INBOUND_SMS = "webhook.inbound.sms"
    WEBHOOK_INBOUND_MESSENGER = "webhook.inbound.messenger"
    WEBHOOK_INBOUND_EMAIL = "webhook.inbound.email"

    @staticmethod
    def dispatch_event_for_channel(channel_type: str) -> str:
        return f"message.dispatch.{channel_type}"

    @staticmethod
    def inbound_event_for_channel(channel_type: str) -> str:
        return f"webhook.inbound.{channel_type}"
```

Update `src/events/rabbitmq.py` to declare all new queues in `declare_topology()`.

---

## Part 2: Dispatch Worker

### File: `src/workers/dispatch_worker.py`

A generic, channel-type parameterized worker that consumes from `message.dispatch.{channel_type}`, resolves the correct adapter, and calls `adapter.send()`.

```bash
# Run one worker per channel type (scale by running multiple instances)
python -m src.workers.dispatch_worker --channel-type telegram
python -m src.workers.dispatch_worker --channel-type sms
python -m src.workers.dispatch_worker --channel-type sms  # 2nd instance
```

### Dispatch Flow

```
1. Consume from message.dispatch.{channel_type} queue
2. Parse dispatch event payload
3. Load Message record from DB (verify status = "queued")
4. Load Channel record from DB (get credentials)
5. Resolve adapter: get_adapter(channel_type, provider)
6. Update Message status → "sending"
7. Call adapter.send(DispatchPayload)
   ├── Success → status="sent", sent_at=now(), metadata.provider_message_id
   ├── Retryable failure → requeue with retry count (exponential backoff)
   ├── Rate limit → nack + sleep(retry_after)
   ├── Auth error → mark failed (channel creds invalid)
   └── Permanent failure → status="failed", failed_at, error_details
8. If group_message_id present → update GroupMessage counters
9. ACK the RabbitMQ message
```

### Dispatch Event Payload Schema

```json
{
    "message_id": "uuid",
    "channel_id": "uuid",
    "channel_type": "telegram",
    "account_id": "uuid",
    "delivery_address": "123456789",
    "message_body": "Hello, Sarah!",
    "metadata": {},
    "media_url": null,
    "media_type": null,
    "group_message_id": "uuid-or-null",
    "retry_count": 0,
    "max_retries": 3
}
```

### Retry Logic

| Attempt | Delay | Action |
|---------|-------|--------|
| 1st failure (retryable) | 2s | Republish with retry_count=1 |
| 2nd failure | 4s | Republish with retry_count=2 |
| 3rd failure | 8s | Republish with retry_count=3 |
| 4th failure | — | Mark as "permanently_failed" |

### Group Message Counter Updates

When `group_message_id` is present in the dispatch payload:
- On sent → `UPDATE group_messages SET sent_count = sent_count + 1, pending_count = pending_count - 1`
- On failed → `UPDATE group_messages SET failed_count = failed_count + 1, pending_count = pending_count - 1`

---

## Part 3: Group Message Processor

### File: `src/workers/group_message_processor.py`

Consumes `group_message.queued` events and fans out into individual dispatch events.

### Fan-Out Flow

```
1. Consume group_message.queued from group_message_processing queue
2. Load GroupMessage record (verify status = "queued")
3. Load Template record
4. Load Channel record (for channel_type)
5. Update GroupMessage → status="processing", started_at=now()
6. Fetch contacts from Account API (paginated, 1000/batch):
   GET {ACCOUNT_API_URL}/v1/contacts/?filter=group_id:in:{ids}&limit=1000&offset=N
7. For each batch:
   a. Deduplicate (skip if contact_id already seen)
   b. Exclude contacts in exclude_contact_ids
   c. Render template per contact (variable substitution)
   d. Batch-INSERT Message records (status: "queued", direction: "outbound")
   e. Publish dispatch events to message.dispatch.{channel_type}
   f. Update GroupMessage: pending_count += batch_size
8. After all batches:
   └── Status → "completed" (or "partially_failed" / "failed")
   └── Set completed_at
```

### Contact Fetching

Contacts live in the Account API. The processor calls the Account API over HTTP:

```python
async def fetch_contacts_batch(
    account_api_url: str,
    contact_group_ids: list[str],
    offset: int,
    limit: int = 1000,
    headers: dict = None,  # Auth headers
) -> list[dict]:
    """Paginated contact fetch from Account API."""
```

**Service-to-service auth:** Store the original user's JWT in the event payload and forward it, or use a service-level token.

### Template Rendering

```python
def render_template(
    template_body: str,
    contact: dict,
    custom_values: dict | None,
    default_values: dict | None,
    fallback_strategy: str = "keep_placeholder",
) -> str | None:
    """
    Replace {VARIABLE} placeholders with contact data.

    Resolution order:
    1. custom_values (from GroupMessage, e.g., MEETING_LINK)
    2. Contact fields (first_name, last_name, email, phone)
    3. Contact metadata (custom attributes)
    4. default_values (from Template)
    5. Fallback: keep_placeholder, use_default, or skip_contact

    Returns None if fallback_strategy="skip_contact" and a variable is unresolvable.
    """
```

---

## Part 4: Schedule Trigger Service

### File: `src/workers/schedule_trigger.py`

A worker that polls for scheduled messages whose `next_trigger_at` has passed and creates the actual Message or GroupMessage records.

### Trigger Flow

```
1. Poll every 10 seconds (or pg_notify):
   SELECT * FROM scheduled_messages
   WHERE status = 'pending' AND next_trigger_at <= now()
   FOR UPDATE SKIP LOCKED
   LIMIT 50

2. For each due scheduled message:
   a. Update status → "triggered"
   b. If send_type = "single":
      - Create Message record (status: "queued")
      - Publish dispatch event to message.dispatch.{channel_type}
      - Link message_id back to scheduled_message
   c. If send_type = "group":
      - Create GroupMessage record (status: "queued")
      - Publish group_message.queued event (processed by Group Message Processor)
      - Link group_message_id back to scheduled_message
   d. If is_recurring:
      - Compute next_trigger_at from recurrence_rule
      - Update status → "pending" (ready for next trigger)
      - If recurrence_end_at passed → status = "completed"
   e. If not recurring:
      - Update status → "completed"
```

### Recurrence Computation

```python
def compute_next_trigger(
    current_trigger: datetime,
    recurrence_rule: str,    # "daily", "weekly:mon,wed,fri", "monthly:15"
    timezone: str | None,
) -> datetime:
    """Compute the next trigger time based on recurrence rule."""
```

---

## Configuration

Add to `src/config/config.py`:

```python
# Dispatch channel types
DISPATCH_CHANNEL_TYPES: list[str] = ["sms", "smpp", "telegram", "whatsapp", "messenger", "email"]

# Dispatch worker
DISPATCH_MAX_RETRIES: int = 3
DISPATCH_RETRY_BASE_DELAY: int = 2      # seconds (exponential: 2^retry_count)
DISPATCH_PREFETCH_COUNT: int = 10

# Group message processor
GROUP_MESSAGE_BATCH_SIZE: int = 1000     # contacts per batch
ACCOUNT_API_BASE_URL: str = "http://gt_turumba_account_api:8000"

# Schedule trigger
SCHEDULE_POLL_INTERVAL: int = 10         # seconds
SCHEDULE_BATCH_SIZE: int = 50
```

---

## Tasks

### Part 1: RabbitMQ Topology
- [ ] Add dispatch event types to `src/events/event_types.py`
- [ ] Add status event types and inbound event types
- [ ] Add `dispatch_event_for_channel()` and `inbound_event_for_channel()` helpers
- [ ] Update `src/events/rabbitmq.py` — declare 6 per-channel dispatch queues
- [ ] Add `message.status.update` queue bound to `message.status.*`
- [ ] Add `webhook.inbound` queue bound to `webhook.inbound.*`
- [ ] All new queues with DLX arguments

### Part 2: Dispatch Worker
- [ ] Create `src/workers/dispatch_worker.py`
- [ ] CLI with `--channel-type` argument
- [ ] Connect to RabbitMQ, consume from `message.dispatch.{channel_type}`
- [ ] Load Message + Channel from DB, resolve adapter
- [ ] Call `adapter.send()`, update Message status through lifecycle
- [ ] Retry logic with exponential backoff
- [ ] Rate limit handling (nack + sleep)
- [ ] Auth error → mark failed immediately
- [ ] Group message counter updates (sent_count, failed_count, pending_count)
- [ ] Skip stale messages (status != "queued"), skip disabled channels
- [ ] Graceful shutdown on SIGTERM/SIGINT

### Part 3: Group Message Processor
- [ ] Create `src/workers/group_message_processor.py`
- [ ] Consume `group_message.queued` from `group_message_processing` queue
- [ ] Fetch contacts from Account API (paginated HTTP calls)
- [ ] Deduplicate contacts, exclude contacts in `exclude_contact_ids`
- [ ] Implement `render_template()` with variable resolution and fallback strategies
- [ ] Batch-INSERT Message records
- [ ] Publish dispatch events to `message.dispatch.{channel_type}`
- [ ] Track progress: pending_count, total_recipients
- [ ] GroupMessage status: queued → processing → completed/partially_failed/failed
- [ ] Error handling: template not found, channel disabled, API errors

### Part 4: Schedule Trigger Service
- [ ] Create `src/workers/schedule_trigger.py`
- [ ] Poll scheduled_messages where next_trigger_at <= now()
- [ ] Single sends: create Message + publish dispatch event
- [ ] Group sends: create GroupMessage + publish group_message.queued
- [ ] Recurring: compute next_trigger_at, loop until recurrence_end_at
- [ ] Link resulting message/group_message back to scheduled_message
- [ ] Graceful shutdown

### Part 5: Tests
- [ ] RabbitMQ topology declares all expected queues with correct bindings
- [ ] Event type helpers return correct routing keys
- [ ] Dispatch worker: successful send → message status "sent"
- [ ] Dispatch worker: retryable failure → requeued with incremented retry_count
- [ ] Dispatch worker: max retries → "permanently_failed"
- [ ] Dispatch worker: rate limit → nack + sleep
- [ ] Dispatch worker: group message counters updated
- [ ] Group processor: 5 contacts → 5 Message records + 5 dispatch events
- [ ] Group processor: template rendering with variables
- [ ] Group processor: deduplication and exclusion
- [ ] Group processor: GroupMessage status transitions
- [ ] Schedule trigger: due scheduled message → creates Message + dispatch event
- [ ] Schedule trigger: recurring → computes next_trigger_at
- [ ] Schedule trigger: recurrence end → status "completed"

---

## Acceptance Criteria

- [ ] Full RabbitMQ topology with 6 dispatch queues + status + inbound
- [ ] Dispatch worker consumes, resolves adapter, sends, updates status
- [ ] Group message processor fans out to individual messages
- [ ] Template rendering with variable substitution and fallback strategies
- [ ] Schedule trigger processes due scheduled messages
- [ ] All workers have CLI entry points and graceful shutdown
- [ ] Retry logic, error handling, counter updates working
- [ ] Tests passing, Ruff clean

---

## Dependencies

- HSM-001 (Channel Adapter Framework — `get_adapter()`)
- BE-006 (Event Infrastructure — outbox + existing topology)
- BE-001 through BE-005 (all CRUD entities exist)

## Blocks

- HSM-003 (Webhook Receivers — publishes to status/inbound queues)
- HSM-004 (Redis — rate limiting integration into dispatch worker)
