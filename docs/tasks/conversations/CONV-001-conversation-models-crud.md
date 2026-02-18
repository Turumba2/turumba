# CONV-001: Conversation Models & CRUD

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P0 — Foundation for all conversation features
**Feature Area:** Customer Support — Conversations
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Implement the conversation foundation in the Messaging API: the `Conversation`, `ContactIdentifier`, and `CannedResponse` models with full CRUD, plus extend the existing `Message` model with conversation-aware columns. This establishes the data layer for the entire customer support feature — all subsequent tasks (bot routing, real-time, frontend inbox) depend on this.

**Scope:**
- `Conversation` model + full CRUD + status lifecycle
- `ContactIdentifier` model + full CRUD (cross-platform contact resolution)
- `CannedResponse` model + full CRUD (agent quick replies)
- Extend existing `Message` model with `conversation_id`, `is_private`, `sender_type`, `sender_id`
- Nested endpoint: `POST/GET /v1/conversations/{id}/messages`
- Gateway route configuration for all new endpoints

---

## Part 1: Conversation Model

### Database Model (`src/models/postgres/conversation.py`)

```python
from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Index

from src.models.postgres.base import PostgresBaseModel


class Conversation(PostgresBaseModel):
    """Omnichannel customer support conversation thread."""

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
    metadata_ = Column(
        "metadata", JSONB, nullable=True, default=dict,
    )
```

### Status Lifecycle

```
open ──→ bot ──→ assigned ──→ pending ──→ resolved ──→ closed
  │              ↑    │         │           │
  │              │    └─────────┘           │
  └──────────────┘    (agent sets pending   │
  (if no bot rules    while waiting for     │
   or direct assign)  customer reply)       │
                                            │
  Customer sends new message after resolved ─┘──→ reopens as "open"
```

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
- Status transition validation in the update method:
  - `open` → `bot`, `assigned`, `closed`
  - `bot` → `assigned`, `closed`
  - `assigned` → `pending`, `resolved`, `closed`
  - `pending` → `assigned`, `resolved`, `closed`
  - `resolved` → `open` (reopen), `closed`
  - `closed` → no transitions (terminal)
- On status change to `resolved` → auto-set `resolved_at = now()`
- On status change to `assigned` with `assignee_id` → emit `conversation.assigned` event

### Router (`src/routers/conversation.py`)

```
POST   /v1/conversations/          — Create conversation
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

## Part 2: Extend Message Model

### New Columns on Existing `messages` Table

Add via Alembic migration (all nullable — existing broadcast messages are unaffected):

```python
# Add to src/models/postgres/message.py
conversation_id = Column(Uuid(as_uuid=True), nullable=True, index=True)
is_private = Column(Boolean, nullable=False, default=False)
sender_type = Column(String(20), nullable=True)   # "contact", "agent", "bot", "system"
sender_id = Column(Uuid(as_uuid=True), nullable=True)
```

Update the existing `CheckConstraint` for direction to remain unchanged. Add a new constraint:

```python
CheckConstraint(
    "sender_type IS NULL OR sender_type IN ('contact', 'agent', 'bot', 'system')",
    name="ck_messages_sender_type",
),
```

### Update Message Schemas

Add to `MessageCreate`:
- `conversation_id: UUID | None = None`
- `is_private: bool = False`
- `sender_type: str | None = None`
- `sender_id: UUID | None = None`

Add to `MessageUpdate`:
- `is_private: bool | None = None`

Add to `MessageResponse`:
- `conversation_id: UUID | None`
- `is_private: bool`
- `sender_type: str | None`
- `sender_id: UUID | None`

### Update Message FilterSortConfig

Add new filter fields:
- `conversation_id` — `eq`
- `is_private` — `eq`
- `sender_type` — `eq`, `in`
- `sender_id` — `eq`

### Nested Conversation Messages Endpoint

```
POST   /v1/conversations/{conversation_id}/messages    — Create message within conversation
GET    /v1/conversations/{conversation_id}/messages    — List messages in conversation (paginated)
```

The `POST` endpoint:
- Auto-sets `conversation_id` from path parameter
- Auto-sets `account_id` from header context
- Auto-sets `channel_id` from the parent conversation
- Validates that the conversation exists and belongs to the user's account
- Updates `conversation.last_message_at` on each new message
- If `is_private = true`, the message is NOT dispatched (internal note)
- If `sender_type = "agent"` and this is the first agent reply, set `conversation.first_reply_at`
- Emits `conversation.message.created` event via outbox

The `GET` endpoint:
- Returns messages filtered by `conversation_id` (auto-applied)
- Supports pagination (default sort: `created_at:asc` — chronological)
- If the requesting user is not an agent (future: customer widget), exclude `is_private = true` messages

---

## Part 3: ContactIdentifier Model

### Database Model (`src/models/postgres/contact_identifier.py`)

```python
from sqlalchemy import CheckConstraint, Column, String, Uuid, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class ContactIdentifier(PostgresBaseModel):
    """Maps platform-specific identifiers to contacts for cross-channel resolution."""

    __tablename__ = "contact_identifiers"
    __table_args__ = (
        CheckConstraint(
            "channel_type IN ('telegram', 'whatsapp', 'messenger', 'sms', 'smpp', 'email')",
            name="ck_contact_identifiers_channel_type",
        ),
        UniqueConstraint("account_id", "channel_type", "identifier",
                         name="uq_contact_identifiers_lookup"),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    contact_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    channel_type = Column(String(20), nullable=False)
    identifier = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)
    metadata_ = Column(
        "metadata", JSONB, nullable=True, default=dict,
    )
