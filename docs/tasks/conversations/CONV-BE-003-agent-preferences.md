# CONV-BE-003: Agent Preferences Model & CRUD

**Type:** Backend
**Service:** turumba_account_api
**Priority:** P0 — Required for agent routing
**Phase:** 1 — Conversation Foundation
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Add the `AgentPreference` model to the Account API — a one-to-one relationship with users that stores agent availability, working hours, channel/topic preferences, and capacity. This data drives the agent routing algorithm in the Messaging API.

---

## Part 1: AgentPreference Model

### Database Model (`src/models/postgres/agent_preference.py`)

```python
from sqlalchemy import Boolean, Column, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class AgentPreference(PostgresBaseModel):
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

Re-export in `src/models/postgres/__init__.py` for Alembic.

**Why user-scoped not account-scoped:** An agent's working hours, language skills, and availability are personal traits that don't change per workspace. If multi-account variance is needed later, migrate to `account_user_preferences`.

### Schemas (`src/schemas/agent_preference.py`)

```python
class AgentPreferenceCreate(BaseModel):
    available_channels: list[str] | None = None
    available_topics: list[str] | None = None
    available_hours: dict | None = None
    languages: list[str] | None = None
    max_concurrent_conversations: int = 5
    is_available: bool = True
    auto_accept: bool = False
    notification_preferences: dict | None = None

class AgentPreferenceUpdate(BaseModel):
    available_channels: list[str] | None = None
    available_topics: list[str] | None = None
    available_hours: dict | None = None
    languages: list[str] | None = None
    max_concurrent_conversations: int | None = None
    is_available: bool | None = None
    auto_accept: bool | None = None
    notification_preferences: dict | None = None

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

## Part 2: Endpoints

### Custom `/me` Endpoints

```
GET    /v1/agent-preferences/me         — get own preferences (auto-create if missing)
PATCH  /v1/agent-preferences/me         — update own preferences
```

The `/me` endpoint uses the authenticated user's ID (`get_current_user_id`) to look up or create the preference record. If no record exists on GET, return a default (or auto-create one).

### Admin/System Endpoints

```
GET    /v1/agent-preferences/           — list all (admin, for routing engine)
GET    /v1/agent-preferences/{user_id}  — get specific (admin/system)
```

The list endpoint is called by the Messaging API's agent routing algorithm (via service-to-service HTTP). Support filtering:

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `user_id` | `eq` | No |
| `is_available` | `eq` | No |
| `available_channels` | `contains` | No |
| `available_topics` | `contains` | No |
| `languages` | `contains` | No |
| `max_concurrent_conversations` | `ge`, `le` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |

---

## Part 3: Router

Define `/me` routes **before** CRUD routes in `src/routers/agent_preference.py`:

```python
@router.get("/me", response_model=SuccessResponse[AgentPreferenceResponse])
async def get_my_preferences(
    user_id: str = Depends(get_current_user_id),
    controller: AgentPreferenceController = Depends(get_agent_preference_controller),
):
    # Lookup by user_id, auto-create with defaults if not found
    ...

@router.patch("/me", response_model=SuccessResponse[AgentPreferenceResponse])
async def update_my_preferences(
    data: AgentPreferenceUpdate,
    user_id: str = Depends(get_current_user_id),
    controller: AgentPreferenceController = Depends(get_agent_preference_controller),
):
    # Find by user_id, update
    ...
```

Then use `create_crud_routes()` for the standard list and get-by-user_id endpoints (admin access).

---

## Tasks

- [ ] Create `src/models/postgres/agent_preference.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas in `src/schemas/agent_preference.py`
- [ ] Create service classes in `src/services/agent_preference/`
- [ ] Create controller in `src/controllers/agent_preference.py`
- [ ] Create router with `/me` endpoints defined before CRUD routes
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

---

## Tests

- [ ] `GET /me` returns existing preferences for authenticated user
- [ ] `GET /me` auto-creates default preferences if none exist
- [ ] `PATCH /me` updates only specified fields
- [ ] `GET /agent-preferences/` lists all (admin)
- [ ] `GET /agent-preferences/{user_id}` returns specific (admin)
- [ ] Filter by `is_available`, `available_channels`, `available_topics`
- [ ] Unique constraint on `user_id` prevents duplicates

---

## Acceptance Criteria

- [ ] `agent_preferences` table created via Alembic with unique constraint on `user_id`
- [ ] `/me` endpoints work for authenticated users (auto-create on first access)
- [ ] List/get endpoints support filtering needed by the routing engine
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

None — can be built in parallel with CONV-BE-001.

## Blocks

- **CONV-BE-005** (Inbound Flow + Agent Routing) — queries agent preferences for routing
- **CONV-GW-001** (Gateway Routes) — needs endpoints defined
