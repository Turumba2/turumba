# PERF-BE-001: In-Process Cache for AccountApiClient

**Type:** Backend — Performance
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** [#59](https://github.com/Turumba2/turumba_messaging_api/issues/59)
**Feature Area:** Cross-Service Enrichment
**Depends On:** None (standalone improvement)

---

## Summary

`AccountApiClient` makes an HTTP call to the Account API for every enrichment — even for the same account, user, or group fetched seconds apart. The existing per-request dedup (batch-fetching unique IDs across a list response) helps within a single API call, but there is no cross-request caching.

This task adds a **TTL-based in-process cache** inside `AccountApiClient` for the five read-only fetch methods. No new infrastructure is required — `cachetools.TTLCache` is a lightweight pure-Python dict with automatic expiry.

---

## What to Cache

| Method | Endpoint | Cache | TTL | Key |
|---|---|---|---|---|
| `get_account(account_id)` | `GET /internal/accounts/{id}` | Yes | 5 min | `str(account_id)` |
| `get_person(person_id)` | `GET /internal/persons/{id}` | Yes | 2 min | `person_id` |
| `get_group(group_id)` | `GET /internal/groups/{id}` | Yes | 2 min | `group_id` |
| `get_user(user_id, auth)` | `GET /users/{id}` | Yes | 5 min | `str(user_id)` |
| `get_contact(contact_id, auth)` | `GET /persons/{id}` | Yes | 1 min | `contact_id` |
| `get_group_members(...)` | `GET /internal/groups/{id}/{type}` | **No** | — | Paginated, dynamic |
| `upsert_contact_by_sender(...)` | `POST /internal/contacts/upsert` | **No** | — | Write operation |

**Auth-forwarded calls** (`get_user`, `get_contact`): cache by entity ID only, not by auth token. The response payload is the same regardless of which authenticated user requests it — the gateway controls access before the request reaches this service.

**Only cache non-`None` results.** A `None` return means a transient failure or 404; caching it would poison subsequent requests for a valid entity.

---

## Architecture

`AccountApiClient` is already a **singleton** (created once in `lifespan`, stored in `app.state`). An in-process `TTLCache` on the instance is the correct layer — it is shared across all requests served by the same process without any network overhead.

Workers (`group_message_processor`, `inbound_message_worker`) create their own `AccountApiClient` instances. They will each get their own cache — this is fine since workers are long-lived processes that will benefit from repeated lookups within their own batch loops.

```
Request A → AccountApiClient (singleton)
               ├─ get_account("abc") → MISS → HTTP → store → return
               └─ (cache now has "abc" for 5 min)

Request B → AccountApiClient (same instance)
               └─ get_account("abc") → HIT → return (no HTTP)
```

---

## Files to Change

| # | File | Change |
|---|------|--------|
| 1 | `requirements.txt` | Add `cachetools>=5.3` |
| 2 | `src/config/config.py` | Add cache TTL and maxsize settings |
| 3 | `src/clients/account_api.py` | Add `TTLCache` instances in `__init__`, wrap 5 fetch methods |

### File to Add

| File | Purpose |
|------|---------|
| `tests/unit/clients/test_account_api_cache.py` | Unit tests for cache hit/miss behavior |

---

## Implementation Details

### 1. `requirements.txt`

Add after the `httpx` line:

```
cachetools>=5.3
```

### 2. `src/config/config.py`

Add a new section under `# Account API`:

```python
# Account API Client Cache (TTL in seconds; maxsize = max cached entries per entity type)
ACCOUNT_CACHE_TTL: int = 300      # 5 min
USER_CACHE_TTL: int = 300         # 5 min
CONTACT_CACHE_TTL: int = 60       # 1 min — shorter: auth-forwarded, membership changes
PERSON_CACHE_TTL: int = 120       # 2 min
GROUP_CACHE_TTL: int = 120        # 2 min
ACCOUNT_CACHE_MAXSIZE: int = 500
USER_CACHE_MAXSIZE: int = 1000
CONTACT_CACHE_MAXSIZE: int = 2000
PERSON_CACHE_MAXSIZE: int = 2000
GROUP_CACHE_MAXSIZE: int = 500
```

Setting a TTL to `0` disables the cache for that entity (useful in tests or if fresh data is always needed).

### 3. `src/clients/account_api.py`

#### Imports to add

```python
from cachetools import TTLCache
```

#### `__init__` — add caches

```python
def __init__(self, base_url: str) -> None:
    self._base_url = base_url.rstrip("/")
    self._client = httpx.AsyncClient(timeout=_TIMEOUT)
    self._account_cache: TTLCache = TTLCache(
        maxsize=settings.ACCOUNT_CACHE_MAXSIZE, ttl=settings.ACCOUNT_CACHE_TTL
    )
    self._user_cache: TTLCache = TTLCache(
        maxsize=settings.USER_CACHE_MAXSIZE, ttl=settings.USER_CACHE_TTL
    )
    self._contact_cache: TTLCache = TTLCache(
        maxsize=settings.CONTACT_CACHE_MAXSIZE, ttl=settings.CONTACT_CACHE_TTL
    )
    self._person_cache: TTLCache = TTLCache(
        maxsize=settings.PERSON_CACHE_MAXSIZE, ttl=settings.PERSON_CACHE_TTL
    )
    self._group_cache: TTLCache = TTLCache(
        maxsize=settings.GROUP_CACHE_MAXSIZE, ttl=settings.GROUP_CACHE_TTL
    )
```

#### Wrap each fetch method

Use this pattern (skip the cache lookup when `TTLCache.maxsize == 0` or `ttl == 0` to allow disabling):

```python
async def get_account(self, account_id: UUID) -> dict | None:
    key = str(account_id)
    if key in self._account_cache:
        return self._account_cache[key]
    result = await self._internal_get(f"{self._base_url}/internal/accounts/{account_id}")
    if result is not None:
        self._account_cache[key] = result
    return result

async def get_person(self, person_id: str, _auth: str | None = None) -> dict | None:
    if person_id in self._person_cache:
        return self._person_cache[person_id]
    result = await self._internal_get(f"{self._base_url}/internal/persons/{person_id}")
    if result is not None:
        self._person_cache[person_id] = result
    return result

async def get_group(self, group_id: str) -> dict | None:
    if group_id in self._group_cache:
        return self._group_cache[group_id]
    result = await self._internal_get(f"{self._base_url}/internal/groups/{group_id}")
    if result is not None:
        self._group_cache[group_id] = result
    return result

async def get_user(self, user_id: UUID, auth: str | None) -> dict | None:
    key = str(user_id)
    if key in self._user_cache:
        return self._user_cache[key]
    result = await self._get(f"{self._base_url}/users/{user_id}", auth)
    if result is not None:
        self._user_cache[key] = result
    return result

async def get_contact(self, contact_id: str, auth: str | None) -> dict | None:
    if contact_id in self._contact_cache:
        return self._contact_cache[contact_id]
    result = await self._get(f"{self._base_url}/persons/{contact_id}", auth)
    if result is not None:
        self._contact_cache[contact_id] = result
    return result
```

`get_group_members` and `upsert_contact_by_sender` are **not modified**.

---

## Tests

File: `tests/unit/clients/test_account_api_cache.py`

Use `unittest.mock.AsyncMock` to patch `AccountApiClient._internal_get` and `AccountApiClient._get`. Verify:

1. **Cache miss on first call** — underlying method is called once, result returned.
2. **Cache hit on second call** — underlying method is NOT called again; same result returned.
3. **Cache miss after TTL expiry** — use `freezegun` or manually replace the cache with `TTLCache(maxsize=..., ttl=0.001)` and `asyncio.sleep` to let it expire; verify underlying method is called again.
4. **`None` results are not cached** — when the underlying fetch returns `None`, a subsequent call still hits the underlying method.
5. **Separate caches per entity type** — a `get_account` cache hit does not affect `get_group` lookups.

```python
import asyncio
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from cachetools import TTLCache

from src.clients.account_api import AccountApiClient


@pytest.fixture
def client():
    return AccountApiClient("http://test-account-api")


@pytest.mark.unit
async def test_get_account_caches_result(client):
    account_id = uuid4()
    expected = {"id": str(account_id), "name": "Acme"}

    with patch.object(client, "_internal_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = expected

        result1 = await client.get_account(account_id)
        result2 = await client.get_account(account_id)

    assert result1 == expected
    assert result2 == expected
    mock_get.assert_called_once()  # second call served from cache


@pytest.mark.unit
async def test_get_account_does_not_cache_none(client):
    account_id = uuid4()

    with patch.object(client, "_internal_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = None

        await client.get_account(account_id)
        await client.get_account(account_id)

    assert mock_get.call_count == 2  # None was not cached


@pytest.mark.unit
async def test_get_account_cache_expires(client):
    account_id = uuid4()
    expected = {"id": str(account_id), "name": "Acme"}
    client._account_cache = TTLCache(maxsize=10, ttl=0.05)  # 50 ms TTL

    with patch.object(client, "_internal_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = expected

        await client.get_account(account_id)
        await asyncio.sleep(0.1)  # wait for TTL to expire
        await client.get_account(account_id)

    assert mock_get.call_count == 2


@pytest.mark.unit
async def test_get_user_caches_by_id_not_auth(client):
    user_id = uuid4()
    expected = {"id": str(user_id), "email": "user@example.com"}

    with patch.object(client, "_get", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = expected

        await client.get_user(user_id, auth="Bearer token-a")
        await client.get_user(user_id, auth="Bearer token-b")  # different auth

    mock_get.assert_called_once()  # cached after first call regardless of auth
```

---

## Acceptance Criteria

- [ ] `cachetools` added to `requirements.txt`
- [ ] Cache TTL/maxsize settings added to `src/config/config.py` with documented defaults
- [ ] `AccountApiClient.__init__` initializes five `TTLCache` instances from settings
- [ ] `get_account`, `get_person`, `get_group`, `get_user`, `get_contact` serve results from cache on repeated calls for the same ID
- [ ] `None` results are never stored in the cache
- [ ] `get_group_members` and `upsert_contact_by_sender` are unchanged
- [ ] All unit tests in `tests/unit/clients/test_account_api_cache.py` pass
- [ ] Existing integration tests continue to pass (`pytest -m integration`)
- [ ] `ruff check .` passes with no new errors
