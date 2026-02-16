# HSM-005: Additional Channel Adapters & Scale Infrastructure

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P2-P3
**Feature Area:** High-Scale Messaging — Channel Adapters + Scale
**Architecture Reference:** [High-Scale Messaging Architecture](../../HIGH_SCALE_MESSAGING_ARCHITECTURE.md)

---

## Summary

Implement the remaining channel adapters (SMS/Twilio, WhatsApp, Messenger, Email, SMPP) and the scale infrastructure (database partitioning, observability) needed to handle millions of messages per day in production.

Each adapter follows the same `ChannelAdapter` interface established in HSM-001. The scale infrastructure prepares the database and monitoring for high-volume traffic.

**Scope:**
- SMS adapter (Twilio as first provider)
- WhatsApp Cloud API adapter
- Facebook Messenger adapter
- Email SMTP adapter
- SMPP gateway integration
- Database partitioning for the messages table
- Observability: metrics, distributed tracing, alerting

---

## Part 1: SMS Adapter (Twilio)

### File: `src/adapters/sms/twilio.py`

**Provider API:** Twilio REST API

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Send SMS | POST | `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` |
| Get message status | GET | `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages/{sid}.json` |

**Credentials:** `{ "provider": "twilio", "api_key": "...", "api_secret": "...", "sender_number": "+1234567890" }`

**Rate Limits:** 100 messages/second per account (default), configurable.

```python
@register_adapter("sms", "twilio")
class TwilioAdapter(ChannelAdapter):
    async def send(self, payload: DispatchPayload) -> DispatchResult:
        # POST to Twilio Messages API
        # Auth: Basic auth with api_key:api_secret
        # Body: { To, From, Body }
        # Returns: { sid, status }

    async def verify_credentials(self, credentials: dict) -> bool:
        # GET /2010-04-01/Accounts/{sid}.json

    def parse_inbound(self, raw_payload: dict) -> InboundMessage | None:
        # Parse Twilio form-encoded webhook (From, Body, MessageSid)

    def parse_status_update(self, raw_payload: dict) -> StatusUpdate | None:
        # Parse MessageStatus: queued, sent, delivered, undelivered, failed

    def verify_webhook_signature(self, headers, body, secret) -> bool:
        # Twilio X-Twilio-Signature: HMAC-SHA1(url + sorted_params, auth_token)
```

### Tasks — SMS
- [ ] Create `src/adapters/sms/__init__.py`
- [ ] Create `src/adapters/sms/twilio.py` — `TwilioAdapter`
- [ ] `send()` — POST to Twilio Messages API with Basic auth
- [ ] `verify_credentials()` — GET account info
- [ ] `parse_inbound()` — parse form-encoded Twilio webhook
- [ ] `parse_status_update()` — parse MessageStatus callback
- [ ] `verify_webhook_signature()` — HMAC-SHA1 validation
- [ ] Register as `("sms", "twilio")`
- [ ] Tests with mocked HTTP responses

---

## Part 2: WhatsApp Adapter

### File: `src/adapters/whatsapp/whatsapp_adapter.py`

**Provider API:** WhatsApp Cloud API (Meta Graph API v18.0+)

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Send message | POST | `https://graph.facebook.com/v18.0/{phone_number_id}/messages` |
| Send template | POST | Same endpoint with template payload |

**Credentials:** `{ "access_token": "...", "phone_number_id": "...", "business_account_id": "..." }`

**Key WhatsApp rules:**
- 24-hour messaging window: free-form messages only within 24h of last customer message
- Template messages required to initiate conversations (pre-approved by Meta)
- Rate limits vary by tier: 250, 1K, 10K, 100K messages/day

```python
@register_adapter("whatsapp")
class WhatsAppAdapter(ChannelAdapter):
    async def send(self, payload: DispatchPayload) -> DispatchResult:
        # POST to Graph API /messages
        # Auth: Bearer token
        # Handle template messages vs free-form
        # WhatsApp requires E.164 phone format

    def parse_inbound(self, raw_payload: dict) -> InboundMessage | None:
        # entry[].changes[].value.messages[]

    def parse_status_update(self, raw_payload: dict) -> StatusUpdate | None:
        # entry[].changes[].value.statuses[] → sent, delivered, read, failed

    def verify_webhook_signature(self, headers, body, secret) -> bool:
        # X-Hub-Signature-256: HMAC-SHA256(body, app_secret)
```

### Tasks — WhatsApp
- [ ] Create `src/adapters/whatsapp/__init__.py`
- [ ] Create `src/adapters/whatsapp/whatsapp_adapter.py`
- [ ] `send()` — text messages and template messages via Graph API
- [ ] Handle 24-hour window logic (template vs free-form)
- [ ] `parse_inbound()` — extract messages from webhook notification
- [ ] `parse_status_update()` — extract statuses (sent, delivered, read, failed)
- [ ] `verify_webhook_signature()` — HMAC-SHA256 with app secret
- [ ] Register as `("whatsapp", "default")`
- [ ] Tests with mocked HTTP responses

---

## Part 3: Messenger Adapter

### File: `src/adapters/messenger/messenger_adapter.py`

