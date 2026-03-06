# RT-BE-003: ChatEndpoint Model + CRUD + Public Session API

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P0 — Required for webchat channel
**Phase:** 1 — Data Foundation
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 3.4](../../../TURUMBA_REALTIME_MESSAGING.md#34-chat_endpoints--messaging-api-live-chat-widget), [Section 6.2](../../../TURUMBA_REALTIME_MESSAGING.md#62-chatendpoint-lifecycle-api), [Section 9.2](../../../TURUMBA_REALTIME_MESSAGING.md#92-messaging-api--chat-endpoints)

---

## Summary

Implement the `ChatEndpoint` model with full CRUD endpoints and two **public** (unauthenticated) endpoints for the live chat widget. Each ChatEndpoint represents an embeddable chat widget that account users can place on their websites. The model stores widget configuration (colors, position, welcome message, pre-chat form) and security settings (allowed origins).

This task also introduces visitor JWT token signing for the session endpoint, enabling visitors to authenticate with the unified AWS WebSocket gateway.

---

## Database Model (`src/models/postgres/chat_endpoint.py`)

```python
from sqlalchemy import Boolean, Column, Index, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class ChatEndpoint(PostgresBaseModel):
    __tablename__ = "chat_endpoints"
    __table_args__ = (
        Index("ix_chat_endpoints_account_active", "account_id", "is_active"),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)                    # "Support Chat", "Sales Inquiry"
    public_key = Column(String(64), nullable=False, unique=True)  # embed token (random, URL-safe)
    is_active = Column(Boolean, nullable=False, default=True)

    welcome_message = Column(Text, nullable=True)                 # first message shown to visitors
    offline_message = Column(Text, nullable=True)                 # shown when no agents online

    pre_chat_form = Column(JSONB, nullable=True)
    # Example:
    # {
    #   "enabled": true,
    #   "fields": [
    #     { "name": "name", "label": "Your Name", "required": true },
    #     { "name": "email", "label": "Email", "required": false }
    #   ]
    # }

    widget_config = Column(JSONB, nullable=False, default=dict)
    # Example:
    # {
    #   "color": "#4F46E5",
    #   "position": "bottom-right",
    #   "launcher_text": "Chat with us"
    # }

    allowed_origins = Column(JSONB, nullable=False, default=list)
    # CORS origins: ["https://example.com"]
    # Empty list = all origins allowed

    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)
```

Re-export in `src/models/postgres/__init__.py` for Alembic detection.

**Key details:**

- `public_key` is `String(64)`, `NOT NULL`, `UNIQUE` — the only publicly visible identifier
- `public_key` is generated server-side on creation and **immutable** after that (not in update schema)
- The UUID `id` is never exposed publicly — only used in authenticated admin endpoints
- `allowed_origins` empty list means all origins are allowed

---

## Public Key Generation

On creation, generate the `public_key` automatically:

```python
import secrets

public_key = secrets.token_urlsafe(48)  # produces ~64 character URL-safe string
```

- Generated in the creation service, not provided by the client
- Immutable after creation — `public_key` is NOT in `ChatEndpointUpdate` schema
- If a collision occurs (extremely unlikely), retry with a new token

---

## Schemas (`src/schemas/chat_endpoint.py`)

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ChatEndpointCreate(BaseModel):
    name: str
    is_active: bool = True
    welcome_message: str | None = None
    offline_message: str | None = None
    pre_chat_form: dict | None = None
    widget_config: dict = {}
    allowed_origins: list[str] = []
    metadata: dict | None = None
    # NOTE: public_key is NOT here — generated server-side


class ChatEndpointUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    welcome_message: str | None = None
    offline_message: str | None = None
    pre_chat_form: dict | None = None
    widget_config: dict | None = None
    allowed_origins: list[str] | None = None
    metadata: dict | None = None
    # NOTE: public_key is NOT here — immutable after creation


class ChatEndpointResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    name: str
    public_key: str
    is_active: bool
    welcome_message: str | None
    offline_message: str | None
    pre_chat_form: dict | None
    widget_config: dict
    allowed_origins: list[str]
    metadata: dict | None
    created_at: datetime
    updated_at: datetime


# --- Public endpoint schemas (minimal, no internal IDs) ---

class ChatEndpointPublicResponse(BaseModel):
    """Returned by GET /v1/public/chat/{public_key} — widget config only."""
    name: str
    welcome_message: str | None
    offline_message: str | None
    pre_chat_form: dict | None
    widget_config: dict


class VisitorSessionRequest(BaseModel):
    """Request body for POST /v1/public/chat/{public_key}/session."""
    visitor_id: str | None = None     # client-generated or null for first visit
    name: str | None = None           # from pre-chat form
    email: str | None = None          # from pre-chat form


class VisitorSessionResponse(BaseModel):
    """Response from POST /v1/public/chat/{public_key}/session."""
    visitor_token: str                # short-lived JWT (1h), signed by Messaging API
    visitor_id: str                   # persisted in visitor's localStorage
    conversation_id: UUID | None      # null = new conversation created on first message
    ws_url: str                       # WebSocket gateway URL
```

---

## Controller (`src/controllers/chat_endpoint.py`)

Extend `CRUDController[ChatEndpoint, ChatEndpointCreate, ChatEndpointUpdate, ChatEndpointResponse]`.

**Key behaviors:**

1. **Default filter:** `account_id:in:{x-account-ids}` (tenant isolation)
2. **On create:** generate `public_key` via `secrets.token_urlsafe(48)` before inserting
3. **`public_key` immutable:** if an update payload somehow includes `public_key`, ignore it (schema already excludes it)

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `name` | `eq`, `contains`, `icontains` | Yes |
| `is_active` | `eq` | No |
| `public_key` | `eq` | No |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Authenticated CRUD Endpoints (`src/routers/chat_endpoint.py`)

Standard authenticated CRUD — same pattern as channels, templates, etc.:

```
POST   /v1/chat-endpoints/          -- Create webchat point (auth required)
GET    /v1/chat-endpoints/          -- List (auth, account-scoped)
GET    /v1/chat-endpoints/{id}      -- Detail (auth)
PATCH  /v1/chat-endpoints/{id}      -- Update config (auth)
DELETE /v1/chat-endpoints/{id}      -- Deactivate (auth, 204)
```

Register in `src/main.py`.

---

## Public Endpoints (`src/routers/public_chat.py`)

These endpoints have **no authentication** and are **not routed through the gateway context enricher**. They are identified by `public_key` (not UUID).

Create a separate router file: `src/routers/public_chat.py`

### 1. GET /v1/public/chat/{public_key}

Returns widget configuration for the chat widget JavaScript to initialize.

**Logic:**
1. Query `ChatEndpoint` by `public_key`
2. If not found OR `is_active = false` -> return 404
3. Return `ChatEndpointPublicResponse` (only: `name`, `welcome_message`, `offline_message`, `pre_chat_form`, `widget_config`)

**No internal IDs are exposed.** No `account_id`, no UUID `id`.

### 2. POST /v1/public/chat/{public_key}/session

Creates or resumes a visitor session. Returns a signed visitor JWT for WebSocket authentication.

**Request body:** `VisitorSessionRequest`
```json
{
  "visitor_id": "vs_abc...",
  "name": "Dawit",
  "email": "dawit@example.com"
}
```

**Logic:**
1. Query `ChatEndpoint` by `public_key`
2. If not found OR `is_active = false` -> return 404
3. If `visitor_id` not provided, generate one: `f"vs_{secrets.token_urlsafe(16)}"`
4. Sign a visitor JWT (HMAC-SHA256 with `VISITOR_JWT_SECRET` env var):
   ```python
   import jwt
   from datetime import datetime, timedelta, UTC

   payload = {
       "sub": visitor_id,                           # visitor_id
       "account_id": str(chat_endpoint.account_id), # scoped to this account
       "endpoint_id": str(chat_endpoint.id),         # chat_endpoint id
       "type": "visitor",                            # distinguishes from Cognito tokens
       "exp": datetime.now(UTC) + timedelta(hours=1),
   }
   visitor_token = jwt.encode(payload, settings.VISITOR_JWT_SECRET, algorithm="HS256")
   ```
5. Return `VisitorSessionResponse`:
   ```json
   {
     "visitor_token": "eyJhbGc...",
     "visitor_id": "vs_abc...",
     "conversation_id": null,
     "ws_url": "wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}"
   }
   ```

**Notes:**
- `conversation_id` is always `null` at session creation — conversations are created on first message
- `ws_url` comes from the `WS_URL` environment variable
- The visitor token is short-lived (1h) — the widget refreshes it by calling this endpoint again before expiry

---

## New Environment Variables

Add to `src/config/config.py` (pydantic-settings):

```python
VISITOR_JWT_SECRET: str       # HMAC-SHA256 secret for signing visitor tokens
WS_URL: str                   # WebSocket gateway URL (wss://...)
```

Both must be documented in `.env.example`.

**Dependency:** PyJWT (`jwt` package) — already in requirements for Cognito token validation. Verify it is available; if not, add to `requirements.txt`.

---

## Alembic Migration

Generate with: `alembic revision --autogenerate -m "add chat_endpoints table"`

Verify the migration includes:
- All columns with correct types, defaults, and nullability
- UNIQUE constraint on `public_key`
- Composite index on `(account_id, is_active)`
- Proper downgrade (drop table)

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/chat_endpoint.py` with all fields and constraints
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Generate Alembic migration
- [ ] Verify migration applies cleanly: `alembic upgrade head`

### 2. Schemas
- [ ] Create `src/schemas/chat_endpoint.py` with all schemas (Create, Update, Response, Public, Session)
- [ ] Verify `public_key` is excluded from Create and Update schemas
- [ ] Define `ChatEndpointPublicResponse` with only widget-facing fields
- [ ] Define `VisitorSessionRequest` and `VisitorSessionResponse`

### 3. Service Layer
- [ ] Create `src/services/chat_endpoint/` directory
- [ ] Implement `ChatEndpointCreationService` — generate `public_key` via `secrets.token_urlsafe(48)`
- [ ] Implement `ChatEndpointRetrievalService`
- [ ] Implement `ChatEndpointUpdateService`

### 4. Controller
- [ ] Create `src/controllers/chat_endpoint.py` extending `CRUDController`
- [ ] Define `_FILTER_SORT_CONFIG` with allowed filters and sorts
- [ ] Ensure `public_key` is auto-generated on create, immutable on update

### 5. Authenticated Router
- [ ] Create `src/routers/chat_endpoint.py`
- [ ] Register standard CRUD endpoints
- [ ] Register router in `src/main.py`

### 6. Public Router
- [ ] Create `src/routers/public_chat.py`
- [ ] Implement `GET /v1/public/chat/{public_key}` — return widget config, 404 if inactive
- [ ] Implement `POST /v1/public/chat/{public_key}/session` — visitor session creation
- [ ] Generate `visitor_id` if not provided (format: `vs_{random}`)
- [ ] Sign visitor JWT with `VISITOR_JWT_SECRET` (HMAC-SHA256, 1h expiry)
- [ ] Return `ws_url` from `WS_URL` env var
- [ ] Register public router in `src/main.py` (no auth dependency)

### 7. Configuration
- [ ] Add `VISITOR_JWT_SECRET` to `src/config/config.py`
- [ ] Add `WS_URL` to `src/config/config.py`
- [ ] Add both to `.env.example` with placeholder values
- [ ] Verify PyJWT is available in `requirements.txt`

### 8. Tests
- [ ] ChatEndpoint: create -> `public_key` auto-generated, returned in response
- [ ] ChatEndpoint: create -> `public_key` not accepted in request body
- [ ] ChatEndpoint: update -> `public_key` cannot be changed
- [ ] ChatEndpoint: list -> account-scoped via `x-account-ids`
- [ ] ChatEndpoint: filter by `is_active`
- [ ] ChatEndpoint: delete -> 204
- [ ] Public GET: valid `public_key` with `is_active = true` -> 200 with widget config
- [ ] Public GET: valid `public_key` with `is_active = false` -> 404
- [ ] Public GET: invalid `public_key` -> 404
- [ ] Public GET: response does NOT include `id`, `account_id`, or any internal fields
- [ ] Session POST: valid `public_key` -> returns `visitor_token`, `visitor_id`, `ws_url`
- [ ] Session POST: without `visitor_id` -> auto-generates one with `vs_` prefix
- [ ] Session POST: with `visitor_id` -> returns same `visitor_id`
- [ ] Session POST: `conversation_id` is `null`
- [ ] Session POST: inactive endpoint -> 404
- [ ] Session POST: visitor token is valid JWT with correct claims (`sub`, `account_id`, `endpoint_id`, `type`, `exp`)

---

## Acceptance Criteria

- [ ] `chat_endpoints` table created via Alembic with UNIQUE on `public_key` and index on `(account_id, is_active)`
- [ ] `public_key` is auto-generated on creation (64-char URL-safe token), immutable after
- [ ] Full authenticated CRUD at `/v1/chat-endpoints/`
- [ ] `GET /v1/public/chat/{public_key}` returns widget config only (no internal IDs), 404 if inactive
- [ ] `POST /v1/public/chat/{public_key}/session` returns signed visitor JWT with 1h expiry
- [ ] Visitor JWT contains correct claims: `sub` (visitor_id), `account_id`, `endpoint_id`, `type: "visitor"`, `exp`
- [ ] `visitor_id` auto-generated with `vs_` prefix when not provided
- [ ] `VISITOR_JWT_SECRET` and `WS_URL` env vars added to config
- [ ] Public endpoints require no authentication
- [ ] Account scoping enforced on authenticated endpoints
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

None — can be built in parallel with RT-BE-001 and RT-BE-002.

## Blocks

- **RT-BE-001** — `chat_endpoint_id` FK on conversations references this table
- **RT-BE-004** — `chat_endpoint_id` FK on messages references this table
- **Internal visitor validation endpoint** (future) — uses `VISITOR_JWT_SECRET` to decode tokens
- **Widget JavaScript** (future, frontend) — calls these public endpoints
