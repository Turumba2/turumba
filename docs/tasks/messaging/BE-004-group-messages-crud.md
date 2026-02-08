# BE-004: Implement Group Messages CRUD API

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** [Turumba2/turumba_messaging_api#11](https://github.com/Turumba2/turumba_messaging_api/issues/11)
**Feature Area:** Group Messaging

---

## Summary

Implement the Group Messages domain entity with full CRUD functionality. A Group Message is a parent record that represents a bulk send operation — one message dispatched to an entire contact group through a selected delivery channel. The system iterates through all contacts in the group, renders the template for each recipient, and creates individual message records linked back to this parent.

Individual messages reference this table via `group_message_id` (FK in the `messages` table).

Reference: [Turumba Messaging — Group Messaging](../TURUMBA_MESSAGING.md#4-group-messaging)

---

## Database: PostgreSQL

Group messages are relational (FK to accounts, channels, templates; referenced by individual messages via `group_message_id`) and require ACID guarantees for progress counter updates. Recipient targeting and custom variable values are stored in JSONB.

### GroupMessage Model (`src/models/postgres/group_message.py`)

```python
class GroupMessage(PostgresBaseModel):
    __tablename__ = "group_messages"

    account_id          = Column(UUID, nullable=False, index=True)
    channel_id          = Column(UUID, nullable=True, index=True)
    template_id         = Column(UUID, nullable=True, index=True)
    created_by_user_id  = Column(UUID, nullable=True)

    name                = Column(String(255), nullable=True)
    status              = Column(String(50), nullable=False, default="draft", index=True)

    # Recipient targeting
    contact_group_ids   = Column(JSONB, nullable=False, default=list)     # list of contact group UUIDs
    exclude_contact_ids = Column(JSONB, nullable=True, default=list)      # specific contacts to exclude

    # Progress counters
    total_recipients    = Column(Integer, nullable=False, default=0)
    sent_count          = Column(Integer, nullable=False, default=0)
    delivered_count     = Column(Integer, nullable=False, default=0)
    failed_count        = Column(Integer, nullable=False, default=0)
    pending_count       = Column(Integer, nullable=False, default=0)

    # Timing
    scheduled_at        = Column(DateTime(timezone=True), nullable=True)
    started_at          = Column(DateTime(timezone=True), nullable=True)
    completed_at        = Column(DateTime(timezone=True), nullable=True)

    # Template variable overrides (values provided at send time)
    custom_values       = Column(JSONB, nullable=True, default=dict)

    metadata            = Column(JSONB, nullable=True, default=dict)
```

### Enums

**Status:** `draft`, `queued`, `processing`, `completed`, `partially_failed`, `failed`, `cancelled`

- `draft` — Created but not yet submitted for sending
- `queued` — Submitted and waiting to be processed
- `processing` — Currently iterating through contacts and dispatching messages
- `completed` — All messages dispatched successfully
- `partially_failed` — Some messages delivered, some failed
- `failed` — All messages failed
- `cancelled` — Cancelled by user before or during processing

### Status Lifecycle

```
Draft ──→ Queued → Processing → Completed
   │                    │
   │                    ├→ Partially Failed
   │                    │
   │                    └→ Failed
   │
   └→ Cancelled (can also cancel from Queued or Processing)
```

### Contact Group IDs JSONB

List of contact group UUIDs to target. Contacts appearing in multiple groups receive the message only once (deduplication happens at processing time).

```json
["550e8400-e29b-41d4-a716-446655440001", "550e8400-e29b-41d4-a716-446655440002"]
```

### Custom Values JSONB

Template variable values provided at send time that apply to all recipients (e.g., a meeting link or event date that is the same for everyone).

```json
{
  "MEETING_LINK": "https://meet.example.com/abc123",
  "EVENT_DATE": "March 20, 2026"
}
```

---

## Auto-Template Creation from Message Body

Users can create a group message in two ways:

1. **Pass `template_id`** — Use an existing template (standard flow)
2. **Pass `message_body`** — Provide raw message text directly; the system handles the rest

When `message_body` is provided instead of `template_id`:

1. The controller checks if the body contains `{VARIABLE_NAME}` placeholders
2. If variables are found, a new `Template` record is **automatically created** with:
   - `name`: Auto-generated (e.g., `"Auto: {group_message_name} — {timestamp}"`)
   - `body`: The provided `message_body`
   - `variables`: Auto-extracted from the body
   - `account_id`: Same as the group message
   - `created_by_user_id`: Same as the group message creator
   - `category`: `"auto-generated"`
3. If no variables are found, a template is still created (the body is treated as static text)
4. The new template's `id` is assigned to the group message's `template_id`

This gives users a shortcut — they don't need to create a template separately before creating a group message. The auto-created template is also reusable for future sends.

**Validation:** The request must provide **either** `template_id` **or** `message_body`, but not both. If neither is provided, return a validation error.

### Example: Create with message_body

```json
POST /v1/group-messages/
{
  "name": "March Welcome Campaign",
  "channel_id": "...",
  "contact_group_ids": ["..."],
  "message_body": "Hi {FIRST_NAME}, welcome to {ACCOUNT_NAME}! Your enrollment code is {CODE}.",
  "custom_values": { "CODE": "MARCH-2026" }
}
```

**Result:** A template is auto-created with variables `["FIRST_NAME", "ACCOUNT_NAME", "CODE"]`, and the group message is created with the new `template_id`.

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/group_message.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

### 2. Schemas (`src/schemas/group_message.py`)
- [ ] `GroupMessageCreate` — name, channel_id, contact_group_ids, exclude_contact_ids, scheduled_at, custom_values, metadata, **plus either `template_id` or `message_body`** (optional fields where applicable)
- [ ] Add Pydantic `model_validator` to enforce: must provide `template_id` **or** `message_body`, not both, not neither
- [ ] `GroupMessageUpdate` — name, channel_id, template_id, contact_group_ids, exclude_contact_ids, scheduled_at, custom_values, metadata, status (all optional; status updates restricted to valid transitions)
- [ ] `GroupMessageResponse` — all fields including progress counters and `template_id`
- [ ] `GroupMessageListResponse` — list wrapper with total count
- [ ] Validate `status` against allowed enum values

### 3. Controller (`src/controllers/group_message.py`)
- [ ] Extend `CRUDController` with `PostgresFilterStrategy` and `PostgresSortStrategy`
- [ ] Define `FilterSortConfig` (see filter table below)
- [ ] Define `SchemaConfig`
- [ ] Default filter: `account_id:in:{x-account-ids}`
- [ ] **Auto-template creation:** Override `create` — if `message_body` is provided, auto-create a `Template` record (extract variables, set `category` to `"auto-generated"`), then assign the new `template_id` to the group message before persisting

### 4. Router (`src/routers/group_message.py`)
- [ ] `POST /v1/group-messages/` — Create a new group message
- [ ] `GET /v1/group-messages/` — List group messages (filtered, sorted, paginated)
- [ ] `GET /v1/group-messages/{id}` — Get single group message by ID (includes progress counters)
- [ ] `PATCH /v1/group-messages/{id}` — Update group message (e.g., edit draft, cancel)
- [ ] `DELETE /v1/group-messages/{id}` — Delete a group message
- [ ] All endpoints require authentication

### 5. Register Router
- [ ] Add group message router to `src/main.py`

### 6. Tests
- [ ] Create group message with `template_id` (existing template)
- [ ] Create group message with `message_body` containing variables — verify template auto-created and `template_id` assigned
- [ ] Create group message with `message_body` without variables — verify template still auto-created
- [ ] Validation rejects request with both `template_id` and `message_body`
- [ ] Validation rejects request with neither `template_id` nor `message_body`
- [ ] Create group message with scheduled_at
- [ ] List with filters (status, channel_id, template_id, created_by_user_id)
- [ ] List with sorting and pagination
- [ ] Get by ID — verify progress counters included
- [ ] Update (name, contact_group_ids, custom_values)
- [ ] Update status (draft → cancelled)
- [ ] Delete
- [ ] Account scoping
- [ ] Status validation rejects invalid values
- [ ] contact_group_ids accepts list of UUIDs

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
| `created_by_user_id` | `eq` | No |
| `total_recipients` | `ge`, `le` | Yes |
| `scheduled_at` | `ge`, `le`, `range` | Yes |
| `started_at` | `ge`, `le`, `range` | Yes |
| `completed_at` | `ge`, `le`, `range` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Acceptance Criteria

- [ ] Group messages table created via Alembic migration
- [ ] Full CRUD endpoints at `/v1/group-messages/`
- [ ] Filtering, sorting, pagination working
- [ ] Account scoping via `x-account-ids` header
- [ ] Create accepts **either** `template_id` or `message_body` (validated, mutually exclusive)
- [ ] When `message_body` is provided, a template is auto-created with extracted variables and linked via `template_id`
- [ ] JSONB fields accept contact_group_ids (list of UUIDs), exclude_contact_ids, custom_values, metadata
- [ ] Progress counters (total_recipients, sent_count, delivered_count, failed_count, pending_count) returned in responses
- [ ] Status validated against allowed enum values
- [ ] Tests passing with coverage threshold
- [ ] Ruff passes cleanly

---

## Dependencies

- Issue #1 (Core Architecture Components) — Done
- Issue #3 (Dual Database Support) — Done
- Channels (#9) — `channel_id` references channels table
- Templates (#10) — `template_id` references templates table
- Messages (#8) — individual messages reference `group_messages.id` via `group_message_id` FK

---

## Note: Processing Logic

This task covers only the **CRUD API** for group messages (create, read, update, delete the parent record). The actual **message dispatch processing** — iterating through contacts, rendering templates, sending individual messages, updating progress counters — is a separate task that will be implemented later as a background job processor.
