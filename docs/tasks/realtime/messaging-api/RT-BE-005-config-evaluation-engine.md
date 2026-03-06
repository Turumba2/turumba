# RT-BE-005: Config Evaluation Engine

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P0 --- Core decision logic for conversation creation
**Phase:** 2 --- Core Logic
**Depends On:** RT-BE-002 (ConversationConfig model)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md --- Section 4.1](../../TURUMBA_REALTIME_MESSAGING.md#41-full-decision-flow), [Config Evaluation Workflow](../../realtime/04-CONFIG-EVALUATION.md)

---

## Summary

Implement a pure-function config evaluation engine that determines whether an inbound message (from an IM channel or webchat endpoint) should create a conversation. The engine loads all active `ConversationConfig` records for an account, evaluates them in priority order against the message source and sender, and returns the first matching config. This is the central decision gate used by both the inbound IM worker (RT-BE-006) and the visitor message handler (RT-BE-007).

---

## Part 1: Return Types

### File: `src/services/conversation/config_evaluator.py`

```python
from dataclasses import dataclass

from src.models.postgres.conversation_config import ConversationConfig


@dataclass
class ConfigMatch:
    """A config matched the inbound message."""
    matched: bool = True
    config: ConversationConfig = None  # the winning config


@dataclass
class NoMatch:
    """No config matched --- no conversation should be created."""
    matched: bool = False
```

---

## Part 2: Config Cache

A simple in-memory dict keyed by `account_id`, storing loaded configs with a TTL of 5 minutes. This eliminates a DB query per inbound message.

```python
import time
from uuid import UUID

_CONFIG_CACHE: dict[UUID, tuple[list[ConversationConfig], float]] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes


def _get_cached_configs(account_id: UUID) -> list[ConversationConfig] | None:
    """Return cached configs if within TTL, else None."""
    entry = _CONFIG_CACHE.get(account_id)
    if entry is None:
        return None
    configs, cached_at = entry
    if time.monotonic() - cached_at > _CACHE_TTL_SECONDS:
        del _CONFIG_CACHE[account_id]
        return None
    return configs


def _set_cached_configs(account_id: UUID, configs: list[ConversationConfig]) -> None:
    _CONFIG_CACHE[account_id] = (configs, time.monotonic())


def invalidate_config_cache(account_id: UUID) -> None:
    """Call this on config create, update, or delete."""
    _CONFIG_CACHE.pop(account_id, None)
```

### Cache Invalidation

Wire `invalidate_config_cache(account_id)` into the ConversationConfig controller/service --- call it after every successful `create`, `update`, and `delete` operation. This ensures config changes take effect immediately (no stale cache).

---

## Part 3: Group Membership Cache

Cache group membership results to avoid repeated calls to the Account API for the same contact sending multiple messages.

```python
import hashlib

_MEMBERSHIP_CACHE: dict[str, tuple[bool, float]] = {}
_MEMBERSHIP_TTL_SECONDS = 300  # 5 minutes


def _membership_cache_key(contact_id: UUID, group_ids: list[UUID]) -> str:
    sorted_ids = sorted(str(g) for g in group_ids)
    ids_hash = hashlib.md5(",".join(sorted_ids).encode()).hexdigest()
    return f"membership:{contact_id}:{ids_hash}"


def _get_cached_membership(contact_id: UUID, group_ids: list[UUID]) -> bool | None:
    key = _membership_cache_key(contact_id, group_ids)
    entry = _MEMBERSHIP_CACHE.get(key)
    if entry is None:
        return None
    is_member, cached_at = entry
    if time.monotonic() - cached_at > _MEMBERSHIP_TTL_SECONDS:
        del _MEMBERSHIP_CACHE[key]
        return None
    return is_member


def _set_cached_membership(contact_id: UUID, group_ids: list[UUID], is_member: bool) -> None:
    key = _membership_cache_key(contact_id, group_ids)
    _MEMBERSHIP_CACHE[key] = (is_member, time.monotonic())
```

---

## Part 4: Evaluation Function

The main entry point. This is a pure function (no side effects beyond caching) that can be tested in isolation.

```python
from uuid import UUID

from sqlalchemy.orm import Session

from src.clients.account_api import AccountApiClient


async def evaluate_configs(
    account_id: UUID,
    source_type: str,           # "channel" or "chat_endpoint"
    source_id: UUID,            # channel_id or chat_endpoint_id
    contact_id: UUID | None,    # from contact lookup step, None if unknown sender
    db: Session,
    account_api_client: AccountApiClient,
) -> ConfigMatch | NoMatch:
    """
    Evaluate all active configs for an account against an inbound message.
    First match wins (priority order, lower number = first).

    Returns ConfigMatch with the winning config, or NoMatch.
    """
    # 1. Load configs (cached)
    configs = _get_cached_configs(account_id)
    if configs is None:
        configs = await _load_configs_from_db(account_id, db)
        _set_cached_configs(account_id, configs)

    if not configs:
        return NoMatch()

    # 2. Evaluate each config in priority order
    for config in configs:
        # 2a. SOURCE CHECK
        if not _source_matches(config, source_type, source_id):
            continue

        # 2b. AUDIENCE CHECK
        audience_result = await _audience_matches(
            config, contact_id, account_api_client
        )
        if audience_result:
            return ConfigMatch(config=config)

    # 3. No match
    return NoMatch()
```

### Config Loader

```python
async def _load_configs_from_db(account_id: UUID, db: Session) -> list[ConversationConfig]:
    """Load all active configs for an account, ordered by priority ASC."""
    import asyncio

    def _query():
        return (
            db.query(ConversationConfig)
            .filter(
                ConversationConfig.account_id == account_id,
                ConversationConfig.is_active.is_(True),
            )
            .order_by(ConversationConfig.priority.asc())
            .all()
        )

    return await asyncio.to_thread(_query)
```

### Source Matcher

```python
def _source_matches(config: ConversationConfig, source_type: str, source_id: UUID) -> bool:
    """Check if the inbound source is targeted by this config."""
    source_id_str = str(source_id)

    if source_type == "channel":
        enabled = config.enabled_channels or []
        return source_id_str in [str(c) for c in enabled]

    if source_type == "chat_endpoint":
        enabled = config.enabled_chat_endpoints or []
        return source_id_str in [str(c) for c in enabled]

    return False
```

### Audience Matcher

```python
async def _audience_matches(
    config: ConversationConfig,
    contact_id: UUID | None,
    account_api_client: AccountApiClient,
) -> bool:
    """Check if the sender passes the audience gate for this config."""
    mode = config.audience_mode

    if mode == "all":
        return True

    if mode == "known_only":
        return contact_id is not None

    if mode == "groups":
        if contact_id is None:
            return False
        group_ids = config.allowed_groups or []
        if not group_ids:
            return False
        return await _check_group_membership(contact_id, group_ids, account_api_client)

    if mode == "allowlist":
        if contact_id is None:
            return False
        # Check 1: Direct contact match
        allowed_contacts = config.allowed_contacts or []
        if str(contact_id) in [str(c) for c in allowed_contacts]:
            return True
        # Check 2: Group membership (same as "groups" mode)
        group_ids = config.allowed_groups or []
        if group_ids:
            return await _check_group_membership(contact_id, group_ids, account_api_client)
        return False

    return False


async def _check_group_membership(
    contact_id: UUID,
    group_ids: list[UUID],
    account_api_client: AccountApiClient,
) -> bool:
    """Check if contact belongs to any of the specified groups (cached)."""
    cached = _get_cached_membership(contact_id, group_ids)
    if cached is not None:
        return cached

    try:
        result = await account_api_client.check_group_membership(contact_id, group_ids)
        is_member = result.get("is_member", False)
    except Exception:
        # Account API unavailable --- treat as not a member
        is_member = False

    _set_cached_membership(contact_id, group_ids, is_member)
    return is_member
```

---

## Part 5: AccountApiClient Extension

### File: `src/clients/account_api.py` (extend existing)

Add one new method to the existing `AccountApiClient` class:

```python
async def check_group_membership(
    self, contact_id: UUID, group_ids: list[UUID]
) -> dict:
    """
    Check if a contact belongs to any of the specified groups.

    Calls: POST http://gt_turumba_account_api:8000/internal/contacts/check-membership
    Request:  { contact_id: "uuid", group_ids: ["uuid-1", "uuid-2"] }
    Response: { is_member: true, matched_groups: ["uuid-1"] }
    """
    response = await self._post(
        "/internal/contacts/check-membership",
        json={
            "contact_id": str(contact_id),
            "group_ids": [str(g) for g in group_ids],
        },
    )
    return response
```

**Note:** This calls the Account API's internal endpoint (Docker network only, no KrakenD). The Account API must have this endpoint implemented (see RT-ACC-002). If the Account API is unreachable, the caller treats the failure as `is_member = False` (degraded mode).

---

## Part 6: Config Cache Invalidation Wiring

After every config CRUD operation, invalidate the cache for that account. Add calls to the ConversationConfig service or controller:

```python
# In ConversationConfig creation/update/delete service methods:
from src.services.conversation.config_evaluator import invalidate_config_cache

# After successful create:
invalidate_config_cache(config.account_id)

# After successful update:
invalidate_config_cache(config.account_id)

# After successful delete:
invalidate_config_cache(config.account_id)
```

---

## Tasks

### Core Engine
- [ ] Create `src/services/conversation/config_evaluator.py`
- [ ] Implement `ConfigMatch` and `NoMatch` dataclasses
- [ ] Implement config cache (dict with TTL, `invalidate_config_cache()`)
- [ ] Implement group membership cache (dict with TTL)
- [ ] Implement `evaluate_configs()` main function
- [ ] Implement `_load_configs_from_db()` --- query active configs ordered by priority
- [ ] Implement `_source_matches()` --- check source_id against enabled_channels or enabled_chat_endpoints
- [ ] Implement `_audience_matches()` with all 4 audience modes:
  - [ ] `"all"` --- always matches
  - [ ] `"known_only"` --- matches only if contact_id is not None
  - [ ] `"groups"` --- contact_id exists + group membership check via Account API
  - [ ] `"allowlist"` --- direct contact list check, then group membership fallback
- [ ] Implement `_check_group_membership()` with caching + Account API call

### Account API Client
- [ ] Add `check_group_membership(contact_id, group_ids)` to `AccountApiClient`
- [ ] Handle timeouts/errors gracefully (return `is_member: false` on failure)

### Cache Invalidation Wiring
- [ ] Wire `invalidate_config_cache()` into ConversationConfig create flow
- [ ] Wire `invalidate_config_cache()` into ConversationConfig update flow
- [ ] Wire `invalidate_config_cache()` into ConversationConfig delete flow

---

## Tests

Use mocked configs (no real DB) and mocked Account API responses for the evaluation engine. Test all branches.

### Source Matching
- [ ] Channel source matches config with that channel in `enabled_channels`
- [ ] Channel source does NOT match config with only `enabled_chat_endpoints`
- [ ] Chat endpoint source matches config with that endpoint in `enabled_chat_endpoints`
- [ ] Chat endpoint source does NOT match config with only `enabled_channels`
- [ ] Source not in any config list --- skip config

### Audience Modes
- [ ] `"all"` --- always matches regardless of contact_id
- [ ] `"known_only"` with contact_id present --- MATCH
- [ ] `"known_only"` with contact_id = None --- SKIP
- [ ] `"groups"` with contact_id = None --- SKIP (can't check membership)
- [ ] `"groups"` with contact_id, is_member = true --- MATCH
- [ ] `"groups"` with contact_id, is_member = false --- SKIP
- [ ] `"groups"` with empty allowed_groups --- SKIP (no groups to check)
- [ ] `"allowlist"` with contact_id in allowed_contacts --- MATCH (no API call)
- [ ] `"allowlist"` with contact_id NOT in contacts, but in allowed_groups --- MATCH
- [ ] `"allowlist"` with contact_id NOT in contacts, NOT in groups --- SKIP
- [ ] `"allowlist"` with contact_id = None --- SKIP

### Priority Ordering
- [ ] First matching config wins (lower priority number evaluated first)
- [ ] Higher-priority config skipped, lower-priority config matches --- correct config returned
- [ ] VIP-first pattern: Config 1 (groups, VIP) skipped for unknown sender, Config 2 (all) matches

### Cache Behavior
- [ ] Config cache returns cached configs on second call (no DB query)
- [ ] Config cache invalidation clears cache for that account
- [ ] Group membership cache avoids second Account API call for same contact+groups
- [ ] Expired cache entries are not returned (TTL respected)

### Edge Cases
- [ ] No active configs for account --- return NoMatch
- [ ] Config with both `enabled_channels` and `enabled_chat_endpoints` set --- source matches either list
- [ ] Config with empty `enabled_channels` AND empty `enabled_chat_endpoints` --- never matches
- [ ] Account API down during group membership check --- treated as not a member, logged as degraded

### Worked Examples from Spec (Section 4.1.1)
- [ ] **Scenario A:** VIP customer sends Telegram message --- Config 1 matches (groups mode, member of VIP group)
- [ ] **Scenario B:** Unknown person sends Telegram message --- Config 1 skipped (groups, null contact), Config 2 matches (all)
- [ ] **Scenario C:** Visitor opens webchat --- Config 1 skipped (channel only), Config 2 skipped (channel only), Config 3 matches (chat_endpoint, all)
- [ ] **Scenario D:** WhatsApp message with no config covering WhatsApp --- all configs skipped, NoMatch returned

---

## Acceptance Criteria

- [ ] `evaluate_configs()` correctly evaluates all 4 audience modes with first-match-wins semantics
- [ ] Config cache eliminates repeated DB queries for the same account within 5 minutes
- [ ] Group membership cache eliminates repeated Account API calls for the same contact+groups within 5 minutes
- [ ] Cache invalidation on config CRUD ensures changes take effect immediately
- [ ] Account API failures degrade gracefully (treated as non-member, not as errors)
- [ ] All worked examples from spec Section 4.1.1 pass as test cases
- [ ] All tests passing, Ruff clean

---

## Dependencies

- **RT-BE-002** --- ConversationConfig model must exist with fields: `account_id`, `priority`, `is_active`, `enabled_channels`, `enabled_chat_endpoints`, `audience_mode`, `allowed_groups`, `allowed_contacts`, `creation_mode`, `reopen_policy`, `reopen_window`, `default_team_id`, `default_assignee_id`
- **RT-ACC-002** --- Account API internal endpoint `POST /internal/contacts/check-membership` (can stub in tests)

## Blocks

- **RT-BE-006** (Inbound Conversation Flow) --- calls `evaluate_configs()` for IM inbound messages
- **RT-BE-007** (Internal Visitor Endpoints) --- calls `evaluate_configs()` for webchat visitor messages
