# RT-BE-004: Message Model Extensions + Conversation Messages Endpoint

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P0 — Links messages to conversations
**Phase:** 1 — Data Foundation
**Depends On:** RT-BE-001 (Conversation model must exist for FK)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 3.2](../../../TURUMBA_REALTIME_MESSAGING.md#32-messages--extended-columns), [Section 9.1](../../../TURUMBA_REALTIME_MESSAGING.md#91-messaging-api--conversations)

---

## Summary

Extend the existing `Message` model with 5 new nullable columns that link messages to conversations and support the realtime messaging features (sender tracking, private notes). Then implement nested conversation message endpoints for agents to send replies and view message history within a conversation.

**Critical migration note:** This task also makes the existing `channel_id` column on `messages` **nullable** — webchat messages come through `chat_endpoints`, not `channels`. This is a data migration that affects existing rows (all existing rows already have `channel_id` set, so no data is lost).

---

## Part 1: Message Model Extensions

### New Columns (add to existing `Message` model)

Add these 5 columns to `src/models/postgres/message.py`:

```python
# --- New columns for realtime conversations ---

conversation_id = Column(
    Uuid(as_uuid=True),
    ForeignKey("conversations.id", ondelete="SET NULL"),
    nullable=True,
    index=True,
)
chat_endpoint_id = Column(
    Uuid(as_uuid=True),
    ForeignKey("chat_endpoints.id", ondelete="SET NULL"),
    nullable=True,
)
is_private = Column(Boolean, nullable=False, default=False)    # internal notes
sender_type = Column(
    String(20),
    nullable=True,
)
# CHECK constraint: sender_type IN ('contact', 'agent', 'system')
sender_id = Column(Uuid(as_uuid=True), nullable=True)          # agent user_id
```

Add CHECK constraint in `__table_args__`:

```python
CheckConstraint(
    "sender_type IS NULL OR sender_type IN ('contact', 'agent', 'system')",
    name="ck_messages_sender_type",
),
```

### Make `channel_id` NULLABLE

The existing `channel_id` column must be changed from `NOT NULL` to **nullable**:

```python
# BEFORE:
channel_id = Column(Uuid(as_uuid=True), nullable=False, index=True)

# AFTER:
channel_id = Column(Uuid(as_uuid=True), nullable=True, index=True)
```

**Why:** Webchat messages come through `chat_endpoints`, not `channels`. A webchat message has `chat_endpoint_id` set and `channel_id = NULL`. All existing messages (broadcast, group, scheduled) already have `channel_id` set, so this change is backward-compatible.

### Column Summary

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `conversation_id` | UUID FK -> conversations | Yes | NULL | Links message to conversation thread |
| `chat_endpoint_id` | UUID FK -> chat_endpoints | Yes | NULL | Set for webchat messages |
| `is_private` | Boolean | No | `false` | Internal notes (not sent to customer) |
| `sender_type` | String(20) | Yes | NULL | `'contact'`, `'agent'`, or `'system'` |
| `sender_id` | UUID | Yes | NULL | Agent `user_id` when `sender_type = 'agent'` |
| `channel_id` (existing) | UUID | **Yes** (changed) | NULL | Now nullable for webchat messages |

### Relationships (optional but recommended)

Add SQLAlchemy relationship on `Message`:

```python
conversation = relationship("Conversation", lazy="raise")
```

And backref on `Conversation`:

```python
messages = relationship("Message", back_populates="conversation", lazy="raise")
```

Use `lazy="raise"` to prevent accidental N+1 queries — same pattern as existing relationships.

---

## Part 2: Alembic Migration

Generate with: `alembic revision --autogenerate -m "add conversation columns to messages"`

**This migration requires careful handling:**

1. Add 5 new nullable columns (`conversation_id`, `chat_endpoint_id`, `is_private`, `sender_type`, `sender_id`)
2. Set default for `is_private` on existing rows: `UPDATE messages SET is_private = false WHERE is_private IS NULL` (if autogenerate doesn't handle the server default for existing rows)
3. Alter `channel_id` from `NOT NULL` to nullable: `ALTER TABLE messages ALTER COLUMN channel_id DROP NOT NULL`
4. Add CHECK constraint for `sender_type`
5. Add index on `conversation_id`
6. Add FK constraints

**Test the migration both ways:**
- `alembic upgrade head` — applies cleanly
- `alembic downgrade -1` — reverts cleanly (restore `channel_id` NOT NULL, drop new columns)

**Downgrade caution:** The downgrade for `channel_id` NOT NULL requires that no rows exist with `channel_id = NULL`. The downgrade script should either skip the NOT NULL restore or add a guard. At this stage no webchat messages exist, so it should be safe.

---

## Part 3: Update Existing MessageResponse Schema

Update `src/schemas/message.py` to include the new fields in the response:

```python
class MessageResponse(BaseModel):
    # ... existing fields ...

    # New realtime conversation fields
    conversation_id: UUID | None = None
    chat_endpoint_id: UUID | None = None
    is_private: bool = False
    sender_type: str | None = None
    sender_id: UUID | None = None
```

Existing broadcast/group/scheduled message responses will have these fields as `None`/`false` — fully backward compatible.

---

## Part 4: Nested Conversation Message Endpoints

Create a new router file: `src/routers/conversation_message.py`

These are sub-resource endpoints nested under conversations:

```
POST   /v1/conversations/{id}/messages    -- Send agent reply or internal note
GET    /v1/conversations/{id}/messages    -- Message history (chronological, paginated)
```

### POST /v1/conversations/{id}/messages

Agent sends a reply or internal note within a conversation.

**Request schema:**

```python
class ConversationMessageCreate(BaseModel):
    content: str
    content_type: str = "text"          # text, image, file, etc.
    is_private: bool = False            # true = internal note (not dispatched to customer)
    metadata: dict | None = None
```

**Logic:**

1. Verify conversation exists and belongs to the authenticated user's account (via `x-account-ids`)
2. Create `Message` with these auto-set fields:
   - `conversation_id` = path param `id`
   - `account_id` = from conversation record
   - `channel_id` = from conversation record (NULL for webchat)
   - `chat_endpoint_id` = from conversation record (NULL for IM)
   - `contact_id` = from conversation record
   - `direction` = `"outbound"`
   - `sender_type` = `"agent"`
   - `sender_id` = `current_user_id` (from auth)
   - `status` = `"queued"` (or appropriate initial status)
3. Update `conversation.last_message_at = now()`
4. If this is the **first agent reply** (i.e., `conversation.first_reply_at IS NULL`):
   - Set `conversation.first_reply_at = now()` (SLA tracking)
5. If `is_private = true`:
   - This is an internal note — do NOT dispatch to the customer via channel adapter
   - Still stored as a message, visible to agents only
6. Emit events:
   - `conversation.message.created` for all new messages
   - `conversation.message.sent` specifically for agent replies (non-private)

**Response:** `SuccessResponse[MessageResponse]` with the created message.

### GET /v1/conversations/{id}/messages

List messages for a conversation, chronological order, paginated.

**Logic:**

1. Verify conversation exists and belongs to the authenticated user's account
2. Query messages where `conversation_id = id`
3. Default sort: `created_at ASC` (oldest first — chat order)
4. Standard pagination (`skip`, `limit`)

**Filters:**

| Field | Allowed Filter Operations |
|-------|--------------------------|
| `sender_type` | `eq`, `in` |
| `is_private` | `eq` |
| `content_type` | `eq` |
| `created_at` | `ge`, `le`, `range` |

**Response:** `ListResponse[MessageResponse]` with meta pagination.

---

## Router Registration

Register the conversation message routes **before** the conversation CRUD routes (or in a separate router) to avoid path conflicts with the `/{id}` catch-all.

```python
# In src/main.py or src/routers/conversation.py:
# Define sub-resource routes BEFORE create_crud_routes
# so /v1/conversations/{id}/messages takes precedence over /{id}

@router.post("/{id}/messages")
async def create_conversation_message(id: UUID, ...):
    ...

@router.get("/{id}/messages")
async def list_conversation_messages(id: UUID, ...):
    ...
```

Alternatively, create a dedicated router file `src/routers/conversation_message.py` and mount it with the `/v1/conversations` prefix in `src/main.py`.

---

## Event Types

Use the event types already defined in RT-BE-001:

```python
CONVERSATION_MESSAGE_CREATED = "conversation.message.created"
CONVERSATION_MESSAGE_SENT = "conversation.message.sent"
```

**Emission pattern:**

- Every new conversation message -> `conversation.message.created` with payload:
  ```python
  {
      "message_id": str(message.id),
      "conversation_id": str(conversation.id),
      "sender_type": "agent",
      "sender_id": str(current_user_id),
      "is_private": body.is_private,
      "content_type": body.content_type,
  }
  ```
- Agent replies (non-private) -> additionally emit `conversation.message.sent` with payload:
  ```python
  {
      "message_id": str(message.id),
      "conversation_id": str(conversation.id),
      "channel_id": str(conversation.channel_id) if conversation.channel_id else None,
      "chat_endpoint_id": str(conversation.chat_endpoint_id) if conversation.chat_endpoint_id else None,
  }
  ```

Wire to outbox pipeline using the same pattern from BE-007: flush -> commit -> pg_notify.

---

## Tasks

### 1. Model Extensions
- [ ] Add 5 new columns to `src/models/postgres/message.py`
- [ ] Add CHECK constraint for `sender_type`
- [ ] Change existing `channel_id` from `NOT NULL` to nullable
- [ ] Add `conversation` relationship with `lazy="raise"`
- [ ] Add backref on `Conversation` model

### 2. Migration
- [ ] Generate Alembic migration: `alembic revision --autogenerate -m "add conversation columns to messages"`
- [ ] Review generated migration — verify `channel_id` nullable change is included
- [ ] Verify `is_private` default is handled for existing rows
- [ ] Test `alembic upgrade head` applies cleanly
- [ ] Test `alembic downgrade -1` reverts cleanly

### 3. Schema Updates
- [ ] Add new fields to `MessageResponse` in `src/schemas/message.py`
- [ ] Create `ConversationMessageCreate` schema
- [ ] Verify existing message endpoints still work (backward compatibility)

### 4. Conversation Message Router
- [ ] Create `src/routers/conversation_message.py`
- [ ] Implement `POST /v1/conversations/{id}/messages` with all auto-set fields
- [ ] Implement `GET /v1/conversations/{id}/messages` with filtering and pagination
- [ ] Verify conversation ownership (account scoping) on both endpoints
- [ ] Register router in `src/main.py`

### 5. Business Logic
- [ ] Auto-set `conversation.last_message_at` on every new message
- [ ] Auto-set `conversation.first_reply_at` on first agent reply (if NULL)
- [ ] Private messages (`is_private = true`) are NOT dispatched to customer
- [ ] Emit `conversation.message.created` for all messages
- [ ] Emit `conversation.message.sent` for non-private agent replies

### 6. Tests
- [ ] Existing message endpoints (broadcast, group, scheduled) still work unchanged
- [ ] Existing messages return new fields as `None`/`false` (backward compatible)
- [ ] Create message in conversation -> auto-sets `conversation_id`, `sender_type`, `sender_id`, `direction`
- [ ] Create message -> updates `conversation.last_message_at`
- [ ] First agent reply -> sets `conversation.first_reply_at`
- [ ] Second agent reply -> `first_reply_at` unchanged
- [ ] Private message (`is_private = true`) -> stored correctly, `is_private` reflected in response
- [ ] List conversation messages -> chronological order (ASC)
- [ ] List conversation messages -> filter by `sender_type`
- [ ] List conversation messages -> filter by `is_private`
- [ ] List conversation messages -> paginated
- [ ] Conversation not found -> 404
- [ ] Conversation from different account -> 404 (account scoping)
- [ ] Migration: upgrade and downgrade both succeed

---

## Acceptance Criteria

- [ ] 5 new nullable columns added to `messages` table via Alembic
- [ ] Existing `channel_id` column is now nullable
- [ ] CHECK constraint on `sender_type` enforced at DB level
- [ ] Existing message endpoints and responses are fully backward compatible
- [ ] `POST /v1/conversations/{id}/messages` creates agent reply with all auto-set fields
- [ ] `conversation.last_message_at` updated on every new message
- [ ] `conversation.first_reply_at` set on first agent reply only
- [ ] Private messages are stored but not dispatched
- [ ] `GET /v1/conversations/{id}/messages` returns chronological messages with filters
- [ ] Conversation ownership verified (account scoping) on all nested endpoints
- [ ] Events emitted: `conversation.message.created` and `conversation.message.sent`
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

- **RT-BE-001** — Conversation model must exist (FK target for `conversation_id`)
- **RT-BE-003** — ChatEndpoint model must exist (FK target for `chat_endpoint_id`)

## Blocks

- **Inbound flow task** (future) — creates messages with `conversation_id` set
- **Realtime push worker** (future) — consumes `conversation.message.*` events
- **Fire-and-forget push** (future) — the agent reply endpoint will be extended with direct WebSocket push
