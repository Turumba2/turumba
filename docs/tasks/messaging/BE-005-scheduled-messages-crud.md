# BE-005: Implement Scheduled Messages CRUD API

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** [Turumba2/turumba_messaging_api#12](https://github.com/Turumba2/turumba_messaging_api/issues/12)
**Feature Area:** Scheduled Messages

---

## Summary

Implement the Scheduled Messages domain entity with full CRUD functionality. A Scheduled Message is a scheduling configuration that defines what to send, who to send to, and when to send it. It supports both one-time and recurring schedules with timezone awareness. When the scheduled time arrives, the system creates the actual Message or Group Message records for delivery.

This entity provides a unified view of all scheduled sends — both single and group — and supports editing or cancelling before the scheduled time.

Reference: [Turumba Messaging — Scheduled Messages](../TURUMBA_MESSAGING.md#5-scheduled-messages)

---

## Database: PostgreSQL

Scheduled messages are relational (FK to accounts, channels, templates; creates messages or group messages on trigger) and require consistent state for recurring schedule tracking. Recipient targeting and recurrence configuration are stored in JSONB.

### ScheduledMessage Model (`src/models/postgres/scheduled_message.py`)

```python
class ScheduledMessage(PostgresBaseModel):
    __tablename__ = "scheduled_messages"

    account_id          = Column(UUID, nullable=False, index=True)
    channel_id          = Column(UUID, nullable=True, index=True)
    template_id         = Column(UUID, nullable=True, index=True)
    created_by_user_id  = Column(UUID, nullable=True)

    name                = Column(String(255), nullable=True)
    status              = Column(String(50), nullable=False, default="pending", index=True)

    # What to send (either template_id or message_body)
    message_body        = Column(Text, nullable=True)
    custom_values       = Column(JSONB, nullable=True, default=dict)

    # Who to send to
    send_type           = Column(String(20), nullable=False, index=True)  # "single" or "group"
    delivery_address    = Column(String, nullable=True)           # single: phone, email, etc.
    contact_id          = Column(UUID, nullable=True)             # single: specific contact
    contact_group_ids   = Column(JSONB, nullable=True, default=list)   # group: list of group UUIDs
    exclude_contact_ids = Column(JSONB, nullable=True, default=list)   # group: contacts to exclude

    # When to send
    scheduled_at        = Column(DateTime(timezone=True), nullable=False)
    timezone            = Column(String(50), nullable=True)       # e.g., "Africa/Addis_Ababa"

    # Recurring configuration
    is_recurring        = Column(Boolean, nullable=False, default=False)
    recurrence_rule     = Column(String(255), nullable=True)      # e.g., "daily", "weekly:mon,wed,fri", "monthly:15"
    recurrence_end_at   = Column(DateTime(timezone=True), nullable=True)
    last_triggered_at   = Column(DateTime(timezone=True), nullable=True)
    next_trigger_at     = Column(DateTime(timezone=True), nullable=True, index=True)
    trigger_count       = Column(Integer, nullable=False, default=0)

    # Resulting records (populated after trigger)
    message_id          = Column(UUID, nullable=True)             # created message (single)
    group_message_id    = Column(UUID, nullable=True)             # created group message (group)

    metadata            = Column(JSONB, nullable=True, default=dict)
```

### Enums

**Send Type:** `single`, `group`

**Status:** `pending`, `triggered`, `completed`, `failed`, `cancelled`, `paused`

- `pending` — Waiting for scheduled time to arrive
- `triggered` — Currently being processed (creating message/group message)
- `completed` — Message/group message created successfully (or all recurrences finished)
- `failed` — Trigger failed (e.g., invalid template, channel unavailable)
- `cancelled` — Cancelled by user before triggering
- `paused` — Recurring schedule temporarily paused

### Status Lifecycle

**One-time schedule:**
```
Pending → Triggered → Completed
   │          │
   │          └→ Failed
   │
   └→ Cancelled
```

**Recurring schedule:**
```
Pending → Triggered → Pending (next_trigger_at updated) → ... → Completed (end date reached)
   │          │                                                       │
   │          └→ Failed                                              │
   │                                                                  │
   ├→ Paused → Pending (resumed)                                     │
   │                                                                  │
   └→ Cancelled ←─────────────────────────────────────────────────────┘
```

For recurring schedules, after each successful trigger the status returns to `pending` with an updated `next_trigger_at`. The schedule completes when `recurrence_end_at` is reached or the user cancels.

### Recurrence Rule

Simple string format for recurrence patterns:

| Rule | Meaning |
|------|---------|
| `daily` | Every day at the same time |
| `weekly:mon,wed,fri` | Every Monday, Wednesday, Friday |
| `monthly:15` | 15th of every month |
| `monthly:1,15` | 1st and 15th of every month |

The `scheduled_at` defines the first trigger time and the time-of-day for recurring triggers. `recurrence_end_at` is optional — if not set, the schedule recurs indefinitely until cancelled.

### Send Type: Single vs Group

| Field | Single | Group |
|-------|--------|-------|
| `delivery_address` | Required (phone, email, etc.) | Not used |
| `contact_id` | Optional (link to contact) | Not used |
| `contact_group_ids` | Not used | Required (list of group UUIDs) |
| `exclude_contact_ids` | Not used | Optional |
| **On trigger creates** | `Message` record | `GroupMessage` record |
| **Result stored in** | `message_id` | `group_message_id` |

### Auto-Template Creation

Same as Group Messages (BE-004): if `message_body` is provided instead of `template_id`, the system auto-creates a `Template` record with extracted variables. The request must provide **either** `template_id` **or** `message_body`, not both.

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/scheduled_message.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

### 2. Schemas (`src/schemas/scheduled_message.py`)
- [ ] `ScheduledMessageCreate` — name, channel_id, send_type, scheduled_at, timezone, is_recurring, recurrence_rule, recurrence_end_at, custom_values, metadata, **plus either `template_id` or `message_body`**, **plus recipient fields based on send_type**
- [ ] Add Pydantic `model_validator` to enforce:
  - Must provide `template_id` **or** `message_body`, not both, not neither
  - If `send_type` is `single`: `delivery_address` is required
  - If `send_type` is `group`: `contact_group_ids` is required
  - If `is_recurring` is `true`: `recurrence_rule` is required
- [ ] `ScheduledMessageUpdate` — name, channel_id, template_id, message_body, scheduled_at, timezone, is_recurring, recurrence_rule, recurrence_end_at, custom_values, metadata, status (all optional; only editable while `pending` or `paused`)
- [ ] `ScheduledMessageResponse` — all fields including trigger tracking (last_triggered_at, next_trigger_at, trigger_count) and result references (message_id, group_message_id)
- [ ] `ScheduledMessageListResponse` — list wrapper with total count
- [ ] Validate `send_type`, `status` against allowed enum values

### 3. Controller (`src/controllers/scheduled_message.py`)
- [ ] Extend `CRUDController` with `PostgresFilterStrategy` and `PostgresSortStrategy`
- [ ] Define `FilterSortConfig` (see filter table below)
- [ ] Define `SchemaConfig`
- [ ] Default filter: `account_id:in:{x-account-ids}`
- [ ] **Auto-template creation:** Override `create` — if `message_body` is provided, auto-create a `Template` record, then assign `template_id`
- [ ] **Compute `next_trigger_at`:** On create, set `next_trigger_at` = `scheduled_at`. For recurring schedules, recompute after each trigger.

### 4. Router (`src/routers/scheduled_message.py`)
- [ ] `POST /v1/scheduled-messages/` — Create a new scheduled message
- [ ] `GET /v1/scheduled-messages/` — List scheduled messages (filtered, sorted, paginated)
- [ ] `GET /v1/scheduled-messages/{id}` — Get single scheduled message by ID
- [ ] `PATCH /v1/scheduled-messages/{id}` — Update scheduled message (edit, cancel, pause, resume)
- [ ] `DELETE /v1/scheduled-messages/{id}` — Delete a scheduled message
- [ ] All endpoints require authentication

### 5. Register Router
- [ ] Add scheduled message router to `src/main.py`

### 6. Tests
- [ ] Create one-time single scheduled message
- [ ] Create one-time group scheduled message
- [ ] Create recurring scheduled message with `recurrence_rule`
- [ ] Create with `message_body` — verify auto-template creation
- [ ] Validation: `template_id` or `message_body` mutually exclusive
- [ ] Validation: `delivery_address` required for single, `contact_group_ids` required for group
- [ ] Validation: `recurrence_rule` required when `is_recurring` is true
- [ ] List with filters (status, send_type, is_recurring, channel_id)
- [ ] List with sorting and pagination
- [ ] Get by ID — verify trigger tracking fields
- [ ] Update (name, scheduled_at, recurrence_rule)
- [ ] Update status (pending → cancelled, pending → paused, paused → pending)
- [ ] Delete
- [ ] Account scoping
- [ ] Status and send_type validation rejects invalid values

---

## FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `channel_id` | `eq`, `in` | No |
| `template_id` | `eq` | No |
| `name` | `eq`, `contains`, `icontains` | Yes |
| `status` | `eq`, `in` | Yes |
| `send_type` | `eq` | No |
| `is_recurring` | `eq` | No |
| `created_by_user_id` | `eq` | No |
| `scheduled_at` | `ge`, `le`, `range` | Yes |
| `next_trigger_at` | `ge`, `le`, `range` | Yes |
| `last_triggered_at` | `ge`, `le`, `range` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Acceptance Criteria

- [ ] Scheduled messages table created via Alembic migration
- [ ] Full CRUD endpoints at `/v1/scheduled-messages/`
- [ ] Filtering, sorting, pagination working
- [ ] Account scoping via `x-account-ids` header
- [ ] Create accepts **either** `template_id` or `message_body` (validated, mutually exclusive)
- [ ] Auto-template creation when `message_body` is provided
- [ ] Recipient fields validated based on `send_type` (single vs group)
- [ ] Recurring schedules: `recurrence_rule` validated when `is_recurring` is true
- [ ] `next_trigger_at` computed on create
- [ ] JSONB fields accept contact_group_ids, exclude_contact_ids, custom_values, metadata
- [ ] Status validated against allowed enum values
- [ ] Tests passing with coverage threshold
- [ ] Ruff passes cleanly

---

## Dependencies

- Issue #1 (Core Architecture Components) — Done
- Issue #3 (Dual Database Support) — Done
- Channels (#9) — `channel_id` references channels table
- Templates (#10) — `template_id` references templates table (also used for auto-creation)
- Messages (#8) — `message_id` references created message (single sends)
- Group Messages (#11) — `group_message_id` references created group message (group sends)

---

## Note: Trigger Processing

This task covers only the **CRUD API** for scheduled messages (create, read, update, delete the scheduling configuration). The actual **trigger processing** — checking for due schedules, creating Message/GroupMessage records, updating `next_trigger_at` for recurring schedules — is a separate task that will be implemented as a background job processor.
