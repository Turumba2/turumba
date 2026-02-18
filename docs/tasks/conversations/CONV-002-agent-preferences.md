# CONV-002: Agent Preferences

**Type:** Backend
**Service:** turumba_account_api
**Priority:** P0 — Required for intelligent agent routing
**Feature Area:** Customer Support — Agent Management
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Add an `AgentPreference` entity to the Account API that stores each support agent's availability, channel preferences, topic expertise, working hours, language skills, and capacity settings. The Messaging API's bot router (CONV-003) queries these preferences to intelligently route conversations to the best available agent.

This is a straightforward new entity following the existing Account API patterns — model, schemas, controller, router, tests.

**Scope:**
- `AgentPreference` PostgreSQL model (one-to-one with `users`)
- Full CRUD with `/me` shortcut endpoint for self-service
- Queryable list endpoint for the routing engine (service-to-service)
- Gateway route configuration

---

## Database Model (`src/models/postgres/agent_preference.py`)

```python
from sqlalchemy import Boolean, Column, Integer, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class AgentPreference(PostgresBaseModel):
    """Agent availability, routing preferences, and capacity settings."""

    __tablename__ = "agent_preferences"

    user_id = Column(Uuid(as_uuid=True), nullable=False, unique=True, index=True)

    available_channels = Column(JSONB, nullable=True, default=list)
    available_topics = Column(JSONB, nullable=True, default=list)
    available_hours = Column(JSONB, nullable=True)
    languages = Column(JSONB, nullable=True, default=list)

    max_concurrent_conversations = Column(Integer, nullable=False, default=5)
    is_available = Column(Boolean, nullable=False, default=True)
    auto_accept = Column(Boolean, nullable=False, default=False)

    notification_preferences = Column(JSONB, nullable=True, default=dict)
```

### Column Details

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID (unique) | FK reference to `users.id`. One preference row per user. |
| `available_channels` | JSONB array | `["whatsapp", "telegram", "sms"]` — channels this agent handles |
| `available_topics` | JSONB array | `["billing", "technical", "general"]` — topic expertise |
| `available_hours` | JSONB object | Schedule with timezone (see schema below) |
| `languages` | JSONB array | `["en", "am"]` — languages spoken |
| `max_concurrent_conversations` | Integer | Max simultaneous conversations (default 5) |
| `is_available` | Boolean | Manual online/offline toggle (default true) |
| `auto_accept` | Boolean | Auto-accept assigned conversations (default false) |
| `notification_preferences` | JSONB object | Sound, desktop, email notification settings |

### `available_hours` Schema

```json
{
  "schedule": [
    { "days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "17:00" },
    { "days": ["sat"], "start": "09:00", "end": "13:00" }
  ],
  "timezone": "Africa/Addis_Ababa"
}
```

### `notification_preferences` Schema

```json
{
  "sound": true,
  "desktop": true,
  "email_on_assignment": false
}
```

---

## Schemas (`src/schemas/agent_preference.py`)

```python
from pydantic import BaseModel, ConfigDict, Field
from uuid import UUID
from datetime import datetime


class ScheduleBlock(BaseModel):
    days: list[str]   # ["mon", "tue", "wed", "thu", "fri"]
    start: str        # "09:00"
    end: str          # "17:00"

class AvailableHours(BaseModel):
    schedule: list[ScheduleBlock] = []
    timezone: str = "UTC"

class NotificationPreferences(BaseModel):
    sound: bool = True
    desktop: bool = True
    email_on_assignment: bool = False


class AgentPreferenceCreate(BaseModel):
    user_id: UUID
    available_channels: list[str] | None = None
    available_topics: list[str] | None = None
    available_hours: AvailableHours | None = None
    languages: list[str] | None = None
    max_concurrent_conversations: int = Field(default=5, ge=1, le=50)
    is_available: bool = True
    auto_accept: bool = False
    notification_preferences: NotificationPreferences | None = None


class AgentPreferenceUpdate(BaseModel):
    available_channels: list[str] | None = None
    available_topics: list[str] | None = None
    available_hours: AvailableHours | None = None
    languages: list[str] | None = None
    max_concurrent_conversations: int | None = Field(default=None, ge=1, le=50)
    is_available: bool | None = None
    auto_accept: bool | None = None
    notification_preferences: NotificationPreferences | None = None


class AgentPreferenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    available_channels: list[str] | None
    available_topics: list[str] | None
    available_hours: dict | None
    languages: list[str] | None
    max_concurrent_conversations: int
    is_available: bool
    auto_accept: bool
    notification_preferences: dict | None
    created_at: datetime
    updated_at: datetime
```

---

## Controller (`src/controllers/agent_preference.py`)

Extend `CRUDController[AgentPreference, AgentPreferenceCreate, AgentPreferenceUpdate, AgentPreferenceResponse]`.

- No `account_id` default filter — agent preferences are user-scoped, not account-scoped
- The list endpoint should still require authentication
- The `/me` endpoint uses `get_current_user_id` to auto-scope

### Validation Rules