```

### Schemas (`src/schemas/contact_identifier.py`)

```python
class ContactIdentifierCreate(BaseModel):
    contact_id: UUID
    channel_type: str
    identifier: str
    display_name: str | None = None
    metadata: dict | None = None

class ContactIdentifierUpdate(BaseModel):
    contact_id: UUID | None = None
    display_name: str | None = None
    metadata: dict | None = None

class ContactIdentifierResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    contact_id: UUID
    channel_type: str
    identifier: str
    display_name: str | None
    metadata: dict | None
    created_at: datetime
    updated_at: datetime
```

### Controller + Router

Follow standard pattern. Default filter: `account_id:in:{x-account-ids}`.

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

## Part 4: CannedResponse Model

### Database Model (`src/models/postgres/canned_response.py`)

```python
from sqlalchemy import Column, String, Text, Uuid, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class CannedResponse(PostgresBaseModel):
    """Pre-saved reply snippets for agent quick replies."""

    __tablename__ = "canned_responses"
    __table_args__ = (
        UniqueConstraint("account_id", "short_code", name="uq_canned_responses_short_code"),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    short_code = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    category = Column(String(100), nullable=True)
    created_by = Column(Uuid(as_uuid=True), nullable=True)
    metadata_ = Column(
        "metadata", JSONB, nullable=True, default=dict,
    )
```

### Schemas (`src/schemas/canned_response.py`)

```python
class CannedResponseCreate(BaseModel):
    short_code: str
    title: str
    content: str
    category: str | None = None
    metadata: dict | None = None

class CannedResponseUpdate(BaseModel):
    short_code: str | None = None
    title: str | None = None
    content: str | None = None
    category: str | None = None
    metadata: dict | None = None

class CannedResponseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    short_code: str
    title: str
    content: str
    category: str | None
    created_by: UUID | None
    metadata: dict | None
    created_at: datetime
    updated_at: datetime
```

### Controller + Router

Follow standard pattern. Default filter: `account_id:in:{x-account-ids}`.

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

## Part 5: Event Types

Add new conversation event types to `src/events/event_types.py` (or equivalent):

```python
# Conversation events
CONVERSATION_CREATED = "conversation.created"
CONVERSATION_ASSIGNED = "conversation.assigned"
CONVERSATION_STATUS_CHANGED = "conversation.status_changed"
CONVERSATION_RESOLVED = "conversation.resolved"
CONVERSATION_MESSAGE_CREATED = "conversation.message.created"
CONVERSATION_MESSAGE_SENT = "conversation.message.sent"
```

These events flow through the existing outbox → RabbitMQ pipeline. The `turumba_realtime` service (CONV-004) will consume them.

---

## Part 6: Gateway Routes

Add endpoint definitions in `turumba_gateway/config/partials/endpoints/`:

### `conversations.json`

```
POST   /v1/conversations/
GET    /v1/conversations/
GET    /v1/conversations/{id}
PATCH  /v1/conversations/{id}
DELETE /v1/conversations/{id}
POST   /v1/conversations/{id}/messages
GET    /v1/conversations/{id}/messages
```

### `contact-identifiers.json`

```
POST   /v1/contact-identifiers/
GET    /v1/contact-identifiers/
GET    /v1/contact-identifiers/{id}
PATCH  /v1/contact-identifiers/{id}
DELETE /v1/contact-identifiers/{id}
```

### `canned-responses.json`

```
POST   /v1/canned-responses/
GET    /v1/canned-responses/
GET    /v1/canned-responses/{id}
PATCH  /v1/canned-responses/{id}
DELETE /v1/canned-responses/{id}
```

All routes target `gt_turumba_messaging_api:8000` with `no-op` encoding and require authentication (context enrichment plugin enabled).

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

### 2. Extend Message Model
- [ ] Add `conversation_id`, `is_private`, `sender_type`, `sender_id` columns to `Message`
- [ ] Add `ck_messages_sender_type` check constraint
- [ ] Update `MessageCreate`, `MessageUpdate`, `MessageResponse` schemas
- [ ] Update `Message` controller `FilterSortConfig` with new fields
- [ ] Create Alembic migration for the new columns
- [ ] Verify existing message tests still pass (no regressions)

### 3. Conversation Messages Nested Endpoint
- [ ] Create `POST /v1/conversations/{conversation_id}/messages` in conversation router
- [ ] Create `GET /v1/conversations/{conversation_id}/messages` in conversation router
- [ ] Auto-set `conversation_id`, `account_id`, `channel_id` from context
- [ ] Validate conversation exists and belongs to user's account
- [ ] Update `conversation.last_message_at` on new message
- [ ] Set `conversation.first_reply_at` on first agent reply
- [ ] Emit `conversation.message.created` event via outbox
- [ ] Filter `is_private` messages based on requesting user role (future)

### 4. ContactIdentifier Model & CRUD
- [ ] Create `src/models/postgres/contact_identifier.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas in `src/schemas/contact_identifier.py`
- [ ] Create service, controller, router (standard pattern)
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration

### 5. CannedResponse Model & CRUD
- [ ] Create `src/models/postgres/canned_response.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas in `src/schemas/canned_response.py`
- [ ] Create service, controller, router (standard pattern)
- [ ] Auto-set `created_by` from authenticated user context
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration

### 6. Event Types
- [ ] Add conversation event types to the event type definitions
- [ ] Wire conversation status changes to emit outbox events
- [ ] Wire conversation message creation to emit outbox events

### 7. Gateway Routes
- [ ] Create `config/partials/endpoints/conversations.json`
- [ ] Create `config/partials/endpoints/contact-identifiers.json`
- [ ] Create `config/partials/endpoints/canned-responses.json`
- [ ] Import new partials in `config/krakend.tmpl`
- [ ] Add to context enrichment plugin whitelist if needed

### 8. Tests
- [ ] Conversation: create, list with filters, get by ID, update status, delete
- [ ] Conversation: status transition validation (valid and invalid transitions)
- [ ] Conversation: account scoping via `x-account-ids`
- [ ] Conversation: inbox queries (by status, assignee, channel, priority)
- [ ] Conversation Messages: create within conversation, list chronologically
- [ ] Conversation Messages: `first_reply_at` set on first agent reply
- [ ] Conversation Messages: `last_message_at` updated on each message
- [ ] Conversation Messages: `is_private` messages excluded for non-agents
- [ ] ContactIdentifier: create, list, get, update, delete
- [ ] ContactIdentifier: unique constraint (account + channel_type + identifier)
- [ ] CannedResponse: create, list, get, update, delete
- [ ] CannedResponse: unique constraint (account + short_code)
- [ ] CannedResponse: filter by category, search by title
- [ ] Message model: new columns nullable, existing tests unaffected

---

## Acceptance Criteria

- [ ] `conversations` table created via Alembic migration with all indexes
- [ ] Conversation status transitions enforced (invalid transitions return 400)
- [ ] Full CRUD endpoints at `/v1/conversations/` with filtering, sorting, pagination
- [ ] Nested messages endpoint at `/v1/conversations/{id}/messages` works
- [ ] `conversation.last_message_at` updated on every new message
- [ ] `conversation.first_reply_at` set on first agent reply
- [ ] Existing Message CRUD unaffected (all `conversation_id` columns nullable)
- [ ] `contact_identifiers` table with unique constraint on (account, channel_type, identifier)
- [ ] `canned_responses` table with unique constraint on (account, short_code)
- [ ] Conversation events emitted via outbox (conversation.created, conversation.assigned, etc.)
- [ ] Gateway routes configured and functional
- [ ] Account scoping enforced on all new endpoints
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

- None (this is the conversation foundation)

## Blocks

- **CONV-003** (Bot Router) — needs Conversation and ContactIdentifier models
- **CONV-004** (Real-Time Service) — needs conversation event types
- All frontend conversation tasks
