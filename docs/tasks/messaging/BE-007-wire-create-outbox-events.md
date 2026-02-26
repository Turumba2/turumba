# BE-007: Wire Create Flows to Outbox Event Pipeline

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** TBD
**Feature Area:** Event Infrastructure
**Depends On:** [BE-006 — Event Infrastructure](./BE-006-event-outbox-rabbitmq.md) (completed)

---

## Summary

BE-006 built the full event infrastructure — `DomainEvent`, `EventBus`, `OutboxMiddleware`, `OutboxEvent` model, outbox worker, and RabbitMQ topology. However, **none of this is wired into the actual creation flows**. When a group message or scheduled message is created today, no domain event is emitted and no outbox record is written.

This task connects the `POST /` (create) endpoints for Group Messages and Scheduled Messages to the event pipeline. The key structural change is **moving commit responsibility from the service layer to the router**, so that the entity INSERT and the outbox INSERT land in a single atomic transaction.

Reference: [BE-006 — Router Pattern: Flush → Commit → Notify](./BE-006-event-outbox-rabbitmq.md#router-pattern-flush--commit--notify)

---

## Architecture: Before vs. After

### Before (Current)

```
Router.create_group_message()
  │
  └── controller.create()
        └── service._create()
              ├── db.add(entity)
              ├── db.commit()          ← commit happens inside service
              └── db.refresh(entity)
```

No events emitted. Commit buried inside the service layer.

### After (Target)

```
Router.create_group_message()
  │
  ├── 1. controller.create(event_bus)
  │      ├── service._create()
  │      │     ├── db.add(entity)
  │      │     ├── db.flush()          ← flush assigns ID, no commit
  │      │     └── return entity
  │      └── event_bus.emit(DomainEvent(...))
  │
  ├── 2. OutboxMiddleware.flush(db, event_bus)
  │      └── writes OutboxEvent rows to db session
  │
  ├── 3. db.commit()                   ← SINGLE atomic commit
  │      └── entity + outbox events committed together
  │
  ├── 4. send_pg_notify(db)            ← wake outbox worker
  │
  └── 5. return response
```

### Why Move the Commit

The outbox pattern **requires** that the entity and its outbox event(s) are written in the same transaction. If the service calls `db.commit()` internally, the outbox middleware can't add its rows to that transaction — they'd end up in a separate commit, breaking atomicity. Changing `commit()` → `flush()` in the service keeps the transaction open for the router to finalize.

---

## Files to Modify (6 files)

| # | File | Change |
|---|------|--------|
| 1 | `src/services/group_message/group_message_creation.py` | `db.commit()` → `db.flush()`, remove `db.refresh()` |
| 2 | `src/services/scheduled_message/scheduled_message_creation.py` | `db.commit()` → `db.flush()`, remove `db.refresh()` |
| 3 | `src/controllers/group_message.py` | Accept `EventBus`, emit `group_message.created` after service returns |
| 4 | `src/controllers/scheduled_message.py` | Accept `EventBus`, emit `scheduled_message.created` after service returns |
| 5 | `src/routers/group_message.py` | Inject `EventBus`, pass to controller, flush outbox, commit, pg_notify |
| 6 | `src/routers/scheduled_message.py` | Inject `EventBus`, pass to controller, flush outbox, commit, pg_notify |

---

## Implementation Details

### Step 1: Service Layer — `commit()` → `flush()`

Both creation services currently call `self.db.commit()` and `self.db.refresh()`. Change them to `self.db.flush()` only. Flush assigns the auto-generated `id` and processes defaults without finalizing the transaction.

#### `src/services/group_message/group_message_creation.py`

**Current** (lines 59–63):
```python
db_obj = GroupMessage(account_id=account_id, **payload)
self.db.add(db_obj)
self.db.commit()
self.db.refresh(db_obj)
return db_obj
```

**Target:**
```python
db_obj = GroupMessage(account_id=account_id, **payload)
self.db.add(db_obj)
self.db.flush()
return db_obj
```

#### `src/services/scheduled_message/scheduled_message_creation.py`

**Current** (lines 61–65):
```python
db_obj = ScheduledMessage(account_id=account_id, **payload)
self.db.add(db_obj)
self.db.commit()
self.db.refresh(db_obj)
return db_obj
```

**Target:**
```python
db_obj = ScheduledMessage(account_id=account_id, **payload)
self.db.add(db_obj)
self.db.flush()
return db_obj
```

> **Note:** `db.refresh()` is no longer needed after `flush()` because the entity is already in the session with its generated fields (id, created_at, etc.). The router's `db.commit()` will finalize everything.

---

### Step 2: Controller Layer — Accept EventBus, Emit Events

Controllers gain an `event_bus` parameter on their `create()` method. After the service returns the entity (with a flush-assigned ID), the controller emits a `DomainEvent`.

#### `src/controllers/group_message.py`

**Current** (lines 122–124):
```python
async def create(self, obj_in: GroupMessageCreate) -> GroupMessage:
    account_id = self._get_scoped_account_id()
    return await self.group_message_creation_service.create_group_message(obj_in, account_id)
```

**Target:**
```python
from src.events import DomainEvent, EventBus, EventType

async def create(self, obj_in: GroupMessageCreate, event_bus: EventBus) -> GroupMessage:
    account_id = self._get_scoped_account_id()
    group_message = await self.group_message_creation_service.create_group_message(
        obj_in, account_id
    )

    event_bus.emit(
        DomainEvent(
            event_type=EventType.GROUP_MESSAGE_CREATED,
            aggregate_type="group_message",
            aggregate_id=group_message.id,
            payload={
                "id": str(group_message.id),
                "account_id": str(group_message.account_id),
                "channel_id": str(group_message.channel_id) if group_message.channel_id else None,
                "template_id": str(group_message.template_id) if group_message.template_id else None,
                "status": group_message.status,
                "contact_group_ids": group_message.contact_group_ids,
                "total_recipients": group_message.total_recipients,
                "scheduled_at": (
                    group_message.scheduled_at.isoformat()
                    if group_message.scheduled_at
                    else None
                ),
            },
        )
    )

    return group_message
```

#### `src/controllers/scheduled_message.py`

**Current** (lines 136–140):
```python
async def create(self, obj_in: ScheduledMessageCreate) -> ScheduledMessage:
    account_id = self._get_scoped_account_id()
    return await self.scheduled_message_creation_service.create_scheduled_message(
        obj_in, account_id
    )
```

**Target:**
```python
from src.events import DomainEvent, EventBus, EventType

async def create(self, obj_in: ScheduledMessageCreate, event_bus: EventBus) -> ScheduledMessage:
    account_id = self._get_scoped_account_id()
    scheduled_message = await self.scheduled_message_creation_service.create_scheduled_message(
        obj_in, account_id
    )

    event_bus.emit(
        DomainEvent(
            event_type=EventType.SCHEDULED_MESSAGE_CREATED,
            aggregate_type="scheduled_message",
            aggregate_id=scheduled_message.id,
            payload={
                "id": str(scheduled_message.id),
                "account_id": str(scheduled_message.account_id),
                "channel_id": (
                    str(scheduled_message.channel_id) if scheduled_message.channel_id else None
                ),
                "template_id": (
                    str(scheduled_message.template_id) if scheduled_message.template_id else None
                ),
                "send_type": scheduled_message.send_type,
                "status": scheduled_message.status,
                "scheduled_at": scheduled_message.scheduled_at.isoformat(),
                "timezone": scheduled_message.timezone,
                "is_recurring": scheduled_message.is_recurring,
                "recurrence_rule": scheduled_message.recurrence_rule,
                "next_trigger_at": (
                    scheduled_message.next_trigger_at.isoformat()
                    if scheduled_message.next_trigger_at
                    else None
                ),
            },
        )
    )

    return scheduled_message
```

---

### Step 3: Router Layer — Orchestrate the Full Sequence

The router is the **only layer that knows about all three concerns**: controller, outbox middleware, and commit. It injects the `EventBus` via FastAPI dependency, passes it to the controller, then flushes the outbox and commits.

#### `src/routers/group_message.py` — `create_group_message`

**Current** (lines 30–37):
```python
@router.post(
    "/",
    response_model=SuccessResponse[GroupMessageResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_group_message(
    payload: GroupMessageCreate,
    request: Request,
    controller: GroupMessageController = Depends(get_group_message_controller),
) -> SuccessResponse[GroupMessageResponse]:
    _prepare_controller_context(controller, request)
    created = await controller.create(payload)
    return SuccessResponse(data=controller.model_to_response(created))
```

**Target:**
```python
from src.events import EventBus, get_event_bus
from src.events.outbox_middleware import OutboxMiddleware
from src.events.pg_notify import send_pg_notify

@router.post(
    "/",
    response_model=SuccessResponse[GroupMessageResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_group_message(
    payload: GroupMessageCreate,
    request: Request,
    db: Session = Depends(get_postgres_db),
    controller: GroupMessageController = Depends(get_group_message_controller),
    event_bus: EventBus = Depends(get_event_bus),
) -> SuccessResponse[GroupMessageResponse]:
    _prepare_controller_context(controller, request)

    # 1. Business logic + event emission (in-memory)
    created = await controller.create(payload, event_bus)

    # 2. Flush events to outbox table (same DB session, not committed yet)
    OutboxMiddleware.flush(db, event_bus)

    # 3. Single atomic commit: entity + outbox events
    db.commit()

    # 4. Wake outbox worker (fire-and-forget)
    send_pg_notify(db)

    return SuccessResponse(data=controller.model_to_response(created))
```

#### `src/routers/scheduled_message.py` — `create_scheduled_message`

Same pattern — inject `db`, `event_bus`; call controller, flush, commit, notify.

**Target:**
```python
from src.events import EventBus, get_event_bus
from src.events.outbox_middleware import OutboxMiddleware
from src.events.pg_notify import send_pg_notify

@router.post(
    "/",
    response_model=SuccessResponse[ScheduledMessageResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_scheduled_message(
    payload: ScheduledMessageCreate,
    request: Request,
    db: Session = Depends(get_postgres_db),
    controller: ScheduledMessageController = Depends(get_scheduled_message_controller),
    event_bus: EventBus = Depends(get_event_bus),
) -> SuccessResponse[ScheduledMessageResponse]:
    _prepare_controller_context(controller, request)

    # 1. Business logic + event emission (in-memory)
    created = await controller.create(payload, event_bus)

    # 2. Flush events to outbox table (same DB session, not committed yet)
    OutboxMiddleware.flush(db, event_bus)

    # 3. Single atomic commit: entity + outbox events
    db.commit()

    # 4. Wake outbox worker (fire-and-forget)
    send_pg_notify(db)

    return SuccessResponse(data=controller.model_to_response(created))
```

> **Important:** The `db` session injected at the router level is the **same** session used by the controller (via `get_postgres_db` dependency). FastAPI's dependency injection ensures a single session per request.

---

## Event Payloads

These payloads are the `data` field within the outbox envelope. The `OutboxMiddleware` wraps them with standard metadata (`event_id`, `event_type`, `aggregate_type`, `aggregate_id`, `occurred_at`, `user_id`, `request_id`).

### `group_message.created`

```json
{
  "id": "uuid",
  "account_id": "uuid",
  "channel_id": "uuid | null",
  "template_id": "uuid | null",
  "status": "draft",
  "contact_group_ids": ["uuid", "uuid"],
  "total_recipients": 0,
  "scheduled_at": "ISO-8601 | null"
}
```

### `scheduled_message.created`

```json
{
  "id": "uuid",
  "account_id": "uuid",
  "channel_id": "uuid | null",
  "template_id": "uuid | null",
  "send_type": "individual | group",
  "status": "pending",
  "scheduled_at": "ISO-8601",
  "timezone": "string | null",
  "is_recurring": false,
  "recurrence_rule": "string | null",
  "next_trigger_at": "ISO-8601 | null"
}
```

---

## Existing Infrastructure Reference

All of these already exist from BE-006. **Do not re-implement them** — just import and use:

| Component | Location | Import |
|-----------|----------|--------|
| `DomainEvent` | `src/events/domain_event.py` | `from src.events import DomainEvent` |
| `EventBus` | `src/events/event_bus.py` | `from src.events import EventBus, get_event_bus` |
| `EventType` | `src/events/event_types.py` | `from src.events import EventType` |
| `OutboxMiddleware` | `src/events/outbox_middleware.py` | `from src.events.outbox_middleware import OutboxMiddleware` |
| `OutboxEvent` | `src/models/postgres/outbox_event.py` | (used internally by OutboxMiddleware) |
| `send_pg_notify` | `src/events/pg_notify.py` | `from src.events.pg_notify import send_pg_notify` |

### Key API Signatures

```python
# EventBus — request-scoped, inject once per request
event_bus = EventBus()
event_bus.emit(DomainEvent(...))          # collect in-memory
events = event_bus.collect()               # return + clear

# OutboxMiddleware — static method, no instantiation needed
OutboxMiddleware.flush(
    db: Session,
    event_bus: EventBus,
    *,
    user_id: str | None = None,
    request_id: str | None = None,
) -> list[OutboxEvent]

# pg_notify — fire-and-forget, logs and swallows errors in test (SQLite)
send_pg_notify(db: Session, channel: str = "outbox_channel", payload: str = "")
```

---

## Tasks

### 1. Service Layer — Remove Commit
- [ ] `group_message_creation.py`: Change `self.db.commit()` → `self.db.flush()` (line 61)
- [ ] `group_message_creation.py`: Remove `self.db.refresh(db_obj)` (line 62)
- [ ] `scheduled_message_creation.py`: Change `self.db.commit()` → `self.db.flush()` (line 63)
- [ ] `scheduled_message_creation.py`: Remove `self.db.refresh(db_obj)` (line 64)
- [ ] Verify existing tests still pass (flush assigns IDs just like commit did)

### 2. Controller Layer — Emit Events
- [ ] `group_message.py`: Add `event_bus: EventBus` parameter to `create()` method
- [ ] `group_message.py`: After service returns entity, emit `group_message.created` event with payload
- [ ] `scheduled_message.py`: Add `event_bus: EventBus` parameter to `create()` method
- [ ] `scheduled_message.py`: After service returns entity, emit `scheduled_message.created` event with payload
- [ ] Use `EventType` constants (not raw strings) for event type values

### 3. Router Layer — Flush, Commit, Notify
- [ ] `group_message.py` router: Add `db` and `event_bus` dependencies to `create_group_message`
- [ ] `group_message.py` router: Pass `event_bus` to `controller.create()`
- [ ] `group_message.py` router: Call `OutboxMiddleware.flush(db, event_bus)` after controller returns
- [ ] `group_message.py` router: Call `db.commit()` after flush
- [ ] `group_message.py` router: Call `send_pg_notify(db)` after commit
- [ ] `scheduled_message.py` router: Same sequence for `create_scheduled_message`
- [ ] Verify `db` injected at router is the same session the controller uses

### 4. Tests
- [ ] **Create group message → outbox event exists**: POST creates a GroupMessage AND an OutboxEvent with `event_type="group_message.created"` and correct payload fields
- [ ] **Create scheduled message → outbox event exists**: POST creates a ScheduledMessage AND an OutboxEvent with `event_type="scheduled_message.created"` and correct payload fields
- [ ] **Atomicity — single transaction**: Entity and outbox event are committed together. Mock `db.commit()` to verify it's called exactly once (not once in service + once in router)
- [ ] **Rollback — no orphaned outbox event**: If service `_create()` raises an exception, no OutboxEvent row is persisted
- [ ] **EventBus isolation**: Two concurrent requests each get their own EventBus (events don't leak between requests)
- [ ] **pg_notify called**: After successful create, `send_pg_notify` is invoked (mock to verify)
- [ ] **Existing CRUD tests still pass**: List, get-by-id, update, delete endpoints are unaffected by this change

---

## Acceptance Criteria

- [ ] Creating a group message writes both a `group_messages` row AND an `outbox_events` row in a single DB transaction
- [ ] Creating a scheduled message writes both a `scheduled_messages` row AND an `outbox_events` row in a single DB transaction
- [ ] Outbox event payloads match the schemas defined in the [Event Payloads](#event-payloads) section
- [ ] `EventType` constants used (no raw strings for event types)
- [ ] `send_pg_notify()` called after commit to wake the outbox worker
- [ ] Service layer no longer calls `db.commit()` — commit happens only in the router
- [ ] Failed entity creation does not leave orphaned outbox events (atomicity)
- [ ] All existing tests pass (list, get, update, delete endpoints unaffected)
- [ ] New tests cover outbox event creation, payload correctness, atomicity, and rollback
- [ ] Ruff passes cleanly
- [ ] Coverage threshold maintained (80%)

---

## Scope Boundaries

### In Scope
- Wiring `create` endpoints (POST) for group messages and scheduled messages
- Service `commit()` → `flush()` change
- Controller event emission
- Router flush → commit → notify orchestration
- Tests for the above

### Out of Scope (Future Tasks)
- **Update flow events** (status transitions like `group_message.queued`, `scheduled_message.cancelled`, etc.) — separate task, same pattern
- **Event consumers** that process messages from RabbitMQ queues
- **Outbox worker changes** — already complete from BE-006
- **Message entity** events — messages follow a different creation path

---

## Dependencies

- [BE-006 — Event Infrastructure](./BE-006-event-outbox-rabbitmq.md) — Must be complete (provides all `src/events/` modules, `OutboxEvent` model, outbox worker)
- Group Messages (Issue #11) — Entity CRUD must be implemented
- Scheduled Messages (Issue #12) — Entity CRUD must be implemented

---

## Note: This is the First Wiring Task

This task establishes the **pattern** for connecting domain operations to the event pipeline. Once this is merged and validated, the same pattern applies to:

1. **Update flow events** — status transitions on PATCH endpoints (same flush → commit → notify pattern, but with conditional event emission based on old vs. new status)
2. **Other entity events** — if messages or templates need events in the future

The create flow is the simplest case because it always emits exactly one event. Update flows are more complex (conditional emission, multiple event types) and will be a separate task.
