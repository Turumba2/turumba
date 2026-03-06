# CONV-BE-001: Conversation + ContactIdentifier + CannedResponse Models & CRUD

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P0 — Foundation for all conversation features
**Phase:** 1 — Conversation Foundation
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Implement the conversation foundation in the Messaging API: three new models (`Conversation`, `ContactIdentifier`, `CannedResponse`) with full CRUD endpoints, plus conversation event types wired to the outbox pipeline. This establishes the data layer for the entire customer support feature — all subsequent tasks depend on this.

---

## Part 1: Conversation Model

### Database Model (`src/models/postgres/conversation.py`)

```python
from sqlalchemy import CheckConstraint, Column, DateTime, Index, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class Conversation(PostgresBaseModel):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'bot', 'assigned', 'pending', 'resolved', 'closed')",
            name="ck_conversations_status",
        ),
        CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'urgent')",
            name="ck_conversations_priority",
        ),
        Index("ix_conversations_inbox", "account_id", "status", "assignee_id"),
        Index("ix_conversations_last_message", "account_id", "last_message_at"),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    channel_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    contact_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    contact_identifier = Column(String(255), nullable=False)

    assignee_id = Column(Uuid(as_uuid=True), nullable=True, index=True)
    team_id = Column(Uuid(as_uuid=True), nullable=True, index=True)

    status = Column(String(20), nullable=False, default="open", index=True)
    priority = Column(String(10), nullable=False, default="normal")
    subject = Column(String(255), nullable=True)
    labels = Column(JSONB, nullable=True, default=list)

    first_reply_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    last_message_at = Column(DateTime(timezone=True), nullable=True)

    bot_context = Column(JSONB, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)
```

Re-export in `src/models/postgres/__init__.py` for Alembic.

### Status Lifecycle

```
open ──→ bot ──→ assigned ──→ pending ──→ resolved ──→ closed
  │              ↑    │         │           │
  │              │    └─────────┘           │
  └──────────────┘                          │
                   Customer msg after resolved ──→ reopens as "open"
```

Valid transitions (enforce in controller update method):
- `open` → `bot`, `assigned`, `closed`
- `bot` → `assigned`, `closed`
- `assigned` → `pending`, `resolved`, `closed`
- `pending` → `assigned`, `resolved`, `closed`
- `resolved` → `open` (reopen), `closed`
- `closed` → terminal (return 400)

### Schemas (`src/schemas/conversation.py`)

```python
class ConversationCreate(BaseModel):
    channel_id: UUID
    contact_id: UUID
    contact_identifier: str
    assignee_id: UUID | None = None
    team_id: UUID | None = None
    status: str = "open"
    priority: str = "normal"
    subject: str | None = None
    labels: list[str] | None = None
    metadata: dict | None = None

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
    bot_context: dict | None = None
    metadata: dict | None = None

class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    channel_id: UUID
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
    bot_context: dict | None
    metadata: dict | None
    created_at: datetime
    updated_at: datetime
```

### Controller (`src/controllers/conversation.py`)

Extend `CRUDController[Conversation, ConversationCreate, ConversationUpdate, ConversationResponse]`.

- Default filter: `account_id:in:{x-account-ids}` (tenant isolation)
- Status transition validation in the update method (return 400 on invalid transitions)
- On status change to `resolved` → auto-set `resolved_at = now()`
- On status change to `assigned` with `assignee_id` → emit `conversation.assigned` event

### Router (`src/routers/conversation.py`)

```
POST   /v1/conversations/          — Create
GET    /v1/conversations/          — List (inbox view, filtered/sorted/paginated)
GET    /v1/conversations/{id}      — Get by ID
PATCH  /v1/conversations/{id}      — Update (status, assignee, labels, priority)
DELETE /v1/conversations/{id}      — Soft-close (set status to closed)
```

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `channel_id` | `eq`, `in` | No |
| `contact_id` | `eq` | No |
| `contact_identifier` | `eq`, `contains` | No |
| `assignee_id` | `eq`, `is_null` | No |
| `team_id` | `eq`, `is_null` | No |
| `status` | `eq`, `in` | Yes |
| `priority` | `eq`, `in` | Yes |
| `labels` | `contains` | No |
| `last_message_at` | `ge`, `le`, `range` | Yes |
| `first_reply_at` | `ge`, `le`, `range`, `is_null` | Yes |
| `resolved_at` | `ge`, `le`, `range`, `is_null` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Part 2: ContactIdentifier Model

### Database Model (`src/models/postgres/contact_identifier.py`)

```python
from sqlalchemy import CheckConstraint, Column, String, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class ContactIdentifier(PostgresBaseModel):
    __tablename__ = "contact_identifiers"
    __table_args__ = (
        CheckConstraint(
            "channel_type IN ('telegram', 'whatsapp', 'messenger', 'sms', 'smpp', 'email')",
            name="ck_contact_identifiers_channel_type",
        ),
        UniqueConstraint(
            "account_id", "channel_type", "identifier",
            name="uq_contact_identifiers_lookup",
        ),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    contact_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    channel_type = Column(String(20), nullable=False)
    identifier = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)
```

