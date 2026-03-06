# RT-BE-001: Conversation Model + CRUD

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P0 — Foundation for all realtime features
**Phase:** 1 — Data Foundation
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 3.1](../../../TURUMBA_REALTIME_MESSAGING.md#31-conversations--messaging-api), [Section 9.1](../../../TURUMBA_REALTIME_MESSAGING.md#91-messaging-api--conversations)

---

## Summary

Implement the `Conversation` model with full CRUD endpoints in the Messaging API. This is the central record for every support thread — IM (WhatsApp, Telegram, etc.) and webchat alike. The model supports dual source via mutually exclusive `channel_id` / `chat_endpoint_id` foreign keys, a strict status lifecycle with enforced transitions, cross-service enrichment from the Account API, and event emission via the existing outbox pipeline.

---

## Database Model (`src/models/postgres/conversation.py`)

```python
from sqlalchemy import CheckConstraint, Column, DateTime, Index, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class Conversation(PostgresBaseModel):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint(
            "(channel_id IS NOT NULL AND chat_endpoint_id IS NULL) OR "
            "(channel_id IS NULL AND chat_endpoint_id IS NOT NULL)",
            name="ck_conversations_source_mutual_exclusion",
        ),
        CheckConstraint(
            "status IN ('open', 'assigned', 'pending', 'resolved', 'closed')",
            name="ck_conversations_status",
        ),
        CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'urgent')",
            name="ck_conversations_priority",
        ),
        Index("ix_conversations_inbox", "account_id", "status", "assignee_id"),
        Index(
            "ix_conversations_last_message",
            "account_id",
            postgresql_using="btree",
            postgresql_ops={"last_message_at": "DESC"},
        ),
        Index("ix_conversations_im_lookup", "account_id", "contact_id", "channel_id"),
        Index(
            "ix_conversations_webchat_lookup",
            "account_id",
            "contact_id",
            "chat_endpoint_id",
        ),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False)
    channel_id = Column(Uuid(as_uuid=True), nullable=True)         # FK -> channels (IM conversations)
    chat_endpoint_id = Column(Uuid(as_uuid=True), nullable=True)   # FK -> chat_endpoints (webchat)
    contact_id = Column(Uuid(as_uuid=True), nullable=False)        # Account API contact reference
    contact_identifier = Column(String(255), nullable=False)       # phone, telegram user_id, email, visitor_id

    assignee_id = Column(Uuid(as_uuid=True), nullable=True)        # current agent (user_id from Account API)
    team_id = Column(Uuid(as_uuid=True), nullable=True)            # assigned team (Account API)

    status = Column(String(20), nullable=False, default="open")
    priority = Column(String(10), nullable=False, default="normal")
    subject = Column(String(255), nullable=True)
    labels = Column(JSONB, nullable=True, default=list)

    first_reply_at = Column(DateTime(timezone=True), nullable=True)   # SLA: first agent reply
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    last_message_at = Column(DateTime(timezone=True), nullable=True)  # drives inbox sort

    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)
```

**Critical details:**

- `channel_id` is **nullable** — set for IM conversations (WhatsApp, Telegram, etc.)
- `chat_endpoint_id` is **nullable** — set for webchat conversations
- The CHECK constraint enforces that **exactly one** of the two must be NOT NULL (mutual exclusion)
- There is NO `"bot"` status. Valid statuses: `open`, `assigned`, `pending`, `resolved`, `closed`
- Re-export in `src/models/postgres/__init__.py` for Alembic detection

### Indexes (4 total)

| Index | Columns | Purpose |
|-------|---------|---------|
| `ix_conversations_inbox` | `account_id, status, assignee_id` | Inbox queries |
| `ix_conversations_last_message` | `account_id, last_message_at DESC` | Sorted inbox |
| `ix_conversations_im_lookup` | `account_id, contact_id, channel_id` | Find existing IM conversation |
| `ix_conversations_webchat_lookup` | `account_id, contact_id, chat_endpoint_id` | Find existing webchat conversation |

---

## Status Lifecycle

```
open --> assigned --> pending --> resolved --> closed
  |       ^    |         |           |
  +-------+    +---------+           |
  (manual      (agent sets pending   |
   assign)      waiting for reply)   |
                                     |
  Customer sends new message after resolved --+--> reopens as "open"
```

### Valid Transitions (enforce in controller update method)

| From | Allowed To |
|------|-----------|
| `open` | `assigned`, `closed` |
| `assigned` | `pending`, `resolved`, `closed` |
| `pending` | `assigned`, `resolved`, `closed` |
| `resolved` | `open` (reopen), `closed` |
| `closed` | terminal — return 400 |

Implementation: define a `VALID_TRANSITIONS` dict in the controller. Before applying a status update, check that the current status allows the transition. Return 400 with a descriptive message on invalid transitions.

```python
VALID_TRANSITIONS: dict[str, set[str]] = {
    "open": {"assigned", "closed"},
    "assigned": {"pending", "resolved", "closed"},
    "pending": {"assigned", "resolved", "closed"},
    "resolved": {"open", "closed"},
    "closed": set(),  # terminal
}
```

**Side effects on status change:**

- Transition to `resolved` -> auto-set `resolved_at = datetime.now(UTC)` if not already set
- Transition to `assigned` with `assignee_id` provided -> emit `conversation.assigned` event
- Any status change -> emit `conversation.status_changed` event

---

## Schemas (`src/schemas/conversation.py`)

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator


class ConversationCreate(BaseModel):
    channel_id: UUID | None = None
    chat_endpoint_id: UUID | None = None
    contact_id: UUID
    contact_identifier: str
    assignee_id: UUID | None = None
    team_id: UUID | None = None
    status: str = "open"
    priority: str = "normal"
    subject: str | None = None
    labels: list[str] | None = None
    metadata: dict | None = None

    @model_validator(mode="after")
    def validate_source_mutual_exclusion(self):
        if bool(self.channel_id) == bool(self.chat_endpoint_id):
            msg = "Exactly one of channel_id or chat_endpoint_id must be provided"
            raise ValueError(msg)
        return self


class ConversationUpdate(BaseModel):
    assignee_id: UUID | None = None
    team_id: UUID | None = None
    status: str | None = None
    priority: str | None = None
    subject: str | None = None
    labels: list[str] | None = None
    first_reply_at: datetime | None = None
    resolved_at: datetime | None = None
    last_message_at: datetime | None = None
    metadata: dict | None = None


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    channel_id: UUID | None
    chat_endpoint_id: UUID | None
    contact_id: UUID
    contact_identifier: str
    assignee_id: UUID | None
    team_id: UUID | None
    status: str
    priority: str
    subject: str | None
    labels: list[str] | None
    first_reply_at: datetime | None
    resolved_at: datetime | None
    last_message_at: datetime | None
    metadata: dict | None
    created_at: datetime
    updated_at: datetime

    # Enriched fields (populated from Account API, nullable)
    contact: dict | None = None
    assignee: dict | None = None
    team: dict | None = None
```

**Schema notes:**

- `ConversationCreate` has a model validator enforcing mutual exclusion at the API level (in addition to the DB CHECK constraint)
- `ConversationResponse` includes enriched fields (`contact`, `assignee`, `team`) populated from the Account API — default to `None` if enrichment fails
- Use `validation_alias="metadata_"` pattern from existing models for the metadata field

---

## Controller (`src/controllers/conversation.py`)

Extend `CRUDController[Conversation, ConversationCreate, ConversationUpdate, ConversationResponse]`.

**Key behaviors:**

1. **Default filter:** `account_id:in:{x-account-ids}` (tenant isolation via gateway header)
2. **Status transition validation** in the update method — check `VALID_TRANSITIONS` before applying
3. **Side effects on status change:**
   - `resolved` -> set `resolved_at = datetime.now(UTC)`
   - `assigned` with `assignee_id` -> emit `conversation.assigned` event
   - Any status change -> emit `conversation.status_changed` event
4. **Cross-service enrichment** in response serialization (see section below)

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `channel_id` | `eq`, `in` | No |
| `chat_endpoint_id` | `eq`, `in` | No |
| `contact_id` | `eq` | No |
| `contact_identifier` | `eq`, `contains` | No |
| `assignee_id` | `eq`, `is_null` | No |
| `team_id` | `eq`, `is_null` | No |
| `status` | `eq`, `in` | No |
| `priority` | `eq`, `in` | Yes |
| `labels` | `contains` | No |
| `last_message_at` | `ge`, `le`, `range` | Yes |
| `first_reply_at` | `ge`, `le`, `range`, `is_null` | Yes |
| `resolved_at` | `ge`, `le`, `range`, `is_null` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |

**Default sort:** `last_message_at:desc` (most recently active conversations first in inbox)

---

## Cross-Service Enrichment

Use the existing `AccountApiClient` (same pattern as message enrichment) to populate:

| Response Field | Source | Data Fetched |
|---------------|--------|-------------|
| `contact` | Account API `/contacts/{id}` | `name`, `phone`, `email` |
| `assignee` | Account API `/users/{id}` | `name`, `email` |
| `team` | Account API `/teams/{id}` | `name` |

**For list endpoints:** batch-fetch unique IDs to avoid N+1 HTTP calls. Collect all unique `contact_id`, `assignee_id`, and `team_id` values from the result set, fetch each set in one batch call, then map back to individual responses.

**On failure:** enrichment failures are silent — fields default to `null`. This matches the existing pattern in the Messaging API.

---

## Router (`src/routers/conversation.py`)

```
POST   /v1/conversations/          -- Create
GET    /v1/conversations/          -- List (inbox view, filtered/sorted/paginated)
GET    /v1/conversations/{id}      -- Get by ID
PATCH  /v1/conversations/{id}      -- Update (status, assignee, labels, priority)
DELETE /v1/conversations/{id}      -- Soft-close (set status to closed, return 204)
```

Use `create_crud_routes` or manual route definitions — either is fine as long as `set_header_context()` and `set_current_user()` are called.

Register in `src/main.py`.

---

## Event Types

Add to `src/events/event_types.py`:

```python
CONVERSATION_CREATED = "conversation.created"
CONVERSATION_ASSIGNED = "conversation.assigned"
CONVERSATION_STATUS_CHANGED = "conversation.status_changed"
CONVERSATION_RESOLVED = "conversation.resolved"
```

Wire to existing outbox pipeline:

- **On create:** emit `conversation.created` with `{ conversation_id, account_id, channel_id, chat_endpoint_id, contact_id, status }`
- **On assignment:** emit `conversation.assigned` with `{ conversation_id, assignee_id, team_id, assigned_by }`
- **On status change:** emit `conversation.status_changed` with `{ conversation_id, old_status, new_status }`
- **On resolved:** emit `conversation.resolved` with `{ conversation_id, resolved_at, first_reply_at }`

Follow the same router-level pattern from BE-007: `EventBus` injected via `Depends`, events emitted after controller returns, `OutboxMiddleware.flush()` -> `db.commit()` -> `send_pg_notify()`.

---

## Alembic Migration

Generate with: `alembic revision --autogenerate -m "add conversations table"`

Verify the migration includes:
- All columns with correct types and nullability
- Both CHECK constraints (`ck_conversations_source_mutual_exclusion`, `ck_conversations_status`, `ck_conversations_priority`)
- All 4 indexes
- Proper downgrade (drop table)

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/conversation.py` with all fields, CHECK constraints, and indexes
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Generate Alembic migration
- [ ] Verify migration applies cleanly: `alembic upgrade head`

### 2. Schemas
- [ ] Create `src/schemas/conversation.py` with `ConversationCreate`, `ConversationUpdate`, `ConversationResponse`
- [ ] Implement mutual exclusion validator on `ConversationCreate`
- [ ] Include enriched fields (`contact`, `assignee`, `team`) in response schema

### 3. Service Layer
- [ ] Create `src/services/conversation/` directory
- [ ] Implement `ConversationCreationService`
- [ ] Implement `ConversationRetrievalService`
- [ ] Implement `ConversationUpdateService`

### 4. Controller
- [ ] Create `src/controllers/conversation.py` extending `CRUDController`
- [ ] Define `_FILTER_SORT_CONFIG` with all allowed filters and sorts
- [ ] Define `_SCHEMA_CONFIG` with field permissions
- [ ] Implement `VALID_TRANSITIONS` dict and status transition validation in update method
- [ ] Implement side effects: `resolved_at` auto-set, event emission on status changes
- [ ] Implement cross-service enrichment via `AccountApiClient` (single + batch)

### 5. Router
- [ ] Create `src/routers/conversation.py`
- [ ] Register all CRUD endpoints
- [ ] Wire `EventBus` injection for create and update routes
- [ ] Implement outbox flush + commit + pg_notify pattern
- [ ] Register router in `src/main.py`

### 6. Event Types
- [ ] Add 4 event types to `src/events/event_types.py`
- [ ] Wire conversation creation to emit `conversation.created`
- [ ] Wire status changes to emit `conversation.status_changed`
- [ ] Wire assignment to emit `conversation.assigned`
- [ ] Wire resolved status to emit `conversation.resolved`

### 7. Tests
- [ ] Conversation: create with `channel_id` (IM), verify `chat_endpoint_id` is null
- [ ] Conversation: create with `chat_endpoint_id` (webchat), verify `channel_id` is null
- [ ] Conversation: create with both `channel_id` and `chat_endpoint_id` -> 422 validation error
- [ ] Conversation: create with neither -> 422 validation error
- [ ] Conversation: list with inbox filters (`status`, `assignee_id`, `team_id`, `priority`)
- [ ] Conversation: sort by `last_message_at` DESC
- [ ] Conversation: valid status transitions (all allowed paths)
- [ ] Conversation: invalid status transitions -> 400
- [ ] Conversation: `closed` is terminal -> 400 on any update
- [ ] Conversation: `resolved_at` auto-set when transitioning to resolved
- [ ] Conversation: account scoping via `x-account-ids`
- [ ] Conversation: delete -> soft-close (status set to closed, 204)

---

## Acceptance Criteria

- [ ] `conversations` table created via Alembic with CHECK constraints and all 4 indexes
- [ ] Mutual exclusion of `channel_id` / `chat_endpoint_id` enforced at DB and schema level
- [ ] Status transitions enforced — invalid transitions return 400 with descriptive error
- [ ] No `"bot"` status exists anywhere in the model or validation
- [ ] Full CRUD at `/v1/conversations/` with filtering, sorting, pagination
- [ ] Cross-service enrichment populates `contact`, `assignee`, `team` from Account API
- [ ] List endpoint batch-fetches unique IDs (no N+1 HTTP calls)
- [ ] Conversation events emitted via outbox pipeline
- [ ] Account scoping enforced on all endpoints
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

None — this is the conversation foundation.

## Blocks

- **RT-BE-002** (ConversationConfig) — can proceed in parallel but configs reference conversations conceptually
- **RT-BE-003** (ChatEndpoints) — `chat_endpoint_id` FK target
- **RT-BE-004** (Message Extensions) — needs Conversation model for `conversation_id` FK
