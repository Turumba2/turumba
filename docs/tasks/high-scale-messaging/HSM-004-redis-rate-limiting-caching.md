# HSM-004: Redis Infrastructure, Rate Limiting & Credential Caching

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P1
**Feature Area:** High-Scale Messaging — Rate Limiting & Caching
**Architecture Reference:** [High-Scale Messaging Architecture](../../HIGH_SCALE_MESSAGING_ARCHITECTURE.md)

---

## Summary

Introduce Redis as a new infrastructure dependency and build three critical services on top of it: per-channel rate limiting (prevent provider throttling), channel credential caching (avoid DB hit per dispatch), and group message progress counters (real-time tracking). Then integrate the rate limiter into the dispatch worker.

Without rate limiting, sending a group message to 100K contacts would blast the provider at maximum speed, triggering throttling or account suspension. Without credential caching, every message dispatch requires a database query.

**Scope:**
- Redis connection setup and configuration
- Per-channel token bucket rate limiter
- Channel credential cache with TTL
- Group message progress counters (real-time)
- Dispatch deduplication locks
- Integration into dispatch worker (HSM-002)
- Docker Compose updates for Redis service

---

## Part 1: Redis Infrastructure

### New Dependency

```
# requirements.txt
redis[hiredis]>=5.0      # async Redis client with C parser
```

### Configuration

Add to `src/config/config.py`:

```python
# Redis
REDIS_URL: str = "redis://localhost:6379/0"
REDIS_MAX_CONNECTIONS: int = 20

# Rate Limiting
RATE_LIMIT_DEFAULT: int = 60            # messages per minute (if channel has no limit set)

# Credential Cache
CREDENTIAL_CACHE_TTL: int = 300         # seconds (5 minutes)

# Progress Counters
PROGRESS_COUNTER_TTL: int = 86400       # seconds (24 hours)
```

### Redis Client Setup

```python
# src/cache/redis_client.py
import redis.asyncio as redis
from src.config.config import settings

_pool: redis.ConnectionPool | None = None

async def get_redis() -> redis.Redis:
    """Get an async Redis client from the connection pool."""
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            max_connections=settings.REDIS_MAX_CONNECTIONS,
            decode_responses=True,
        )
    return redis.Redis(connection_pool=_pool)

async def close_redis() -> None:
    """Close the Redis connection pool (call on app shutdown)."""
    global _pool
    if _pool:
        await _pool.disconnect()
        _pool = None
```

### Directory Structure

```
src/cache/
├── __init__.py
├── redis_client.py           # Connection pool management
├── rate_limiter.py           # Per-channel rate limiting
├── credential_cache.py       # Channel credential caching
└── progress_counter.py       # Group message progress tracking
```

---

## Part 2: Per-Channel Rate Limiter

### File: `src/cache/rate_limiter.py`

Implements a sliding window counter using Redis. Each channel has a configured `rate_limit` (messages per minute).

```python
class ChannelRateLimiter:
    """
    Per-channel rate limiter using Redis sliding window counter.
    Prevents exceeding provider rate limits.
    """

    def __init__(self, redis: redis.Redis):
        self.redis = redis

    async def acquire(self, channel_id: str, rate_limit: int | None) -> bool:
        """
        Check if a message can be sent on this channel right now.

        Returns True if under the rate limit, False if limit reached.
        Uses a Redis key with 60-second TTL as a sliding window.
        """
        if not rate_limit:
            return True  # No limit configured

        key = f"rate_limit:{channel_id}"
        current = await self.redis.incr(key)
        if current == 1:
            await self.redis.expire(key, 60)
        return current <= rate_limit

    async def get_remaining(self, channel_id: str, rate_limit: int) -> int:
        """Get remaining capacity for this channel in the current window."""
        key = f"rate_limit:{channel_id}"
        current = int(await self.redis.get(key) or 0)
        return max(0, rate_limit - current)

    async def get_ttl(self, channel_id: str) -> int:
        """Seconds until the current rate limit window resets."""
        key = f"rate_limit:{channel_id}"
        ttl = await self.redis.ttl(key)
        return max(0, ttl)
```

### Three Levels of Rate Limiting

| Level | Key Pattern | Scope | Purpose |
|-------|-------------|-------|---------|
| Per-channel | `rate_limit:{channel_id}` | Single channel instance | Respect channel.rate_limit setting |
| Per-provider | `rate_limit:provider:{provider}:{account}` | All channels of same provider | Respect provider account limits (e.g., Twilio 100/sec) |
| Per-tenant | `rate_limit:tenant:{account_id}` | All channels in an account | Business-level usage caps |