**Provider API:** Facebook Graph API — Send API

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Send message | POST | `https://graph.facebook.com/v18.0/me/messages` |

**Credentials:** `{ "page_access_token": "...", "page_id": "...", "app_secret": "..." }`

```python
@register_adapter("messenger")
class MessengerAdapter(ChannelAdapter):
    async def send(self, payload: DispatchPayload) -> DispatchResult:
        # POST /me/messages with recipient.id and message.text
        # Auth: page_access_token query param

    def parse_inbound(self, raw_payload: dict) -> InboundMessage | None:
        # entry[].messaging[].message

    def parse_status_update(self, raw_payload: dict) -> StatusUpdate | None:
        # entry[].messaging[].delivery

    def verify_webhook_signature(self, headers, body, secret) -> bool:
        # X-Hub-Signature-256: HMAC-SHA256(body, app_secret)
```

### Tasks — Messenger
- [ ] Create `src/adapters/messenger/__init__.py`
- [ ] Create `src/adapters/messenger/messenger_adapter.py`
- [ ] `send()` — POST to Send API
- [ ] `parse_inbound()`, `parse_status_update()`, `verify_webhook_signature()`
- [ ] Register as `("messenger", "default")`
- [ ] Tests with mocked responses

---

## Part 4: Email Adapter (SMTP)

### File: `src/adapters/email/smtp_adapter.py`

Uses Python's `aiosmtplib` for async SMTP.

**Credentials:** `{ "smtp_host": "...", "smtp_port": 587, "smtp_username": "...", "smtp_password": "...", "from_name": "...", "reply_to": "..." }`

```python
@register_adapter("email")
class SMTPAdapter(ChannelAdapter):
    async def send(self, payload: DispatchPayload) -> DispatchResult:
        # Connect to SMTP, send email
        # delivery_address = recipient email
        # message_body = email body (HTML or plain text)
        # metadata may contain: subject, is_html

    async def verify_credentials(self, credentials: dict) -> bool:
        # SMTP connect + login test

    def parse_inbound(self, raw_payload: dict) -> InboundMessage | None:
        # Email inbound handled via IMAP polling (separate), not webhooks
        return None

    def parse_status_update(self, raw_payload: dict) -> StatusUpdate | None:
        # Parse bounce/complaint notifications (SES SNS, SendGrid webhooks)
```

### Tasks — Email
- [ ] Add `aiosmtplib` to `requirements.txt`
- [ ] Create `src/adapters/email/__init__.py`
- [ ] Create `src/adapters/email/smtp_adapter.py`
- [ ] `send()` — SMTP send with TLS
- [ ] `verify_credentials()` — SMTP login test
- [ ] Handle HTML and plain text email bodies
- [ ] Register as `("email", "default")`
- [ ] Tests with mocked SMTP

---

## Part 5: SMPP Gateway Integration

### Approach: Jasmin SMPP Gateway

SMPP uses persistent TCP connections — fundamentally different from REST. Use Jasmin as an SMPP-to-HTTP bridge initially.

**Jasmin** manages:
- Persistent SMPP binds to SMSCs
- Connection keepalive (enquire_link)
- Delivery receipt (DLR) tracking
- Exposes HTTP API for sending

### File: `src/adapters/smpp/smpp_adapter.py`

```python
@register_adapter("smpp")
class SMPPAdapter(ChannelAdapter):
    async def send(self, payload: DispatchPayload) -> DispatchResult:
        # POST to Jasmin HTTP API: /send
        # Params: to, content, from (source_addr)
        # Jasmin handles the SMPP submit_sm PDU

    async def verify_credentials(self, credentials: dict) -> bool:
        # Check Jasmin connector status via management API
```

### Docker Compose Addition

```yaml
jasmin:
  image: jookies/jasmin:latest
  platform: linux/amd64
  ports:
    - "2775:2775"   # SMPP
    - "8990:8990"   # HTTP API
    - "1401:1401"   # Management CLI
  volumes:
    - jasmin_config:/etc/jasmin
  networks:
    - gateway-network
```

### Tasks — SMPP
- [ ] Create `src/adapters/smpp/__init__.py`
- [ ] Create `src/adapters/smpp/smpp_adapter.py`
- [ ] `send()` — POST to Jasmin HTTP API
- [ ] `verify_credentials()` — check Jasmin connector status
- [ ] `parse_status_update()` — parse Jasmin DLR callbacks
- [ ] Register as `("smpp", "default")`
- [ ] Add Jasmin to Docker Compose
- [ ] Document Jasmin connector configuration

---

## Part 6: Database Partitioning

### Messages Table Partitioning

At 1M messages/day, the messages table will have 30M rows/month. Partition by `created_at`:

```sql
-- Convert to partitioned table
ALTER TABLE messages RENAME TO messages_old;

CREATE TABLE messages (
    id UUID NOT NULL,
    account_id UUID NOT NULL,
    channel_id UUID,
    status VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    -- ... all other columns
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions
CREATE TABLE messages_2026_01 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE messages_2026_02 PARTITION OF messages
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... future months auto-created
```

### Indexing Strategy