### Schemas, Controller, Router

Follow standard 8-step entity pattern. Default filter: `account_id:in:{x-account-ids}`.

```
POST   /v1/contact-identifiers/
GET    /v1/contact-identifiers/
GET    /v1/contact-identifiers/{id}
PATCH  /v1/contact-identifiers/{id}
DELETE /v1/contact-identifiers/{id}
```

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `contact_id` | `eq` | No |
| `channel_type` | `eq`, `in` | No |
| `identifier` | `eq`, `contains` | No |
| `display_name` | `eq`, `contains`, `icontains` | No |
| `created_at` | `ge`, `le`, `range` | Yes |

---

## Part 3: CannedResponse Model

### Database Model (`src/models/postgres/canned_response.py`)

```python
from sqlalchemy import Column, String, Text, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class CannedResponse(PostgresBaseModel):
    __tablename__ = "canned_responses"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "short_code",
            name="uq_canned_responses_short_code",
        ),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    short_code = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String(100), nullable=True)
    created_by = Column(Uuid(as_uuid=True), nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)
```

### Schemas, Controller, Router

Follow standard pattern. Default filter: `account_id:in:{x-account-ids}`. Auto-set `created_by` from authenticated user context.

```
POST   /v1/canned-responses/
GET    /v1/canned-responses/
GET    /v1/canned-responses/{id}
PATCH  /v1/canned-responses/{id}
DELETE /v1/canned-responses/{id}
```

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `short_code` | `eq`, `contains` | Yes |
| `title` | `eq`, `contains`, `icontains` | Yes |
| `category` | `eq`, `in` | Yes |
| `created_by` | `eq` | No |
| `created_at` | `ge`, `le`, `range` | Yes |

---

## Part 4: Event Types

Add to `src/events/event_types.py`:

```python
CONVERSATION_CREATED = "conversation.created"
CONVERSATION_ASSIGNED = "conversation.assigned"
CONVERSATION_STATUS_CHANGED = "conversation.status_changed"
CONVERSATION_RESOLVED = "conversation.resolved"
CONVERSATION_MESSAGE_CREATED = "conversation.message.created"
CONVERSATION_MESSAGE_SENT = "conversation.message.sent"
```

Wire conversation status changes and creation to emit events via the existing outbox pipeline (EventBus → OutboxMiddleware → outbox_events table → outbox_worker → RabbitMQ).

---

## Tasks

### 1. Conversation Model & CRUD
- [ ] Create `src/models/postgres/conversation.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas in `src/schemas/conversation.py`
- [ ] Create service classes in `src/services/conversation/`
- [ ] Create controller in `src/controllers/conversation.py` with status transition validation
- [ ] Create router in `src/routers/conversation.py`
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

### 2. ContactIdentifier Model & CRUD
- [ ] Create `src/models/postgres/contact_identifier.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas, service, controller, router (standard pattern)
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration

### 3. CannedResponse Model & CRUD
- [ ] Create `src/models/postgres/canned_response.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas, service, controller, router (standard pattern)
- [ ] Auto-set `created_by` from authenticated user context
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration

### 4. Event Types
- [ ] Add conversation event types to `src/events/event_types.py`
- [ ] Wire conversation creation to emit `conversation.created` via outbox
- [ ] Wire conversation status changes to emit appropriate events
- [ ] Wire conversation assignment to emit `conversation.assigned`

### 5. Tests
- [ ] Conversation: create, list with filters, get by ID, update status, delete
- [ ] Conversation: status transition validation (valid and invalid)
- [ ] Conversation: account scoping via `x-account-ids`
- [ ] Conversation: inbox queries (by status, assignee, channel, priority)
- [ ] ContactIdentifier: CRUD + unique constraint (account + channel_type + identifier)
- [ ] CannedResponse: CRUD + unique constraint (account + short_code)
- [ ] CannedResponse: filter by category, search by title

---

## Acceptance Criteria

- [ ] `conversations` table created via Alembic with all indexes and check constraints
- [ ] Conversation status transitions enforced (invalid transitions return 400)
- [ ] Full CRUD at `/v1/conversations/` with filtering, sorting, pagination
- [ ] `contact_identifiers` table with unique constraint on (account, channel_type, identifier)
- [ ] `canned_responses` table with unique constraint on (account, short_code)
- [ ] Conversation events emitted via outbox pipeline
- [ ] Account scoping enforced on all new endpoints
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

None — this is the conversation foundation.

## Blocks

- **CONV-BE-002** (Message Extensions) — needs Conversation model
- **CONV-BE-004** (Bot Rules) — needs Conversation model
- **CONV-BE-005** (Inbound Flow) — needs all models
- **CONV-BE-006** (Realtime Push Worker) — needs event types
- **CONV-GW-001** (Gateway Routes) — needs endpoints defined
