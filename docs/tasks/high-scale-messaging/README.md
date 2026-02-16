# High-Scale Messaging — Task Specs

> **Architecture Reference:** [High-Scale Messaging Architecture](../../HIGH_SCALE_MESSAGING_ARCHITECTURE.md)

These 5 issues implement the dispatch pipeline that turns Turumba from a messaging CRUD platform into a system capable of sending and receiving millions of messages per day across Telegram, WhatsApp, SMS, SMPP, Messenger, and Email.

---

## Issues

| ID | Title | Priority | Depends On | Key Deliverables |
|----|-------|----------|------------|-----------------|
| [HSM-001](./HSM-001-channel-adapter-framework.md) | Channel Adapter Framework & Telegram Adapter | P0 | — | Abstract interface, data types, registry, exceptions, Telegram adapter |
| [HSM-002](./HSM-002-dispatch-pipeline.md) | Message Dispatch Pipeline | P0 | HSM-001 | RabbitMQ topology expansion, dispatch worker, group message processor, schedule trigger |
| [HSM-003](./HSM-003-webhook-receivers-status-tracking.md) | Webhook Receivers & Status Tracking | P1 | HSM-001, HSM-002 | Webhook endpoints (all channels), status update worker, inbound message worker |
| [HSM-004](./HSM-004-redis-rate-limiting-caching.md) | Redis Infrastructure, Rate Limiting & Caching | P1 | HSM-002 | Redis setup, per-channel rate limiter, credential cache, progress counters |
| [HSM-005](./HSM-005-additional-adapters-scale.md) | Additional Channel Adapters & Scale Infrastructure | P2-P3 | HSM-001, HSM-002, HSM-003 | SMS/Twilio, WhatsApp, Messenger, Email, SMPP adapters, DB partitioning, observability |

---

## Dependency Graph

```
HSM-001 (Adapter Framework + Telegram)
    │
    ├──> HSM-002 (Dispatch Pipeline)
    │        │
    │        ├──> HSM-003 (Webhooks + Status Tracking)
    │        │
    │        └──> HSM-004 (Redis + Rate Limiting)
    │
    └──> HSM-005 (Additional Adapters + Scale)
              ▲
              │
         HSM-002, HSM-003 (also required)
```

## Implementation Order

```
Phase 1 (P0):  HSM-001 → HSM-002     (prove dispatch end-to-end with Telegram)
Phase 2 (P1):  HSM-003 + HSM-004     (close the loop: webhooks + rate limiting)
Phase 3 (P2):  HSM-005               (remaining adapters + scale infrastructure)
```

---

## What Each Issue Covers

### HSM-001: Channel Adapter Framework & Telegram Adapter
- `ChannelAdapter` abstract interface (send, verify, parse, webhook signature)
- Data types: `DispatchPayload`, `DispatchResult`, `ChannelHealth`, `InboundMessage`, `StatusUpdate`
- Adapter registry with decorator-based registration
- Exception hierarchy (connection, auth, rate limit, payload errors)
- Complete Telegram Bot API adapter as the reference implementation

### HSM-002: Message Dispatch Pipeline
- Expanded RabbitMQ topology: 6 per-channel dispatch queues + status + inbound queues
- New event types for dispatch, status, and inbound
- Generic dispatch worker (channel-type parameterized, scalable)
- Group message processor (fan-out: 1 GroupMessage → N individual dispatches)
- Schedule trigger service (fires due scheduled messages)
- Template rendering engine

### HSM-003: Webhook Receivers & Status Tracking
- Webhook endpoints for Telegram, WhatsApp, SMS, Messenger, Email
- Provider-specific signature verification
- Status update worker (delivery receipts → message status updates)
- Inbound message worker (received messages → Message records)
- Webhook registration on channel creation
- GroupMessage counter updates on delivery confirmations

### HSM-004: Redis Infrastructure, Rate Limiting & Caching
- Redis as new infrastructure dependency
- Per-channel rate limiter (sliding window counter)
- Channel credential cache (TTL-based, with invalidation on update)
- Group message progress counters (Redis atomic ops for real-time tracking)
- Dispatch worker integration with rate limiter + cache
- Docker Compose Redis service

### HSM-005: Additional Channel Adapters & Scale Infrastructure
- SMS adapter (Twilio) with signature verification
- WhatsApp Cloud API adapter (text + template messages, 24h window)
- Messenger adapter (Send API)
- Email SMTP adapter (HTML + plain text)
- SMPP gateway (Jasmin integration)
- Messages table partitioning (monthly by created_at)
- Database indexing optimization
- Observability: Prometheus metrics, distributed tracing, structured logging

---

## New Infrastructure Dependencies

| Dependency | Introduced In | Purpose |
|------------|---------------|---------|
| **Redis** | HSM-004 | Rate limiting, credential caching, progress counters |
| **Jasmin** | HSM-005 | SMPP-to-HTTP bridge for direct telco connections |
| **httpx** | HSM-001 | Async HTTP client for adapter API calls |
| **aiosmtplib** | HSM-005 | Async SMTP client for email adapter |
| **structlog** | HSM-005 | Structured JSON logging |
| **prometheus-client** | HSM-005 | Metrics exposition |

---

## Worker Entry Points (after all issues complete)

```bash
# Existing
python -m src.workers.outbox_worker

# New (from HSM-002)
python -m src.workers.dispatch_worker --channel-type telegram
python -m src.workers.dispatch_worker --channel-type sms
python -m src.workers.dispatch_worker --channel-type whatsapp
python -m src.workers.dispatch_worker --channel-type messenger
python -m src.workers.dispatch_worker --channel-type email
python -m src.workers.dispatch_worker --channel-type smpp
python -m src.workers.group_message_processor
python -m src.workers.schedule_trigger

# New (from HSM-003)
python -m src.workers.status_update_worker
python -m src.workers.inbound_message_worker
```