```sql
CREATE INDEX idx_messages_account_created ON messages (account_id, created_at DESC);
CREATE INDEX idx_messages_account_status ON messages (account_id, status);
CREATE INDEX idx_messages_group_message ON messages (group_message_id)
    WHERE group_message_id IS NOT NULL;
CREATE INDEX idx_messages_channel_status ON messages (channel_id, status);
CREATE INDEX idx_messages_provider_msg_id ON messages ((metadata_->>'provider_message_id'), channel_id);
```

### Partition Management

- Use `pg_partman` extension for automatic partition creation
- Or: Alembic migration to create partitions 3 months ahead
- Periodic job: detach partitions older than 12 months, export to S3

### Tasks — Database
- [ ] Create Alembic migration to partition the messages table
- [ ] Create partitions for current month + 3 months ahead
- [ ] Add optimized indexes (account+created, account+status, provider_msg_id)
- [ ] Document partition management process (monthly creation, annual archival)
- [ ] Test: queries with partitioned table perform correctly
- [ ] Test: SQLAlchemy ORM works transparently with partitioned table

---

## Part 7: Observability & Monitoring

### Metrics (Prometheus-Compatible)

Key metrics to expose:

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `turumba_messages_dispatched_total` | Counter | channel_type, status | Dispatch worker |
| `turumba_dispatch_duration_seconds` | Histogram | channel_type | Dispatch worker |
| `turumba_dispatch_queue_depth` | Gauge | channel_type | RabbitMQ monitoring |
| `turumba_dispatch_failure_rate` | Gauge | channel_type | Dispatch worker |
| `turumba_rate_limit_hits_total` | Counter | channel_id | Rate limiter |
| `turumba_group_message_fanout_duration` | Histogram | — | Group processor |
| `turumba_outbox_pending_count` | Gauge | — | Outbox worker |
| `turumba_webhook_response_seconds` | Histogram | channel_type | Webhook receiver |

### Distributed Tracing

Every message carries a `trace_id` through the pipeline:

```
API Request (trace_id generated) →
  Message.metadata_.trace_id →
    Outbox event payload.trace_id →
      RabbitMQ message header.trace_id →
        Dispatch worker log (trace_id) →
          Provider API call (trace_id in custom header if supported)
```

### Structured Logging

All workers should use structured JSON logging:

```python
import structlog
logger = structlog.get_logger()

logger.info("message_dispatched",
    message_id=str(message.id),
    channel_type="telegram",
    trace_id=trace_id,
    duration_ms=elapsed,
)
```

### Tasks — Observability
- [ ] Add `structlog` and `prometheus-client` to requirements
- [ ] Create `src/observability/metrics.py` — define Prometheus metrics
- [ ] Create `src/observability/tracing.py` — trace_id generation and propagation
- [ ] Add metrics endpoint to Messaging API (`GET /metrics`)
- [ ] Instrument dispatch worker with dispatch counter and duration histogram
- [ ] Instrument webhook receiver with response time histogram
- [ ] Instrument outbox worker with pending count gauge
- [ ] Add structured logging to all workers
- [ ] Document alerting rules for key thresholds

---

## Full Task Checklist

### Adapters
- [ ] SMS/Twilio adapter — send, verify, parse webhooks, signature verification
- [ ] WhatsApp adapter — send (text + template), parse inbound + status, signature
- [ ] Messenger adapter — send, parse inbound + delivery, signature
- [ ] Email/SMTP adapter — send (HTML + plain text), verify SMTP credentials
- [ ] SMPP adapter — send via Jasmin HTTP API, parse DLR callbacks
- [ ] All adapters registered in registry

### Scale Infrastructure
- [ ] Messages table partitioned by created_at (monthly)
- [ ] Optimized indexes for high-volume queries
- [ ] Partition management documented

### Observability
- [ ] Prometheus metrics for dispatch, queue depth, failures, rate limits
- [ ] Distributed tracing with trace_id propagation
- [ ] Structured JSON logging in all workers
- [ ] Metrics endpoint exposed

### Dependencies
- [ ] `aiosmtplib` added to requirements
- [ ] `structlog` and `prometheus-client` added to requirements
- [ ] Jasmin added to Docker Compose (optional, for SMPP)

### Tests
- [ ] Each adapter: send success/failure, verify credentials, parse webhooks
- [ ] Partitioned messages table: CRUD operations work transparently
- [ ] Metrics: counters increment correctly

---

## Acceptance Criteria

- [ ] All 5 adapters implement `ChannelAdapter` interface and are registered
- [ ] Messages table partitioned with monthly partitions
- [ ] Optimized indexes for account+created_at and provider_message_id lookups
- [ ] Prometheus metrics exposed at `/metrics`
- [ ] Structured logging with trace_id in all workers
- [ ] Jasmin SMPP gateway in Docker Compose
- [ ] Tests passing, Ruff clean

---

## Dependencies

- HSM-001 (Channel Adapter Framework — interface to implement)
- HSM-002 (Dispatch Pipeline — workers that use adapters)
- HSM-003 (Webhook Receivers — routes that use adapter parse methods)

## Blocks

- None (this completes the platform's channel coverage and production readiness)
