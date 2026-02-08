# BE-001: Implement Messages CRUD API

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** [Turumba2/turumba_messaging_api#8](https://github.com/Turumba2/turumba_messaging_api/issues/8)
**Feature Area:** Messaging

---

## Summary

Implement the Messages domain entity with full CRUD functionality following the established patterns (model → schema → controller → router). Messages are the core entity of the messaging API — every sent and received message across all delivery channels is stored as a message record.

Reference: [Turumba Messaging — Messages](../TURUMBA_MESSAGING.md#2-messages)

---

## Database: PostgreSQL

Messages are relational (FK to channels, contacts, accounts, users) and require ACID guarantees for status transitions. Use JSONB for channel-specific metadata.

### Message Model (`src/models/postgres/message.py`)

```python
class Message(PostgresBaseModel):
    __tablename__ = "messages"

    account_id      = Column(UUID, nullable=False, index=True)
    channel_id      = Column(UUID, nullable=True, index=True)
    contact_id      = Column(UUID, nullable=True, index=True)
    sent_by_user_id = Column(UUID, nullable=True)
    group_message_id = Column(UUID, ForeignKey("group_messages.id"), nullable=True, index=True)

    direction       = Column(String, nullable=False)          # "outbound", "inbound", "system"
    status          = Column(String, nullable=False, default="queued", index=True)
    delivery_address = Column(String, nullable=False)         # phone number, email, username, etc.
    message_body    = Column(Text, nullable=False)            # rendered message content
    original_template = Column(Text, nullable=True)           # raw template before variable substitution
    template_id     = Column(UUID, nullable=True)

    scheduled_at    = Column(DateTime(timezone=True), nullable=True)
    sent_at         = Column(DateTime(timezone=True), nullable=True)
    delivered_at    = Column(DateTime(timezone=True), nullable=True)
    failed_at       = Column(DateTime(timezone=True), nullable=True)

    metadata        = Column(JSONB, nullable=True, default=dict)
    error_details   = Column(JSONB, nullable=True)
```

### Enums

**Direction:** `outbound`, `inbound`, `system`

**Status:** `queued`, `sending`, `sent`, `delivered`, `failed`, `permanently_failed`, `scheduled`

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/message.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

### 2. Schemas (`src/schemas/message.py`)
- [ ] `MessageCreate` — direction, delivery_address, message_body, channel_id, contact_id, template_id, original_template, scheduled_at, metadata (optional fields)
- [ ] `MessageUpdate` — status, sent_at, delivered_at, failed_at, error_details, metadata (all optional)
- [ ] `MessageResponse` — all fields
- [ ] `MessageListResponse` — list wrapper with total count

### 3. Controller (`src/controllers/message.py`)
- [ ] Extend `CRUDController` with `PostgresFilterStrategy` and `PostgresSortStrategy`
- [ ] Define `FilterSortConfig` (see filter table below)
- [ ] Define `SchemaConfig`
- [ ] Default filter: `account_id:in:{x-account-ids}`

### 4. Router (`src/routers/message.py`)
- [ ] `POST /v1/messages/` — Create message
- [ ] `GET /v1/messages/` — List messages (filtered, sorted, paginated)
- [ ] `GET /v1/messages/{id}` — Get by ID
- [ ] `PATCH /v1/messages/{id}` — Update (status transitions)
- [ ] `DELETE /v1/messages/{id}` — Delete
- [ ] All endpoints require authentication

### 5. Register Router
- [ ] Add message router to `src/main.py`

### 6. Tests
- [ ] Create message (outbound, inbound)
- [ ] List with filters (status, channel, direction, date range)
- [ ] List with sorting and pagination
- [ ] Get by ID
- [ ] Update status
- [ ] Delete
- [ ] Account scoping

---

## FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `channel_id` | `eq`, `in` | No |
| `contact_id` | `eq` | No |
| `direction` | `eq` | No |
| `status` | `eq`, `in` | Yes |
| `delivery_address` | `eq`, `contains`, `icontains` | No |
| `template_id` | `eq` | No |
| `group_message_id` | `eq` | No |
| `sent_by_user_id` | `eq` | No |
| `scheduled_at` | `ge`, `le`, `range` | Yes |
| `sent_at` | `ge`, `le`, `range` | Yes |
| `delivered_at` | `ge`, `le`, `range` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Acceptance Criteria

- [ ] Messages table created via Alembic migration
- [ ] Full CRUD endpoints at `/v1/messages/`
- [ ] Filtering, sorting, pagination working
- [ ] Account scoping via `x-account-ids` header
- [ ] JSONB metadata and error_details accept arbitrary JSON
- [ ] Tests passing with coverage threshold
- [ ] Ruff passes cleanly
