# RT-ACC-001: Teams + Team Members — Models & CRUD

**Type:** Backend
**Service:** turumba_account_api
**Assignee:** tesfayegirma-116
**Priority:** P0 — Foundation for conversation routing
**Phase:** 1 — Data Foundation
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 3.6](../../../TURUMBA_REALTIME_MESSAGING.md#36-teams--team_members--account-api), [Section 9.4](../../../TURUMBA_REALTIME_MESSAGING.md#94-account-api--teams)

---

## Summary

Implement Teams and TeamMembers in the Account API. Teams organize agents into functional groups for conversation routing — a conversation can be assigned to a team (all team members see it) before being picked up by an individual agent. TeamMembers is an M:N junction table following the same pattern as `AccountUser` (`src/models/postgres/account.py`).

---

## Database Model — Team (`src/models/postgres/team.py`)

```python
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from src.models.postgres.base import PostgresBaseModel


class Team(PostgresBaseModel):
    """Team model — organizes agents for conversation routing."""

    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_teams_account_name"),
        Index("ix_teams_account_active", "account_id", "is_active"),
    )

    account_id = Column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    lead_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active = Column(Boolean, nullable=False, default=True)
    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)

    # Relationships
    account = relationship("Account")
    lead = relationship("User", foreign_keys=[lead_id])
    members = relationship("TeamMember", back_populates="team", cascade="all, delete-orphan")
```

Re-export in `src/models/postgres/__init__.py`:

```python
from .team import Team, TeamMember
```

## Database Model — TeamMember (`src/models/postgres/team.py`)

Add in the same file as `Team`:

```python
class TeamMember(PostgresBaseModel):
    """M:N junction — same pattern as AccountUser."""

    __tablename__ = "team_members"
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_member"),
        CheckConstraint(
            "role IN ('member', 'lead')",
            name="ck_team_members_role",
        ),
    )

    team_id = Column(
        UUID(as_uuid=True),
        ForeignKey("teams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(20), nullable=False, default="member")

    # Relationships
    team = relationship("Team", back_populates="members")
    user = relationship("User")
```

> **Note:** `PostgresBaseModel` provides `id` (UUID PK), `created_at`, and `updated_at` automatically. Do not redefine these.

---

## Schemas (`src/schemas/team.py`)

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TeamCreate(BaseModel):
    name: str
    description: str | None = None
    lead_id: UUID | None = None
    is_active: bool = True
    metadata: dict | None = None


class TeamUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    lead_id: UUID | None = None
    is_active: bool | None = None
    metadata: dict | None = None


class TeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    name: str
    description: str | None
    lead_id: UUID | None
    is_active: bool
    metadata: dict | None
    created_at: datetime
    updated_at: datetime


class TeamMemberCreate(BaseModel):
    user_id: UUID
    role: str = "member"


class TeamMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    team_id: UUID
    user_id: UUID
    role: str
    created_at: datetime
```

> **Metadata convention reminder:** Model column is `metadata_`, schema field is `metadata` with `validation_alias="metadata_"` if needed.

---

## Controller (`src/controllers/team.py`)

Extend `CRUDController[Team, TeamCreate, TeamUpdate, TeamResponse]`.

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `name` | `eq`, `contains`, `icontains` | Yes |
| `is_active` | `eq` | No |
| `lead_id` | `eq` | No |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

- **Default filter:** `account_id:in:{x-account-ids}` (tenant isolation, injected by `set_header_context`)
- Validate `lead_id` references a user that exists in the same account on create/update
- On create, auto-set `account_id` from the first allowed account ID in the header context

---

## Service (`src/services/team/`)

Follow the standard three-class pattern:

- `src/services/team/__init__.py`
- `src/services/team/creation.py` — `TeamCreationService`: validates `account_id` against gateway-allowed values, validates `lead_id` exists
- `src/services/team/retrieval.py` — `TeamRetrievalService`: builds default filters (account scoping), standard list/get
- `src/services/team/update.py` — `TeamUpdateService`: field-level updates, validates `lead_id` if provided

### TeamMemberService (`src/services/team/team_member.py`)

Fourth service for sub-resource membership operations (same pattern as `AccountUserService`):

- `add_member(team_id, user_id, role)` — validate team exists, validate user exists in account, check unique constraint
- `remove_member(team_id, user_id)` — find and delete, return 404 if not found
- `list_members(team_id, skip, limit)` — return paginated team members
- `count_members(team_id)` — return total count
- `get_user_teams(user_id, account_ids)` — return teams the user belongs to (filtered by allowed accounts)

---

## Dependency (`src/dependencies/team.py`)

Factory function returning the controller instance, following the existing pattern in `src/dependencies/`.

---

## Router (`src/routers/team.py`)

Define sub-resource routes **before** calling `create_crud_routes()` so they take precedence over the `/{id}` catch-all.

```python
router = APIRouter(prefix="/v1/teams", tags=["teams"])

# --- Sub-resource routes (define BEFORE create_crud_routes) ---

@router.post("/{id}/members", response_model=SuccessResponse[TeamMemberResponse], status_code=201)
async def add_team_member(id: UUID, body: TeamMemberCreate, ...):
    """Add a member to a team. Validates user exists in the same account."""
    ...

@router.get("/{id}/members", response_model=ListResponse[TeamMemberResponse])
async def list_team_members(id: UUID, skip: int = 0, limit: int = 100, ...):
    """List all members of a team."""
    ...

@router.delete("/{id}/members/{user_id}", status_code=204)
async def remove_team_member(id: UUID, user_id: UUID, ...):
    """Remove a member from a team."""
    ...

# --- Standard CRUD (generated) ---
create_crud_routes(router, get_team_controller, config)
```

### User's Teams Convenience Endpoint

Add a separate router or add to an existing user-related router:

```
GET /v1/users/{id}/teams → ListResponse[TeamResponse]
```

Returns all teams the specified user belongs to, scoped by `x-account-ids`. All handlers call `controller.set_header_context(request.headers)` and `controller.set_current_user(user)`.

### API Endpoints Summary

```
POST   /v1/teams/                        # Create team
GET    /v1/teams/                        # List teams (account-scoped, filtered/sorted/paginated)
GET    /v1/teams/{id}                    # Team detail
PATCH  /v1/teams/{id}                    # Update team
DELETE /v1/teams/{id}                    # Delete team (204)

POST   /v1/teams/{id}/members           # Add member { user_id, role }
GET    /v1/teams/{id}/members           # List members
DELETE /v1/teams/{id}/members/{user_id} # Remove member (204)

GET    /v1/users/{id}/teams             # List teams a user belongs to
```

---

## Alembic Migration

Generate after models are created:

```bash
alembic revision --autogenerate -m "Add teams and team_members tables"
alembic upgrade head
```

Verify the migration creates:
- `teams` table with `uq_teams_account_name` unique constraint, `ix_teams_account_active` index
- `team_members` table with `uq_team_member` unique constraint, `ck_team_members_role` check constraint

---

## Tasks

### 1. Models
- [ ] Create `src/models/postgres/team.py` with `Team` and `TeamMember` models
- [ ] Add `Team, TeamMember` imports to `src/models/postgres/__init__.py`
- [ ] Generate Alembic migration
- [ ] Verify migration applies and rolls back cleanly

### 2. Schemas
- [ ] Create `src/schemas/team.py` with `TeamCreate`, `TeamUpdate`, `TeamResponse`, `TeamMemberCreate`, `TeamMemberResponse`
- [ ] Handle `metadata_` → `metadata` alias convention

### 3. Services
- [ ] Create `src/services/team/__init__.py`
- [ ] Create `src/services/team/creation.py` — `TeamCreationService`
- [ ] Create `src/services/team/retrieval.py` — `TeamRetrievalService`
- [ ] Create `src/services/team/update.py` — `TeamUpdateService`
- [ ] Create `src/services/team/team_member.py` — `TeamMemberService` (add/remove/list/count/user-teams)

### 4. Controller
- [ ] Create `src/controllers/team.py` extending `CRUDController`
- [ ] Define `_FILTER_SORT_CONFIG` with allowed filters and sorts
- [ ] Define `_SCHEMA_CONFIG` with field permissions
- [ ] Add `lead_id` validation on create/update

### 5. Dependency
- [ ] Create `src/dependencies/team.py` with controller factory function

### 6. Router
- [ ] Create `src/routers/team.py`
- [ ] Define sub-resource routes for team members (POST, GET, DELETE)
- [ ] Add `GET /v1/users/{id}/teams` convenience endpoint
- [ ] Call `create_crud_routes()` for standard CRUD
- [ ] Register router in `src/main.py`

### 7. Tests
- [ ] Team CRUD: create, list with filters, get by ID, update, delete
- [ ] Team: unique constraint on (account_id, name) — verify 409 on duplicate
- [ ] Team: account scoping via `x-account-ids` header
- [ ] Team: filter by name (contains, icontains), is_active, lead_id
- [ ] TeamMember: add member, list members, remove member
- [ ] TeamMember: unique constraint on (team_id, user_id)
- [ ] TeamMember: role check constraint ('member', 'lead')
- [ ] TeamMember: cascade delete when team is deleted
- [ ] User teams: `GET /v1/users/{id}/teams` returns correct teams

---

## Acceptance Criteria

- [ ] `teams` table created via Alembic with all indexes, unique constraints, and FKs
- [ ] `team_members` table created with unique constraint, check constraint, and cascade delete
- [ ] Full CRUD at `/v1/teams/` with filtering, sorting, pagination
- [ ] Sub-resource endpoints for team membership work correctly (add/list/remove)
- [ ] `GET /v1/users/{id}/teams` returns teams for a user, scoped by account
- [ ] Tenant isolation enforced via `x-account-ids` default filter
- [ ] `lead_id` validated against users in the same account
- [ ] All tests passing, Ruff clean, coverage threshold met (50%)

---

## Notes

- Same pattern as existing `groups` + `group_contacts` (MongoDB M:N) but this is PostgreSQL-only
- The junction table pattern mirrors `AccountUser` in `src/models/postgres/account.py`
- `team_id` on conversations is a cross-service reference (Messaging API stores the UUID but does not FK to it)
- The `lead_id` on the teams table references `users` (same database), so it can be validated on create/update
- The `GET /v1/users/{id}/teams` endpoint may need to be added to the existing user router — define it before `create_crud_routes()` to avoid the `/{id}` catch-all conflict

## Dependencies

None — this is a new foundation entity.

## Blocks

- **RT-ACC-002** (Internal Contact Endpoints) — independent, can be parallel
- **CONV-BE-001** (Conversation Models) — `team_id` on conversations references teams
- **CONV-BE-005** (Inbound Flow) — conversation routing assigns to teams
