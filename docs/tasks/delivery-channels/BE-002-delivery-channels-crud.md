# BE-002: Implement Delivery Channels CRUD API

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** [Turumba2/turumba_messaging_api#9](https://github.com/Turumba2/turumba_messaging_api/issues/9)
**Feature Area:** Delivery Channels

---

## Summary

Implement the Delivery Channels domain entity with full CRUD functionality. A Delivery Channel is a configured connection between a Turumba account and an external messaging platform (SMS provider, SMPP port, Telegram bot, WhatsApp Business, etc.). Users must add at least one channel before they can send messages.

Reference: [Turumba Messaging — Delivery Channels](../TURUMBA_MESSAGING.md#1-delivery-channels)

---

## Database: PostgreSQL

Channels are relational (FK to accounts, referenced by messages) and need consistent state management. Provider credentials are stored in JSONB since each channel type requires different fields.

### Channel Model (`src/models/postgres/channel.py`)

```python
class Channel(PostgresBaseModel):
    __tablename__ = "channels"

    account_id       = Column(UUID, nullable=False, index=True)
    name             = Column(String(255), nullable=False)
    channel_type     = Column(String(50), nullable=False, index=True)
    status           = Column(String(50), nullable=False, default="disconnected", index=True)
    is_enabled       = Column(Boolean, nullable=False, default=True)

    credentials      = Column(JSONB, nullable=False, default=dict)

    sender_name      = Column(String(255), nullable=True)
    default_country_code = Column(String(10), nullable=True)
    rate_limit       = Column(Integer, nullable=True)
    priority         = Column(Integer, nullable=False, default=0)
    retry_count      = Column(Integer, nullable=False, default=3)
    retry_interval   = Column(Integer, nullable=False, default=60)

    last_verified_at = Column(DateTime(timezone=True), nullable=True)
    error_message    = Column(Text, nullable=True)
```

### Enums

**Channel Types:** `sms`, `smpp`, `telegram`, `whatsapp`, `messenger`, `email`

**Status:** `connected`, `disconnected`, `rate_limited`, `error`, `disabled`

### Credentials JSONB per Channel Type

| Type | Fields |
|------|--------|
| `sms` | `provider`, `api_key`, `api_secret`, `sender_number`, `sender_id` |
| `smpp` | `host`, `port`, `system_id`, `password`, `system_type`, `source_addr`, `source_addr_ton`, `source_addr_npi` |
| `telegram` | `bot_token`, `webhook_url` |
| `whatsapp` | `access_token`, `phone_number_id`, `business_account_id` |
| `messenger` | `page_access_token`, `page_id`, `app_secret` |
| `email` | `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `imap_host`, `imap_port`, `imap_username`, `imap_password`, `from_name`, `reply_to` |

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/channel.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

### 2. Schemas (`src/schemas/channel.py`)
- [ ] `ChannelCreate` — name, channel_type, credentials, sender_name, default_country_code, rate_limit, priority, retry_count, retry_interval (optional fields where applicable)
- [ ] `ChannelUpdate` — name, credentials, sender_name, default_country_code, rate_limit, priority, retry_count, retry_interval, is_enabled (all optional)
- [ ] `ChannelResponse` — all fields. **Credentials must be excluded or masked** (e.g., `"api_key": "sk-****1234"`)
- [ ] `ChannelListResponse` — list wrapper with total count
- [ ] Validate `channel_type` against allowed enum values

### 3. Controller (`src/controllers/channel.py`)
- [ ] Extend `CRUDController` with `PostgresFilterStrategy` and `PostgresSortStrategy`
- [ ] Define `FilterSortConfig` (see filter table below)
- [ ] Define `SchemaConfig` — ensure credentials are excluded/masked in responses
- [ ] Default filter: `account_id:in:{x-account-ids}`

### 4. Router (`src/routers/channel.py`)
- [ ] `POST /v1/channels/` — Add a new delivery channel
- [ ] `GET /v1/channels/` — List channels (filtered, sorted, paginated)
- [ ] `GET /v1/channels/{id}` — Get single channel by ID
- [ ] `PATCH /v1/channels/{id}` — Update channel config
- [ ] `DELETE /v1/channels/{id}` — Remove a channel
- [ ] All endpoints require authentication

### 5. Register Router
- [ ] Add channel router to `src/main.py`

### 6. Tests
- [ ] Create channel (each type: sms, smpp, telegram, whatsapp, messenger, email)
- [ ] List with filters (channel_type, status, is_enabled)
- [ ] List with sorting and pagination
- [ ] Get by ID — verify credentials excluded/masked
- [ ] Update (name, credentials, is_enabled)
- [ ] Delete
- [ ] Account scoping
- [ ] channel_type validation rejects invalid types

---

## FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `name` | `eq`, `contains`, `icontains` | Yes |
| `channel_type` | `eq`, `in` | Yes |
| `status` | `eq`, `in` | Yes |
| `is_enabled` | `eq` | No |
| `priority` | `eq`, `ge`, `le` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Important: Credential Security

- **Never return raw credentials in API responses**
- `ChannelResponse` must exclude or mask the `credentials` field
- Credentials are write-only (create/update), never fully readable
- Design `SchemaConfig` response transformation accordingly

---

## Acceptance Criteria

- [ ] Channels table created via Alembic migration
- [ ] Full CRUD endpoints at `/v1/channels/`
- [ ] Filtering, sorting, pagination working
- [ ] Account scoping via `x-account-ids` header
- [ ] Credentials JSONB accepts channel-type-specific fields
- [ ] Credentials **not** returned in full in API responses
- [ ] Tests passing with coverage threshold
- [ ] Ruff passes cleanly

---

## Dependencies

- Issue #1 (Core Architecture Components) — Done
- Issue #3 (Dual Database Support) — Done
- Messages (#8) will reference `channel_id` from this table
