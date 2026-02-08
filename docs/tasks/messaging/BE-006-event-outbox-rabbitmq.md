# BE-006: Event Infrastructure — EventBus + Transactional Outbox + RabbitMQ

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** bengeos, tesfayegirma-116
**GitHub Issue:** [Turumba2/turumba_messaging_api#13](https://github.com/Turumba2/turumba_messaging_api/issues/13)
**Feature Area:** Event Infrastructure

---

## Summary

Implement the event infrastructure that reliably publishes domain events to a message broker (RabbitMQ) when Group Messages and Scheduled Messages are created or updated. The system uses three layers:

1. **EventBus** — A request-scoped in-memory bus. Controllers emit domain events to the EventBus during business logic execution. Events are collected but **not persisted yet**.
2. **Transactional Outbox** — An `OutboxMiddleware` flushes all collected events from the EventBus to the `outbox_events` table **in the same database transaction** as the entity changes. This guarantees atomicity.
3. **Outbox Worker → RabbitMQ** — A separate background process polls the outbox table (with `pg_notify` for instant wake-up) and publishes pending events to RabbitMQ.

This eliminates the dual-write problem — if the DB write succeeds, the event is guaranteed to be published eventually (even if RabbitMQ is temporarily down).

Reference: [Turumba Messaging — Group Messaging](../TURUMBA_MESSAGING.md#4-group-messaging), [Scheduled Messages](../TURUMBA_MESSAGING.md#5-scheduled-messages)

---

## Architecture

```
HTTP Request
    │
    ▼
Router (endpoint)
    │
    ▼
Controller.create() / Controller.update()
    │
    ├── 1. Business logic (auto-template creation, etc.)
    │
    ├── 2. Emit domain events → EventBus (in-memory list)
    │       event_bus.emit(DomainEvent("group_message.queued", ...))
    │
    ▼
Router (after controller returns)
    │
    ├── 3. OutboxMiddleware.flush(db, event_bus)
    │       └── Writes all collected events to outbox_events table
    │
    ├── 4. db.commit()
    │       └── ATOMIC: entity changes + outbox events in ONE transaction
    │
    ├── 5. pg_notify('outbox_channel') — wake up outbox worker
    │
    └── 6. Return response


Outbox Worker (separate process)
    │
    ├── LISTEN pg_notify / poll every 5s
    ├── SELECT pending events (FOR UPDATE SKIP LOCKED)
    ├── Publish to RabbitMQ exchange "messaging"
    └── UPDATE status = 'published'
            │
            ▼
    RabbitMQ (topic exchange)
    ├── group_message.* → group_message_processing queue
    ├── scheduled_message.* → scheduled_message_processing queue
    └── # → messaging_audit queue (optional)
            │
            ▼
    Consumers (future tasks)
```

### Why This Pattern

| Concern | How It's Handled |
|---------|-----------------|
| **Atomicity** | Entity + outbox events in one DB transaction — both succeed or both fail |
| **No event loss** | Events persist in outbox even if RabbitMQ is down — published when broker recovers |
| **Separation of concerns** | Controllers emit events without knowing about the outbox or RabbitMQ |
| **Testability** | Mock the EventBus to assert events emitted without needing a real DB or broker |
| **Consistency** | OutboxMiddleware adds standard metadata (request_id, user_id) to all events in one place |
| **Multi-event support** | One operation can emit multiple events — all collected and flushed together |
| **Ordering** | Events published in `created_at` order per aggregate |
| **Idempotency** | Events carry a unique `id` — consumers must handle at-least-once delivery |
| **Scalability** | Multiple outbox workers can run with `FOR UPDATE SKIP LOCKED` |

---

## Layer 1: Domain Events & EventBus

### DomainEvent Definition (`src/events/domain_event.py`)

```python
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

@dataclass
class DomainEvent:
    """
    Represents something that happened in the domain.
    Collected by the EventBus during a request, then flushed to the outbox.
    """
    event_type: str                    # e.g., "group_message.queued"
    aggregate_type: str                # e.g., "group_message"
    aggregate_id: UUID                 # the entity ID
    payload: dict                      # event-specific data
    created_at: datetime = field(default_factory=datetime.utcnow)
```

### EventBus (`src/events/event_bus.py`)

```python
class EventBus:
    """
    Request-scoped in-memory event collector.
    Controllers emit events here. The OutboxMiddleware flushes them to the
    outbox table at commit time.
    """

    def __init__(self):
        self._events: list[DomainEvent] = []

    def emit(self, event: DomainEvent) -> None:
        """Collect a domain event. Does NOT persist — just appends to memory."""
        self._events.append(event)

    def collect(self) -> list[DomainEvent]:
        """Return all collected events and clear the internal list."""
        events = self._events.copy()
        self._events.clear()
        return events

    @property
    def has_events(self) -> bool:
        return len(self._events) > 0

    @property
    def event_count(self) -> int:
        return len(self._events)
```

### FastAPI Dependency (Request-Scoped)

```python
# src/dependencies.py

from src.events.event_bus import EventBus

async def get_event_bus() -> EventBus:
    """
    Creates a new EventBus per request.
    Injected into controllers and the OutboxMiddleware.
    """
    return EventBus()
```

Each HTTP request gets its own EventBus instance. Events emitted during that request are isolated and flushed together at the end.

---

## Layer 2: Transactional Outbox

### OutboxEvent Model (`src/models/postgres/outbox_event.py`)

```python
class OutboxEvent(PostgresBaseModel):
    __tablename__ = "outbox_events"

    event_type       = Column(String(100), nullable=False, index=True)    # e.g., "group_message.queued"
    aggregate_type   = Column(String(50), nullable=False, index=True)     # e.g., "group_message"
    aggregate_id     = Column(UUID, nullable=False, index=True)           # the entity ID
    payload          = Column(JSONB, nullable=False)                      # event data
    status           = Column(String(20), nullable=False, default="pending", index=True)
    retry_count      = Column(Integer, nullable=False, default=0)
    max_retries      = Column(Integer, nullable=False, default=10)
    published_at     = Column(DateTime(timezone=True), nullable=True)
    error_message    = Column(Text, nullable=True)
```

**Status values:** `pending`, `published`, `failed`

**Indexes:**
- `status` — outbox worker queries by `status = 'pending'`
- `created_at` — ordering for FIFO processing
- Composite index on `(status, created_at)` for efficient polling

### OutboxMiddleware (`src/events/outbox_middleware.py`)

```python
from src.events.event_bus import EventBus
from src.models.postgres.outbox_event import OutboxEvent

class OutboxMiddleware:
    """
    Flushes all collected domain events from the EventBus to the outbox_events
    table. Must be called BEFORE db.commit() so the outbox records are part
    of the same transaction as the entity changes.
    """

    async def flush(self, db: AsyncSession, event_bus: EventBus, **context) -> int:
        """
        Write all collected events to the outbox table.
        Returns the number of events flushed.

        The `context` kwargs allow injecting request-level metadata
        (e.g., request_id, user_id) into all event payloads.
        """
        events = event_bus.collect()
        for event in events:
            outbox_entry = OutboxEvent(
                event_type=event.event_type,
                aggregate_type=event.aggregate_type,
                aggregate_id=event.aggregate_id,
                payload={
                    **event.payload,
                    # Standard envelope fields added by middleware
                    "event_type": event.event_type,
                    "aggregate_type": event.aggregate_type,
                    "aggregate_id": str(event.aggregate_id),
                    "timestamp": event.created_at.isoformat(),
                    # Request-level context (user_id, request_id, etc.)
                    **{k: str(v) if isinstance(v, UUID) else v for k, v in context.items()},
                },
                status="pending",
            )
            db.add(outbox_entry)
        return len(events)
```

### FastAPI Dependency

```python
# src/dependencies.py

from src.events.outbox_middleware import OutboxMiddleware

async def get_outbox_middleware() -> OutboxMiddleware:
    return OutboxMiddleware()
```

---

## Layer 3: Controller Event Emission

Controllers receive the EventBus via dependency injection and emit events during business logic. They have no knowledge of the outbox table or RabbitMQ — they only know about `DomainEvent` and `EventBus`.

### Group Message Controller

```python
# src/controllers/group_message.py

from src.events.domain_event import DomainEvent
from src.events.event_bus import EventBus

class GroupMessageController(CRUDController):

    async def create(self, data, db, event_bus: EventBus, **kwargs):
        # Business logic (auto-template creation, etc.)
        group_message = await super().create(data, db)

        # Emit domain event (in-memory only — not persisted yet)
        event_bus.emit(DomainEvent(
            event_type="group_message.created",
            aggregate_type="group_message",
            aggregate_id=group_message.id,
            payload={
                "id": str(group_message.id),
                "account_id": str(group_message.account_id),
                "channel_id": str(group_message.channel_id),
                "template_id": str(group_message.template_id),
                "status": group_message.status,
                "contact_group_ids": group_message.contact_group_ids,
                "total_recipients": group_message.total_recipients,
                "scheduled_at": group_message.scheduled_at.isoformat() if group_message.scheduled_at else None,
            },
        ))

        return group_message

    async def update(self, id, data, db, event_bus: EventBus, **kwargs):
        existing = await self.get(id, db)
        old_status = existing.status
        group_message = await super().update(id, data, db)

        # Emit event only on actual status transition
        if data.status and data.status != old_status:
            event_bus.emit(DomainEvent(
                event_type=f"group_message.{data.status}",
                aggregate_type="group_message",
                aggregate_id=group_message.id,
                payload={
                    "id": str(group_message.id),
                    "account_id": str(group_message.account_id),
                    "status": data.status,
                    "previous_status": old_status,
                },
            ))

        return group_message
```

### Scheduled Message Controller

```python
# src/controllers/scheduled_message.py

from src.events.domain_event import DomainEvent
from src.events.event_bus import EventBus

class ScheduledMessageController(CRUDController):

    async def create(self, data, db, event_bus: EventBus, **kwargs):
        scheduled_message = await super().create(data, db)

        event_bus.emit(DomainEvent(
            event_type="scheduled_message.created",
            aggregate_type="scheduled_message",
            aggregate_id=scheduled_message.id,
            payload={
                "id": str(scheduled_message.id),
                "account_id": str(scheduled_message.account_id),
                "channel_id": str(scheduled_message.channel_id),
                "template_id": str(scheduled_message.template_id),
                "send_type": scheduled_message.send_type,
                "status": scheduled_message.status,
                "scheduled_at": scheduled_message.scheduled_at.isoformat(),
                "timezone": scheduled_message.timezone,
                "is_recurring": scheduled_message.is_recurring,
                "recurrence_rule": scheduled_message.recurrence_rule,
                "next_trigger_at": scheduled_message.next_trigger_at.isoformat() if scheduled_message.next_trigger_at else None,
            },
        ))

        return scheduled_message

    async def update(self, id, data, db, event_bus: EventBus, **kwargs):
        existing = await self.get(id, db)
        old_status = existing.status
        scheduled_message = await super().update(id, data, db)

        # Status change events
        if data.status and data.status != old_status:
            event_type_map = {
                "cancelled": "scheduled_message.cancelled",
                "paused": "scheduled_message.paused",
                "pending": "scheduled_message.resumed" if old_status == "paused" else None,
            }
            event_type = event_type_map.get(data.status)

            if event_type:
                payload = {
                    "id": str(scheduled_message.id),
                    "account_id": str(scheduled_message.account_id),
                    "status": data.status,
                    "previous_status": old_status,
                }
                if data.status == "pending":
                    payload["next_trigger_at"] = (
                        scheduled_message.next_trigger_at.isoformat()
                        if scheduled_message.next_trigger_at else None
                    )

                event_bus.emit(DomainEvent(
                    event_type=event_type,
                    aggregate_type="scheduled_message",
                    aggregate_id=scheduled_message.id,
                    payload=payload,
                ))

        # Schedule config change events (non-status updates)
        schedule_fields = {"scheduled_at", "timezone", "is_recurring", "recurrence_rule", "recurrence_end_at"}
        changed_fields = {f for f in schedule_fields if getattr(data, f, None) is not None}
        if changed_fields and not data.status:
            event_bus.emit(DomainEvent(
                event_type="scheduled_message.updated",
                aggregate_type="scheduled_message",
                aggregate_id=scheduled_message.id,
                payload={
                    "id": str(scheduled_message.id),
                    "account_id": str(scheduled_message.account_id),
                    "scheduled_at": scheduled_message.scheduled_at.isoformat(),
                    "timezone": scheduled_message.timezone,
                    "is_recurring": scheduled_message.is_recurring,
                    "recurrence_rule": scheduled_message.recurrence_rule,
                    "next_trigger_at": (
                        scheduled_message.next_trigger_at.isoformat()
                        if scheduled_message.next_trigger_at else None
                    ),
                    "changed_fields": list(changed_fields),
                },
            ))

        return scheduled_message
```

---

## Router Pattern: Flush → Commit → Notify

The router ties everything together. This is the only place that knows about all three layers:

```python
# src/routers/group_message.py

@router.post("/")
async def create_group_message(
    data: GroupMessageCreate,
    db: AsyncSession = Depends(get_db),
    event_bus: EventBus = Depends(get_event_bus),
    outbox: OutboxMiddleware = Depends(get_outbox_middleware),
    current_user_id: str = Depends(get_current_user_id),
):
    # 1. Controller does business logic + emits events to EventBus
    result = await controller.create(data, db, event_bus=event_bus)

    # 2. Flush events from EventBus → outbox table (same transaction)
    event_count = await outbox.flush(db, event_bus, user_id=current_user_id)

    # 3. Single atomic commit: entity + outbox events
    await db.commit()

    # 4. Wake up outbox worker (fire-and-forget, non-blocking)
    if event_count > 0:
        try:
            await db.execute(text("SELECT pg_notify('outbox_channel', :payload)"),
                             {"payload": "group_message"})
        except Exception:
            pass  # Worker will pick it up on next poll cycle

    return result


@router.patch("/{id}")
async def update_group_message(
    id: str,
    data: GroupMessageUpdate,
    db: AsyncSession = Depends(get_db),
    event_bus: EventBus = Depends(get_event_bus),
    outbox: OutboxMiddleware = Depends(get_outbox_middleware),
    current_user_id: str = Depends(get_current_user_id),
):
    result = await controller.update(id, data, db, event_bus=event_bus)
    event_count = await outbox.flush(db, event_bus, user_id=current_user_id)
    await db.commit()

    if event_count > 0:
        try:
            await db.execute(text("SELECT pg_notify('outbox_channel', :payload)"),
                             {"payload": "group_message"})
        except Exception:
            pass

    return result
```

### The Flow Step by Step

```
1. Request arrives → FastAPI creates new EventBus instance (request-scoped)

2. Controller executes:
   ├── Creates/updates entity in DB session (not committed yet)
   └── Emits DomainEvent(s) to EventBus (in-memory list, nothing persisted)

3. Router calls outbox.flush(db, event_bus):
   └── EventBus.collect() returns all events and clears the list
   └── For each event: creates OutboxEvent record in DB session
   └── Standard metadata (timestamp, user_id, request_id) added by middleware

4. Router calls db.commit():
   └── SINGLE ATOMIC TRANSACTION commits:
       ├── Entity INSERT/UPDATE
       └── OutboxEvent INSERT(s)
   └── If commit fails: both entity AND outbox events are rolled back

5. Router calls pg_notify (fire-and-forget):
   └── Outbox worker wakes up immediately

6. Response returned to client
```

### What Happens on Failure

| Failure Point | Entity | Outbox Event | Outcome |
|---------------|--------|-------------|---------|
| Controller throws before emit | Not committed | Not created | Clean — nothing happened |
| Controller throws after emit | Not committed | Not flushed | Clean — EventBus discarded with request |
| Flush succeeds, commit fails | Rolled back | Rolled back | Clean — atomic rollback |
| Commit succeeds, pg_notify fails | Committed | Committed | OK — worker picks up on next poll |
| All succeeds, RabbitMQ down | Committed | Committed (pending) | OK — worker retries until broker recovers |

---

## Event Types

### Group Message Events

| Event Type | Trigger | Payload |
|------------|---------|---------|
| `group_message.created` | GroupMessage created | `{ id, account_id, channel_id, template_id, status, contact_group_ids, total_recipients, scheduled_at }` |
| `group_message.queued` | Status → `queued` | `{ id, account_id, status, previous_status }` |
| `group_message.cancelled` | Status → `cancelled` | `{ id, account_id, status, previous_status }` |

### Scheduled Message Events

| Event Type | Trigger | Payload |
|------------|---------|---------|
| `scheduled_message.created` | ScheduledMessage created | `{ id, account_id, channel_id, template_id, send_type, status, scheduled_at, timezone, is_recurring, recurrence_rule, next_trigger_at }` |
| `scheduled_message.updated` | Schedule config changed | `{ id, account_id, scheduled_at, timezone, is_recurring, recurrence_rule, next_trigger_at, changed_fields }` |
| `scheduled_message.cancelled` | Status → `cancelled` | `{ id, account_id, status, previous_status }` |
| `scheduled_message.paused` | Status → `paused` | `{ id, account_id, status, previous_status }` |
| `scheduled_message.resumed` | Status `paused` → `pending` | `{ id, account_id, status, previous_status, next_trigger_at }` |

### Event Payload Convention

All event payloads include standard envelope fields (added by OutboxMiddleware):

```json
{
  "event_type": "group_message.queued",
  "aggregate_type": "group_message",
  "aggregate_id": "uuid",
  "timestamp": "2026-02-08T12:00:00Z",
  "user_id": "uuid",
  "...entity-specific fields..."
}
```

---

## Layer 3: Outbox Worker → RabbitMQ

### Outbox Worker (`src/workers/outbox_worker.py`)

A standalone Python process that reads pending outbox events and publishes to RabbitMQ.

### Processing Loop

```
1. Connect to PostgreSQL (LISTEN on 'outbox_channel')
2. Connect to RabbitMQ (declare exchange + queues)
3. Loop:
   a. Wait for pg_notify OR poll timeout (5 seconds fallback)
   b. SELECT pending events (batch of 100, FOR UPDATE SKIP LOCKED)
   c. For each event:
      - Publish to RabbitMQ exchange "messaging" with routing_key = event_type
      - On success: UPDATE status = 'published', SET published_at = now()
      - On failure: INCREMENT retry_count, SET error_message
        - If retry_count >= max_retries: SET status = 'failed'
   d. COMMIT batch
4. Periodic cleanup: DELETE published events older than 7 days
```

### RabbitMQ Publishing

For each outbox event:

```python
await exchange.publish(
    aio_pika.Message(
        body=json.dumps(event.payload).encode(),
        message_id=str(event.id),          # for idempotency
        content_type="application/json",
        delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        headers={
            "aggregate_type": event.aggregate_type,
            "aggregate_id": str(event.aggregate_id),
            "event_type": event.event_type,
            "created_at": event.created_at.isoformat(),
        },
    ),
    routing_key=event.event_type,          # e.g., "group_message.queued"
)
```

### Retry Strategy

| Retry Count | Wait Before Retry | Action |
|-------------|-------------------|--------|
| 1–3 | Immediate (next poll cycle) | Retry publish |
| 4–6 | 30 seconds (skip in current batch) | Retry with delay |
| 7–9 | 5 minutes | Retry with longer delay |
| 10+ | — | Mark as `failed`, log alert |

Failed events remain in the table for manual investigation and can be retried manually (`UPDATE status = 'pending', retry_count = 0`).

---

## RabbitMQ Setup

### Exchange

| Name | Type | Durable | Description |
|------|------|---------|-------------|
| `messaging` | `topic` | Yes | All messaging domain events |

### Queues (Initial)

| Queue | Bindings | Purpose |
|-------|----------|---------|
| `group_message_processing` | `group_message.*` | Group message dispatch processor (future consumer) |
| `scheduled_message_processing` | `scheduled_message.*` | Scheduled message trigger processor (future consumer) |
| `messaging_audit` | `#` (all events) | Audit log / debugging (optional, useful for development) |

### Dead Letter Exchange

| Name | Type | Purpose |
|------|------|---------|
| `messaging.dlx` | `topic` | Failed messages after consumer retries exhausted |
| `messaging.dlq` | queue bound to `messaging.dlx` with `#` | Dead letter queue for investigation |

### Queue Declaration (in Outbox Worker startup)

The outbox worker declares the exchange and initial queues on startup:

```python
# Declare main exchange
await channel.declare_exchange("messaging", aio_pika.ExchangeType.TOPIC, durable=True)

# Declare dead letter exchange + queue
dlx = await channel.declare_exchange("messaging.dlx", aio_pika.ExchangeType.TOPIC, durable=True)
dlq = await channel.declare_queue("messaging.dlq", durable=True)
await dlq.bind(dlx, routing_key="#")

# Declare processing queues with dead letter routing
queue_args = {"x-dead-letter-exchange": "messaging.dlx"}

gm_queue = await channel.declare_queue("group_message_processing", durable=True, arguments=queue_args)
await gm_queue.bind(exchange, routing_key="group_message.*")

sm_queue = await channel.declare_queue("scheduled_message_processing", durable=True, arguments=queue_args)
await sm_queue.bind(exchange, routing_key="scheduled_message.*")
```

---

## Configuration

### Environment Variables

Add to `src/config/config.py`:

```python
# RabbitMQ
RABBITMQ_URL: str = "amqp://guest:guest@localhost:5672/"
RABBITMQ_EXCHANGE: str = "messaging"

# Outbox Worker
OUTBOX_POLL_INTERVAL: int = 5          # seconds (fallback if pg_notify misses)
OUTBOX_BATCH_SIZE: int = 100           # events per poll cycle
OUTBOX_MAX_RETRIES: int = 10           # max publish attempts
OUTBOX_CLEANUP_DAYS: int = 7           # delete published events older than this
```

---

## Dependencies

### Python Packages

Add to `requirements.txt`:

```
aio-pika>=9.0        # async RabbitMQ client (for outbox worker)
```

---

## Tasks

### 1. DomainEvent & EventBus
- [ ] Create `src/events/domain_event.py` — `DomainEvent` dataclass with event_type, aggregate_type, aggregate_id, payload, created_at
- [ ] Create `src/events/event_bus.py` — `EventBus` class with `emit()`, `collect()`, `has_events`, `event_count`
- [ ] Register `get_event_bus` dependency in `src/dependencies.py` (request-scoped)

### 2. Outbox Event Model
- [ ] Create `src/models/postgres/outbox_event.py`
- [ ] Fields: event_type, aggregate_type, aggregate_id, payload (JSONB), status, retry_count, max_retries, published_at, error_message
- [ ] Add composite index on `(status, created_at)`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

### 3. OutboxMiddleware
- [ ] Create `src/events/outbox_middleware.py` — `OutboxMiddleware` with `flush(db, event_bus, **context)`
- [ ] Flush reads events from EventBus via `collect()`
- [ ] Creates OutboxEvent records in the DB session (not committed — caller commits)
- [ ] Adds standard envelope fields (event_type, aggregate_type, aggregate_id, timestamp) and context kwargs (user_id, request_id) to all event payloads
- [ ] Returns count of events flushed
- [ ] Register `get_outbox_middleware` dependency in `src/dependencies.py`

### 4. Group Message Controller — Event Emission
- [ ] Accept `event_bus: EventBus` parameter in `create` and `update` methods
- [ ] On create: emit `group_message.created` event with full payload
- [ ] On update (status change): emit `group_message.{new_status}` event
- [ ] Only emit on actual status transitions (old_status != new_status)

### 5. Scheduled Message Controller — Event Emission
- [ ] Accept `event_bus: EventBus` parameter in `create` and `update` methods
- [ ] On create: emit `scheduled_message.created` event with full payload
- [ ] On update (status → cancelled): emit `scheduled_message.cancelled`
- [ ] On update (status → paused): emit `scheduled_message.paused`
- [ ] On update (paused → pending): emit `scheduled_message.resumed`
- [ ] On update (schedule config changed, non-status): emit `scheduled_message.updated` with changed_fields

### 6. Router Integration
- [ ] Update group message routers (POST, PATCH): inject EventBus + OutboxMiddleware, call flush before commit
- [ ] Update scheduled message routers (POST, PATCH): inject EventBus + OutboxMiddleware, call flush before commit
- [ ] After commit: fire `pg_notify('outbox_channel', ...)` — fire-and-forget, wrapped in try/except
- [ ] Pass `user_id` as context to outbox.flush() for metadata enrichment

### 7. RabbitMQ Configuration
- [ ] Add `RABBITMQ_URL`, `RABBITMQ_EXCHANGE`, outbox worker settings to `src/config/config.py`
- [ ] Add `aio-pika` to `requirements.txt`

### 8. Outbox Worker
- [ ] Create `src/workers/outbox_worker.py`
- [ ] On startup: connect to PostgreSQL, LISTEN on `outbox_channel`
- [ ] On startup: connect to RabbitMQ, declare exchange (`messaging`, topic, durable)
- [ ] On startup: declare queues (`group_message_processing`, `scheduled_message_processing`) with DLX
- [ ] On startup: declare dead letter exchange + queue (`messaging.dlx`, `messaging.dlq`)
- [ ] Processing loop: wait for pg_notify or poll timeout (5s fallback)
- [ ] Batch read: SELECT pending events, ORDER BY created_at, LIMIT 100, FOR UPDATE SKIP LOCKED
- [ ] For each event: publish to RabbitMQ with routing_key = event_type, persistent delivery, message_id = outbox event id
- [ ] On publish success: update status = 'published', set published_at
- [ ] On publish failure: increment retry_count, set error_message. Mark as 'failed' if retry_count >= max_retries
- [ ] Periodic cleanup: delete published events older than configured retention (7 days default)
- [ ] Graceful shutdown on SIGTERM/SIGINT

### 9. Tests
- [ ] **EventBus:** emit collects events, collect returns and clears, has_events/event_count work
- [ ] **EventBus:** multiple emits collected in order
- [ ] **OutboxMiddleware:** flush creates OutboxEvent records in DB session
- [ ] **OutboxMiddleware:** flush adds standard envelope fields + context kwargs to payload
- [ ] **OutboxMiddleware:** flush returns correct event count
- [ ] **OutboxMiddleware:** flush with no events returns 0 and creates nothing
- [ ] **Atomicity:** creating a GroupMessage also creates OutboxEvent in the same transaction
- [ ] **Atomicity:** if entity creation fails (rollback), no OutboxEvent is persisted
- [ ] **GroupMessage:** create emits `group_message.created` with correct payload
- [ ] **GroupMessage:** update status emits `group_message.{new_status}` event
- [ ] **GroupMessage:** update without status change emits no event
- [ ] **ScheduledMessage:** create emits `scheduled_message.created` with correct payload
- [ ] **ScheduledMessage:** cancel emits `scheduled_message.cancelled`
- [ ] **ScheduledMessage:** pause emits `scheduled_message.paused`
- [ ] **ScheduledMessage:** resume (paused → pending) emits `scheduled_message.resumed` with next_trigger_at
- [ ] **ScheduledMessage:** config update emits `scheduled_message.updated` with changed_fields
- [ ] **Outbox Worker:** processes pending events and marks as published (integration test)
- [ ] **Outbox Worker:** increments retry_count on publish failure
- [ ] **Outbox Worker:** marks as 'failed' after max retries
- [ ] **Outbox Worker:** skips locked events (concurrent worker safety)
- [ ] **Cleanup:** published events deleted after retention period

---

## Acceptance Criteria

- [ ] `DomainEvent` dataclass and `EventBus` class implemented with full test coverage
- [ ] `outbox_events` table created via Alembic migration
- [ ] `OutboxMiddleware` flushes EventBus events to outbox table with metadata enrichment
- [ ] GroupMessage controller emits domain events via EventBus on create and status change
- [ ] ScheduledMessage controller emits domain events via EventBus on create, status change, and config update
- [ ] Routers follow the pattern: controller → flush → commit → pg_notify
- [ ] Transaction rollback prevents orphaned outbox events (atomicity proven by tests)
- [ ] Outbox worker connects to PostgreSQL and RabbitMQ on startup
- [ ] Outbox worker declares exchange, queues, and dead letter infrastructure
- [ ] Outbox worker polls pending events and publishes to RabbitMQ
- [ ] Events published with correct routing_key, persistent delivery, and message_id
- [ ] Retry logic: increment retry_count, mark failed after max retries
- [ ] Cleanup: published events deleted after retention period
- [ ] Tests passing with coverage threshold
- [ ] Ruff passes cleanly

---

## Dependencies

- Issue #1 (Core Architecture Components) — Done
- Issue #3 (Dual Database Support) — Done
- Group Messages (#11) — controllers to instrument with EventBus
- Scheduled Messages (#12) — controllers to instrument with EventBus

---

## Note: Consumers

This task covers only the **event infrastructure** — DomainEvent, EventBus, OutboxMiddleware, outbox table, controller integration, outbox worker, and RabbitMQ setup. The actual **event consumers** (Group Message Processor, Scheduled Message Trigger Service) that subscribe to the RabbitMQ queues and do the processing are separate future tasks.

After this task is complete, events will flow from the API through the EventBus → outbox → RabbitMQ queues, where they will wait for consumers to be implemented. The `messaging_audit` queue (optional) can be used during development to verify events are flowing correctly via the RabbitMQ management UI.