- `user_id` must be unique (enforced by DB unique constraint, return 409 on conflict)
- `available_channels` values must be from: `telegram`, `whatsapp`, `messenger`, `sms`, `smpp`, `email`
- `available_hours.schedule[].days` values must be from: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`
- `available_hours.schedule[].start` and `end` must be valid `HH:MM` format
- `max_concurrent_conversations` must be between 1 and 50

---

## Router (`src/routers/agent_preference.py`)

### Standard CRUD

```
POST   /v1/agent-preferences/          — Create preferences (admin, or auto on first login)
GET    /v1/agent-preferences/          — List all (admin + routing engine)
GET    /v1/agent-preferences/{id}      — Get by ID
PATCH  /v1/agent-preferences/{id}      — Update
DELETE /v1/agent-preferences/{id}      — Delete
```

### Self-Service `/me` Endpoints

```
GET    /v1/agent-preferences/me        — Get own preferences
PATCH  /v1/agent-preferences/me        — Update own preferences
```

**Implementation for `/me`:**
1. Extract `user_id` from `get_current_user_id` dependency
2. Query `AgentPreference` where `user_id = current_user_id`
3. If not found on GET → return 404 with message "No preferences set. Use PATCH to create."
4. If not found on PATCH → auto-create with the provided values + `user_id`
5. If found on PATCH → update existing record

**Important:** The `/me` routes must be registered BEFORE `/{id}` routes to avoid FastAPI treating "me" as a UUID path parameter.

---

## FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `user_id` | `eq` | No |
| `is_available` | `eq` | No |
| `auto_accept` | `eq` | No |
| `max_concurrent_conversations` | `eq`, `le`, `ge` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

### Custom Filters for Routing Engine

The Messaging API's routing engine will query agent preferences with parameters like:

```
GET /v1/agent-preferences/?filter=is_available:eq:true
```

More advanced filtering (e.g., "available_channels contains whatsapp" or "available_topics contains billing") requires JSONB array containment. Two approaches:

**Option A (Simpler):** Fetch all available agents and filter in the Messaging API's routing logic. Works well for small teams (< 100 agents).

**Option B (Scalable):** Add custom filter resolvers for JSONB array fields (like the Account API's `custom_filter_resolvers` pattern from PR #60). This enables:
```
GET /v1/agent-preferences/?filter=available_channels:contains:whatsapp&filter=is_available:eq:true
```

**Recommendation:** Start with Option A. Migrate to Option B when team size warrants it.

---

## Gateway Routes

Add endpoint definitions in `turumba_gateway/config/partials/endpoints/agent-preferences.json`:

```
POST   /v1/agent-preferences/
GET    /v1/agent-preferences/
GET    /v1/agent-preferences/me
PATCH  /v1/agent-preferences/me
GET    /v1/agent-preferences/{id}
PATCH  /v1/agent-preferences/{id}
DELETE /v1/agent-preferences/{id}
```

All routes target `gt_turumba_account_api:8000` with `no-op` encoding and require authentication.

**Note for service-to-service calls:** The Messaging API will call the Account API directly via Docker network (`http://gt_turumba_account_api:8000/v1/agent-preferences/`) — NOT through the gateway. These internal calls need a service-level auth mechanism (shared secret header or internal JWT). For MVP, the internal Docker network provides sufficient isolation.

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/agent_preference.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly
- [ ] Verify `user_id` unique constraint works

### 2. Schemas
- [ ] Create `src/schemas/agent_preference.py`
- [ ] `AgentPreferenceCreate` with validation (channel types, schedule format)
- [ ] `AgentPreferenceUpdate` (all fields optional)
- [ ] `AgentPreferenceResponse` with `from_attributes`
- [ ] `ScheduleBlock`, `AvailableHours`, `NotificationPreferences` sub-schemas

### 3. Service Classes
- [ ] Create `src/services/agent_preference/` directory
- [ ] `CreationService` — with duplicate `user_id` handling (409 conflict)
- [ ] `RetrievalService` — standard + `get_by_user_id` method
- [ ] `UpdateService` — standard

### 4. Controller
- [ ] Create `src/controllers/agent_preference.py`
- [ ] Extend `CRUDController`
- [ ] Define `FilterSortConfig`
- [ ] Define `SchemaConfig`
- [ ] Add `get_by_user_id` method for `/me` endpoint

### 5. Router
- [ ] Create `src/routers/agent_preference.py`
- [ ] Standard CRUD routes (`POST`, `GET` list, `GET` by id, `PATCH`, `DELETE`)
- [ ] `GET /v1/agent-preferences/me` — get own preferences
- [ ] `PATCH /v1/agent-preferences/me` — update own (auto-create if not exists)
- [ ] Register `/me` routes BEFORE `/{id}` routes
- [ ] All endpoints require authentication

### 6. Register Router
- [ ] Add agent preference router to `src/main.py`

### 7. Gateway Routes
- [ ] Create `config/partials/endpoints/agent-preferences.json` in turumba_gateway
- [ ] Import in `config/krakend.tmpl`

### 8. Tests
- [ ] Create agent preference
- [ ] Create duplicate `user_id` returns 409
- [ ] List all preferences (admin)
- [ ] Get by ID
- [ ] Update preferences
- [ ] Delete preferences
- [ ] `GET /me` — returns own preferences
- [ ] `GET /me` — returns 404 when no preferences set
- [ ] `PATCH /me` — updates existing preferences
- [ ] `PATCH /me` — auto-creates when none exist
- [ ] Filter by `is_available`
- [ ] Validation: invalid channel type rejected
- [ ] Validation: `max_concurrent_conversations` range enforced (1-50)
- [ ] Validation: schedule `days` values validated

---

## Acceptance Criteria

- [ ] `agent_preferences` table created via Alembic migration
- [ ] `user_id` unique constraint enforced (one preference row per user)
- [ ] Full CRUD endpoints at `/v1/agent-preferences/`
- [ ] `/me` endpoints work for self-service preference management
- [ ] `PATCH /me` auto-creates if no preferences exist
- [ ] Filtering works on `is_available`, `max_concurrent_conversations`
- [ ] Validation enforced for channel types, schedule format, capacity range
- [ ] Gateway routes configured and functional
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

- None (can be built in parallel with CONV-001)

## Blocks

- **CONV-003** (Bot Router) — queries agent preferences for routing decisions