Start with per-channel (Level 1). Add provider and tenant levels later as needed.

---

## Part 3: Credential Cache

### File: `src/cache/credential_cache.py`

Caches channel records in Redis to avoid a DB query per message dispatch.

```python
class CredentialCache:
    """
    Cache channel credentials in Redis with TTL.
    Dispatch workers check cache first, fall back to DB on miss.
    """

    def __init__(self, redis: redis.Redis):
        self.redis = redis
        self.ttl = settings.CREDENTIAL_CACHE_TTL

    async def get(self, channel_id: str) -> dict | None:
        """Get cached channel data. Returns None on miss."""
        key = f"channel:{channel_id}"
        data = await self.redis.get(key)
        if data:
            return json.loads(data)
        return None

    async def set(self, channel_id: str, channel_data: dict) -> None:
        """Cache channel data with TTL."""
        key = f"channel:{channel_id}"
        await self.redis.setex(key, self.ttl, json.dumps(channel_data, default=str))

    async def invalidate(self, channel_id: str) -> None:
        """Remove channel from cache (call on credential update)."""
        key = f"channel:{channel_id}"
        await self.redis.delete(key)

    async def get_or_load(self, channel_id: str, loader) -> dict:
        """
        Get from cache, or call loader() to fetch from DB and cache the result.

        Usage in dispatch worker:
            channel_data = await cache.get_or_load(
                channel_id,
                loader=lambda: load_channel_from_db(channel_id, db),
            )
        """
        cached = await self.get(channel_id)
        if cached:
            return cached
        data = await loader()
        if data:
            await self.set(channel_id, data)
        return data
```

### Cache Invalidation

When channel credentials are updated (via `PATCH /v1/channels/{id}`), the cache must be invalidated. Add a hook in the channel update router:

```python
# In channel PATCH router, after db.commit():
await credential_cache.invalidate(channel_id)
```

---

## Part 4: Group Message Progress Counters

### File: `src/cache/progress_counter.py`

Real-time progress counters using Redis atomic operations. Faster than hitting PostgreSQL for every single message delivery update.

```python
class ProgressCounter:
    """
    Track group message dispatch progress in Redis.
    Periodically sync to PostgreSQL for durability.
    """

    def __init__(self, redis: redis.Redis):
        self.redis = redis
        self.ttl = settings.PROGRESS_COUNTER_TTL

    async def increment_sent(self, group_message_id: str) -> int:
        key = f"gm_progress:{group_message_id}"
        return await self.redis.hincrby(key, "sent_count", 1)

    async def increment_delivered(self, group_message_id: str) -> int:
        key = f"gm_progress:{group_message_id}"
        return await self.redis.hincrby(key, "delivered_count", 1)

    async def increment_failed(self, group_message_id: str) -> int:
        key = f"gm_progress:{group_message_id}"
        return await self.redis.hincrby(key, "failed_count", 1)

    async def decrement_pending(self, group_message_id: str) -> int:
        key = f"gm_progress:{group_message_id}"
        return await self.redis.hincrby(key, "pending_count", -1)

    async def get_progress(self, group_message_id: str) -> dict:
        key = f"gm_progress:{group_message_id}"
        data = await self.redis.hgetall(key)
        return {k: int(v) for k, v in data.items()}

    async def init_progress(self, group_message_id: str, total: int) -> None:
        """Initialize counters when group message processing starts."""
        key = f"gm_progress:{group_message_id}"
        await self.redis.hset(key, mapping={
            "total_recipients": total,
            "pending_count": total,
            "sent_count": 0,
            "delivered_count": 0,
            "failed_count": 0,
        })
        await self.redis.expire(key, self.ttl)

    async def sync_to_db(self, group_message_id: str, db) -> None:
        """Flush Redis counters to PostgreSQL for durability."""
        progress = await self.get_progress(group_message_id)
        if progress:
            await db.execute(
                update(GroupMessage)
                .where(GroupMessage.id == group_message_id)
                .values(**progress)
            )
            await db.commit()
```

---

## Part 5: Dispatch Worker Integration

Update the dispatch worker (HSM-002) to use rate limiting and credential caching:

