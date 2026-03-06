# CONV-BE-002: Message Model Extensions + Conversation Messages Endpoint

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P0 — Required for conversation threads
**Phase:** 1 — Conversation Foundation
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Extend the existing `Message` model with four new nullable columns (`conversation_id`, `is_private`, `sender_type`, `sender_id`) and create nested conversation message endpoints. All existing message features (group messaging, scheduled, templates, broadcast) continue working unchanged since the new columns are nullable.

---

## Part 1: Message Model Extensions

### New Columns on Existing `messages` Table

Add via Alembic migration (all nullable):

```python
# Add to src/models/postgres/message.py
conversation_id = Column(Uuid(as_uuid=True), nullable=True, index=True)
is_private = Column(Boolean, nullable=False, default=False)
sender_type = Column(String(20), nullable=True)   # "contact", "agent", "bot", "system"
sender_id = Column(Uuid(as_uuid=True), nullable=True)
```

Add check constraint:

```python
CheckConstraint(
    "sender_type IS NULL OR sender_type IN ('contact', 'agent', 'bot', 'system')",
    name="ck_messages_sender_type",
),
```

### Update Message Schemas

**MessageCreate** — add:
- `conversation_id: UUID | None = None`
- `is_private: bool = False`
- `sender_type: str | None = None`
- `sender_id: UUID | None = None`

**MessageUpdate** — add:
- `is_private: bool | None = None`

**MessageResponse** — add:
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

---

## Part 2: Conversation Messages Nested Endpoint

### Endpoints

```
POST   /v1/conversations/{conversation_id}/messages    — Create message within conversation
GET    /v1/conversations/{conversation_id}/messages    — List messages in conversation (paginated)
```

Define these routes in `src/routers/conversation.py` **before** the `create_crud_routes()` call so they take precedence over the `/{id}` catch-all.

### POST Behavior

- Auto-set `conversation_id` from path parameter
- Auto-set `account_id` from header context (`x-account-ids`)
- Auto-set `channel_id` from the parent conversation's `channel_id`
- Validate that the conversation exists and belongs to the user's account
- Update `conversation.last_message_at = now()` on each new message
- If `is_private = true`, the message is NOT dispatched to the customer (internal note)
- If `sender_type = "agent"` and this is the first agent reply, set `conversation.first_reply_at = now()`
- Emit `conversation.message.created` event via outbox

### GET Behavior

- Return messages filtered by `conversation_id` (auto-applied default filter)
- Default sort: `created_at:asc` (chronological)
- Standard pagination (skip/limit)
- Future: exclude `is_private = true` messages for non-agent callers

---

## Tasks

- [ ] Add `conversation_id`, `is_private`, `sender_type`, `sender_id` columns to Message model
- [ ] Add `ck_messages_sender_type` check constraint
- [ ] Update `MessageCreate`, `MessageUpdate`, `MessageResponse` schemas
- [ ] Update Message controller `FilterSortConfig` with new filter fields
- [ ] Create Alembic migration for the new columns
- [ ] Create `POST /v1/conversations/{conversation_id}/messages` endpoint
- [ ] Create `GET /v1/conversations/{conversation_id}/messages` endpoint
- [ ] Implement `last_message_at` update on new message
- [ ] Implement `first_reply_at` on first agent reply
- [ ] Emit `conversation.message.created` event via outbox
- [ ] Verify all existing message tests still pass (no regressions)

---

## Tests

- [ ] Create message with `conversation_id` set — appears in conversation thread
- [ ] Create message without `conversation_id` — existing behavior unchanged
- [ ] `POST /conversations/{id}/messages` auto-sets conversation_id, account_id, channel_id
- [ ] `POST /conversations/{id}/messages` validates conversation exists and belongs to account
- [ ] `POST /conversations/{id}/messages` updates `conversation.last_message_at`
- [ ] First agent reply sets `conversation.first_reply_at`
- [ ] `GET /conversations/{id}/messages` returns only messages for that conversation, chronological
- [ ] `GET /conversations/{id}/messages` supports pagination
- [ ] `is_private = true` message is not dispatched
- [ ] Existing message CRUD unaffected (all new columns nullable)

---

## Acceptance Criteria

- [ ] Four new columns added to `messages` table via Alembic migration
- [ ] Existing message tests pass without modification
- [ ] Nested endpoints work at `/v1/conversations/{id}/messages`
- [ ] `last_message_at` updated on every conversation message
- [ ] `first_reply_at` set on first agent reply
- [ ] `conversation.message.created` event emitted via outbox
- [ ] All tests passing, Ruff clean

---

## Dependencies

- **CONV-BE-001** — Conversation model must exist

## Blocks

- **CONV-BE-005** (Inbound Flow) — needs conversation messages endpoint
- **CONV-FE-002** (Chat View) — needs message endpoints
