# RT-BE-002: ConversationConfig Model + CRUD

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P0 — Required for conversation creation flow
**Phase:** 1 — Data Foundation
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 3.5](../../../TURUMBA_REALTIME_MESSAGING.md#35-conversation_configs--messaging-api), [Section 9.3](../../../TURUMBA_REALTIME_MESSAGING.md#93-messaging-api--conversation-configs)

---

## Summary

Implement the `ConversationConfig` model with full CRUD endpoints. Configs are configurable rules that control **when, how, on which sources, and for whom** conversations can be created. An account can have **multiple configs**, each targeting different sources (channels and/or chat endpoints) and audiences. When an inbound message arrives, configs are evaluated in `priority` order — the **first match wins**.

This task covers the data model and management CRUD only. The runtime config evaluation logic (used by the inbound worker and visitor message handler) will be built in a later task.

---

## Database Model (`src/models/postgres/conversation_config.py`)

```python
from sqlalchemy import Boolean, CheckConstraint, Column, Index, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class ConversationConfig(PostgresBaseModel):
    __tablename__ = "conversation_configs"
    __table_args__ = (
        CheckConstraint(
            "audience_mode IN ('all', 'known_only', 'groups', 'allowlist')",
            name="ck_conversation_configs_audience_mode",
        ),
        CheckConstraint(
            "creation_mode IN ('auto', 'manual')",
            name="ck_conversation_configs_creation_mode",
        ),
        CheckConstraint(
            "reopen_policy IN ('reopen', 'new', 'threshold')",
            name="ck_conversation_configs_reopen_policy",
        ),
        UniqueConstraint("account_id", "name", name="uq_conversation_configs_account_name"),
        Index("ix_conversation_configs_active", "account_id", "is_active", "priority"),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)                       # "VIP WhatsApp Support", "Public Webchat"
    priority = Column(Integer, nullable=False)                       # evaluation order (lower = first)
    is_active = Column(Boolean, nullable=False, default=True)

    # Source targeting
    enabled_channels = Column(JSONB, nullable=False, default=list)         # channel UUIDs
    enabled_chat_endpoints = Column(JSONB, nullable=False, default=list)   # chat_endpoint UUIDs

    # Audience
    audience_mode = Column(String(20), nullable=False, default="all")
    allowed_groups = Column(JSONB, nullable=False, default=list)           # group UUIDs (Account API)
    allowed_contacts = Column(JSONB, nullable=False, default=list)         # contact UUIDs (Account API)

    # Conversation behavior
    creation_mode = Column(String(20), nullable=False, default="auto")
    reopen_policy = Column(String(20), nullable=False, default="reopen")
    reopen_window = Column(Integer, nullable=True)                         # hours (used when reopen_policy = "threshold")

    # Default routing
    default_team_id = Column(Uuid(as_uuid=True), nullable=True)
    default_assignee_id = Column(Uuid(as_uuid=True), nullable=True)

    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)
```

Re-export in `src/models/postgres/__init__.py` for Alembic detection.

### Constraints

| Constraint | Type | Purpose |
|-----------|------|---------|
| `uq_conversation_configs_account_name` | UNIQUE | No duplicate config names within an account |
| `ix_conversation_configs_active` | INDEX | Fast lookup of active configs ordered by priority |
| `ck_conversation_configs_audience_mode` | CHECK | Restrict to `all`, `known_only`, `groups`, `allowlist` |
| `ck_conversation_configs_creation_mode` | CHECK | Restrict to `auto`, `manual` |
| `ck_conversation_configs_reopen_policy` | CHECK | Restrict to `reopen`, `new`, `threshold` |

---

## Schemas (`src/schemas/conversation_config.py`)

```python
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator


class AudienceMode(str, Enum):
    ALL = "all"
    KNOWN_ONLY = "known_only"
    GROUPS = "groups"
    ALLOWLIST = "allowlist"


class CreationMode(str, Enum):
    AUTO = "auto"
    MANUAL = "manual"


class ReopenPolicy(str, Enum):
    REOPEN = "reopen"
    NEW = "new"
    THRESHOLD = "threshold"


class ConversationConfigCreate(BaseModel):
    name: str
    priority: int
    is_active: bool = True
    enabled_channels: list[UUID] = []
    enabled_chat_endpoints: list[UUID] = []
    audience_mode: AudienceMode = AudienceMode.ALL
    allowed_groups: list[UUID] = []
    allowed_contacts: list[UUID] = []
    creation_mode: CreationMode = CreationMode.AUTO
    reopen_policy: ReopenPolicy = ReopenPolicy.REOPEN
    reopen_window: int | None = None
    default_team_id: UUID | None = None
    default_assignee_id: UUID | None = None
    metadata: dict | None = None

    @model_validator(mode="after")
    def validate_reopen_window(self):
        if self.reopen_policy == ReopenPolicy.THRESHOLD and self.reopen_window is None:
            msg = "reopen_window is required when reopen_policy is 'threshold'"
            raise ValueError(msg)
        if self.reopen_policy != ReopenPolicy.THRESHOLD and self.reopen_window is not None:
            msg = "reopen_window should only be set when reopen_policy is 'threshold'"
            raise ValueError(msg)
        return self

    @model_validator(mode="after")
    def validate_source_targeting(self):
        if not self.enabled_channels and not self.enabled_chat_endpoints:
            msg = "At least one of enabled_channels or enabled_chat_endpoints must be provided"
            raise ValueError(msg)
        return self


class ConversationConfigUpdate(BaseModel):
    name: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    enabled_channels: list[UUID] | None = None
    enabled_chat_endpoints: list[UUID] | None = None
    audience_mode: AudienceMode | None = None
    allowed_groups: list[UUID] | None = None
    allowed_contacts: list[UUID] | None = None
    creation_mode: CreationMode | None = None
    reopen_policy: ReopenPolicy | None = None
    reopen_window: int | None = None
    default_team_id: UUID | None = None
    default_assignee_id: UUID | None = None
    metadata: dict | None = None


class ConversationConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    name: str
    priority: int
    is_active: bool
    enabled_channels: list[UUID]
    enabled_chat_endpoints: list[UUID]
    audience_mode: str
    allowed_groups: list[UUID]
    allowed_contacts: list[UUID]
    creation_mode: str
    reopen_policy: str
    reopen_window: int | None
    default_team_id: UUID | None
    default_assignee_id: UUID | None
    metadata: dict | None
    created_at: datetime
    updated_at: datetime
```

**Schema validation notes:**

- `ConversationConfigCreate` enforces: if `reopen_policy` is `"threshold"`, `reopen_window` must be provided (and vice versa)
- `ConversationConfigCreate` enforces: at least one of `enabled_channels` or `enabled_chat_endpoints` must be non-empty
- `ConversationConfigUpdate` does NOT enforce these validators (partial update — validation happens at the controller level after merging with existing data)
- Add `from datetime import datetime` import

---

## Controller (`src/controllers/conversation_config.py`)

Extend `CRUDController[ConversationConfig, ConversationConfigCreate, ConversationConfigUpdate, ConversationConfigResponse]`.

**Key behaviors:**

1. **Default filter:** `account_id:in:{x-account-ids}` (tenant isolation)
2. **Default ordering:** `priority ASC` (configs are listed in evaluation order)
3. **Source overlap warning on create/update:**
   - When a config is created or updated, check if any source UUID (from `enabled_channels` or `enabled_chat_endpoints`) already appears in another **active** config for the same account
   - If overlap detected: **not a hard error** — return the created/updated config normally but include a `warning` field in the response: `"Source {uuid} also appears in config '{name}' (priority {n}). First matching config wins at runtime."`
   - Implementation: query `ConversationConfig` for the same `account_id` where `is_active = true` and `id != current_config_id`, then check JSONB array overlap
4. **Reopen window validation on update:** If the update changes `reopen_policy` to `"threshold"`, verify that `reopen_window` is also provided (either in the update payload or already set on the existing record). Return 400 if missing.

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `name` | `eq`, `contains`, `icontains` | No |
| `is_active` | `eq` | No |
| `audience_mode` | `eq`, `in` | No |
| `creation_mode` | `eq` | No |
| `reopen_policy` | `eq` | No |
| `priority` | `eq`, `lt`, `le`, `gt`, `ge` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Router (`src/routers/conversation_config.py`)

```
POST   /v1/conversation-configs/          -- Create config (account-scoped)
GET    /v1/conversation-configs/          -- List configs (account-scoped, ordered by priority)
GET    /v1/conversation-configs/{id}      -- Detail
PATCH  /v1/conversation-configs/{id}      -- Update config
DELETE /v1/conversation-configs/{id}      -- Delete config (204)
```

Register in `src/main.py`.

---

## Alembic Migration

Generate with: `alembic revision --autogenerate -m "add conversation_configs table"`

Verify the migration includes:
- All columns with correct types, defaults, and nullability
- UNIQUE constraint on `(account_id, name)`
- Composite index on `(account_id, is_active, priority)`
- All 3 CHECK constraints
- Proper downgrade (drop table)

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/conversation_config.py` with all fields, constraints, and index
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Generate Alembic migration
- [ ] Verify migration applies cleanly: `alembic upgrade head`

### 2. Schemas
- [ ] Create `src/schemas/conversation_config.py` with Create, Update, Response schemas
- [ ] Define `AudienceMode`, `CreationMode`, `ReopenPolicy` enums
- [ ] Implement `reopen_window` validation on Create schema
- [ ] Implement source targeting validation (at least one list non-empty) on Create schema

### 3. Service Layer
- [ ] Create `src/services/conversation_config/` directory
- [ ] Implement `ConversationConfigCreationService`
- [ ] Implement `ConversationConfigRetrievalService`
- [ ] Implement `ConversationConfigUpdateService`

### 4. Controller
- [ ] Create `src/controllers/conversation_config.py` extending `CRUDController`
- [ ] Define `_FILTER_SORT_CONFIG` with allowed filters and sorts
- [ ] Set default ordering to `priority ASC`
- [ ] Implement source overlap warning logic on create and update
- [ ] Implement `reopen_window` cross-field validation on update

### 5. Router
- [ ] Create `src/routers/conversation_config.py`
- [ ] Register all CRUD endpoints
- [ ] Register router in `src/main.py`

### 6. Tests
- [ ] Create config with all fields populated
- [ ] Create config with `reopen_policy = "threshold"` but no `reopen_window` -> 422
- [ ] Create config with `reopen_policy = "reopen"` and `reopen_window` set -> 422
- [ ] Create config with empty `enabled_channels` and empty `enabled_chat_endpoints` -> 422
- [ ] Create two configs with same name for same account -> 409 (unique constraint)
- [ ] List configs -> ordered by `priority ASC`
- [ ] Update config: change priority, verify new ordering
- [ ] Source overlap warning: create config A with channel X, create config B with channel X -> B returns with warning
- [ ] Filter by `is_active`, `audience_mode`, `priority`
- [ ] Account scoping via `x-account-ids`
- [ ] Delete config -> 204

---

## Acceptance Criteria

- [ ] `conversation_configs` table created via Alembic with all constraints and index
- [ ] UNIQUE constraint on `(account_id, name)` enforced
- [ ] Configs listed in `priority ASC` order by default
- [ ] `reopen_window` required when `reopen_policy = "threshold"` (validated on create and update)
- [ ] At least one source list required on create
- [ ] Source overlap produces a **warning** (not an error) in the response
- [ ] Full CRUD at `/v1/conversation-configs/` with filtering, sorting, pagination
- [ ] Account scoping enforced on all endpoints
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

None — can be built in parallel with RT-BE-001.

## Blocks

- **Inbound flow task** (future) — uses configs for conversation creation decisions
- **Visitor message handler** (future) — evaluates configs to determine if conversation is allowed