```python
class DispatchWorker:
    def __init__(self, channel_type: str):
        self.channel_type = channel_type
        self.redis = None
        self.rate_limiter = None
        self.credential_cache = None
        self.progress_counter = None

    async def start(self):
        self.redis = await get_redis()
        self.rate_limiter = ChannelRateLimiter(self.redis)
        self.credential_cache = CredentialCache(self.redis)
        self.progress_counter = ProgressCounter(self.redis)
        # ... start consuming

    async def process_message(self, event):
        # Load channel from cache (not DB every time)
        channel_data = await self.credential_cache.get_or_load(
            event["channel_id"],
            loader=lambda: self._load_channel_from_db(event["channel_id"]),
        )

        # Check rate limit before sending
        allowed = await self.rate_limiter.acquire(
            event["channel_id"],
            channel_data.get("rate_limit"),
        )
        if not allowed:
            # Requeue — don't process until rate limit window resets
            ttl = await self.rate_limiter.get_ttl(event["channel_id"])
            await asyncio.sleep(min(ttl, 5))
            await rmq_message.nack(requeue=True)
            return

        # ... dispatch via adapter ...

        # Update progress counters in Redis (fast)
        if event.get("group_message_id"):
            await self.progress_counter.increment_sent(event["group_message_id"])
            await self.progress_counter.decrement_pending(event["group_message_id"])
```

---

## Part 6: Docker Compose

Add Redis to the gateway's `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  platform: linux/amd64
  ports:
    - "6379:6379"
  volumes:
    - redis_data:/data
  networks:
    - gateway-network
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 3

volumes:
  redis_data:
```

---

## Tasks

### Part 1: Redis Setup
- [ ] Add `redis[hiredis]>=5.0` to `requirements.txt`
- [ ] Create `src/cache/__init__.py`
- [ ] Create `src/cache/redis_client.py` — connection pool, `get_redis()`, `close_redis()`
- [ ] Add `REDIS_URL`, `REDIS_MAX_CONNECTIONS` to config
- [ ] Register Redis lifecycle in `src/main.py` (startup/shutdown events)

### Part 2: Rate Limiter
- [ ] Create `src/cache/rate_limiter.py`
- [ ] `acquire()` — sliding window counter, returns bool
- [ ] `get_remaining()` — remaining capacity in current window
- [ ] `get_ttl()` — seconds until window resets
- [ ] Add `RATE_LIMIT_DEFAULT` to config

### Part 3: Credential Cache
- [ ] Create `src/cache/credential_cache.py`
- [ ] `get()`, `set()`, `invalidate()`, `get_or_load()`
- [ ] Add `CREDENTIAL_CACHE_TTL` to config
- [ ] Add cache invalidation hook in channel PATCH router

### Part 4: Progress Counters
- [ ] Create `src/cache/progress_counter.py`
- [ ] `increment_sent()`, `increment_delivered()`, `increment_failed()`, `decrement_pending()`
- [ ] `init_progress()`, `get_progress()`, `sync_to_db()`
- [ ] Add `PROGRESS_COUNTER_TTL` to config

### Part 5: Dispatch Worker Integration
- [ ] Initialize Redis, rate limiter, credential cache, progress counter in dispatch worker
- [ ] Use `credential_cache.get_or_load()` instead of direct DB query
- [ ] Check `rate_limiter.acquire()` before sending
- [ ] Use `progress_counter` for group message updates

### Part 6: Docker Compose
- [ ] Add Redis service to `docker-compose.yml`
- [ ] Add `REDIS_URL` to `.env.example`

### Part 7: Tests
- [ ] Rate limiter: under limit → returns True
- [ ] Rate limiter: at limit → returns False
- [ ] Rate limiter: window expires → allows again
- [ ] Rate limiter: no limit configured → always allows
- [ ] Credential cache: set + get returns cached data
- [ ] Credential cache: expired TTL → returns None
- [ ] Credential cache: invalidate removes entry
- [ ] Credential cache: get_or_load calls loader on miss
- [ ] Progress counter: increment/decrement operations atomic
- [ ] Progress counter: get_progress returns correct counts
- [ ] Dispatch worker uses cache instead of DB for credentials
- [ ] Dispatch worker respects rate limits

---

## Acceptance Criteria

- [ ] Redis connection pool with async client
- [ ] Per-channel rate limiter with sliding window counter
- [ ] Channel credential cache with configurable TTL
- [ ] Cache invalidation on credential updates
- [ ] Group message progress counters with Redis atomic ops
- [ ] Dispatch worker integrated with rate limiter + cache
- [ ] Redis service in Docker Compose
- [ ] Tests passing, Ruff clean

---

## Dependencies

- HSM-002 (Dispatch Pipeline — worker to integrate with)

## Blocks

- None (this enhances the dispatch pipeline for production readiness)
