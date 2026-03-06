# RT-BE-008: push_to_room -- Direct WebSocket Push Utility

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P1 -- Required for realtime delivery
**Phase:** 3 -- Realtime Infrastructure
**Depends On:** RT-AWS-001 (DynamoDB tables + API Gateway must exist)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 8.1.1](../../../TURUMBA_REALTIME_MESSAGING.md#811-push_to_room--direct-websocket-push-from-messaging-api), [Realtime Push Workflow](../../../realtime/05-REALTIME-PUSH.md)

---

## Summary

Implement the `push_to_room` utility that delivers WebSocket events directly to connected agents and visitors via the AWS API Gateway Management API. This is the lowest-level push primitive used by both the agent reply endpoint (RT-BE-010) and the `realtime_push_worker` (RT-BE-009). It queries DynamoDB for room subscribers, filters out visitor connections when needed (private messages), and POSTs event payloads to each connection in parallel.

Target latency: 5-8ms per push operation.

---

## Architecture

```
push_to_room("conv:{id}", event, skip_visitors=False)
    |
    v
1. Query DynamoDB ws_subscriptions           (~2ms)
   PK: room = "conv:{conversation_id}"
   Returns: [ { connection_id, user_id }, ... ]
    |
    v  (if skip_visitors=True)
2. BatchGetItem DynamoDB ws_connections       (~1ms)
   Keys: [connection_id_1, connection_id_2, ...]
   Returns: [ { connection_id, connection_type }, ... ]
   Filter out: connection_type == "visitor"
    |
    v
3. POST @connections/{connection_id} (parallel)  (~2-5ms)
   For each remaining connection_id:
   POST https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/@connections/{connection_id}
   Body: JSON(event_payload)
    |
    v  (only on 410 GoneException)
4. Cleanup stale connections                  (~3ms)
   - Query ws_subscriptions by connection_id-index (all rooms)
   - Batch delete from ws_subscriptions
   - Delete from ws_connections
   - If agent: update ws_presence (decrement connection_count)
```

---

## Implementation

### File: `src/realtime/__init__.py`

Empty init file for the realtime package.

### File: `src/realtime/push.py`

```python
"""
Direct WebSocket push utility.

Shared by:
- Agent reply endpoint (POST /conversations/{id}/messages) -- direct push
- Visitor message handler (POST /internal/visitor-message) -- direct push
- realtime_push_worker -- worker push (via RabbitMQ)
"""
```

### RealtimePushService Class

Create a `RealtimePushService` class that manages connection pooling for boto3 clients and exposes the `push_to_room` method.

```python
class RealtimePushService:
    """
    Manages AWS client connections and provides the push_to_room utility.
    Use as a singleton -- create once at app startup, inject via FastAPI dependency.
    """

    def __init__(self, settings: Settings):
        self._region = settings.AWS_REGION
        self._ws_endpoint = settings.WS_API_GATEWAY_ENDPOINT
        self._connections_table = settings.WS_CONNECTIONS_TABLE
        self._subscriptions_table = settings.WS_SUBSCRIPTIONS_TABLE
        self._session: aioboto3.Session | None = None

    async def initialize(self) -> None:
        """Create the aioboto3 session. Call once at startup."""
        self._session = aioboto3.Session()

    async def push_to_room(
        self,
        room: str,
        event: dict,
        skip_visitors: bool = False,
    ) -> int:
        """
        Push an event payload to all WebSocket connections subscribed to a room.

        Args:
            room: Room identifier (e.g., "conv:{uuid}", "account:{uuid}", "user:{uuid}")
            event: JSON-serializable event payload to deliver
            skip_visitors: If True, skip connections where connection_type="visitor"
                           (used for private/internal notes)

        Returns:
            Number of connections successfully pushed to.
        """
        ...
```

### push_to_room -- Step-by-Step Logic

**Step 1: Query room subscribers**

```python
async with self._session.resource("dynamodb", region_name=self._region) as dynamodb:
    table = await dynamodb.Table(self._subscriptions_table)
    response = await table.query(
        KeyConditionExpression=Key("room").eq(room)
    )
    subscribers = response.get("Items", [])

if not subscribers:
    return 0  # No subscribers, return early
```

**Step 2: Filter visitors (conditional)**

Only when `skip_visitors=True` (private messages):

```python
if skip_visitors:
    async with self._session.resource("dynamodb", region_name=self._region) as dynamodb:
        conn_table = await dynamodb.Table(self._connections_table)
        # BatchGetItem for all connection_ids
        keys = [{"connection_id": s["connection_id"]} for s in subscribers]
        # batch_get_item returns connection_type for each
        # Filter out visitors
        agent_conn_ids = {
            item["connection_id"]
            for item in response_items
            if item.get("connection_type") != "visitor"
        }
        subscribers = [s for s in subscribers if s["connection_id"] in agent_conn_ids]
```

**Step 3: Push to each connection (parallel)**

```python
payload = json.dumps(event).encode("utf-8")

async with self._session.client(
    "apigatewaymanagementapi",
    endpoint_url=self._ws_endpoint,
    region_name=self._region,
) as apigw:
    tasks = [
        self._push_to_connection(apigw, sub["connection_id"], payload)
        for sub in subscribers
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
```

**Step 4: Handle GoneException (410)**

For each result that is a `GoneException` (410 status):

```python
async def _push_to_connection(self, apigw, connection_id: str, payload: bytes) -> bool:
    try:
        await apigw.post_to_connection(
            ConnectionId=connection_id,
            Data=payload,
        )
        return True
    except apigw.exceptions.GoneException:
        # Stale connection -- schedule cleanup (fire-and-forget)
        asyncio.create_task(self._cleanup_stale_connection(connection_id))
        return False
    except Exception:
        logger.warning("Push failed for connection %s", connection_id, exc_info=True)
        return False
```

**Stale connection cleanup:**

```python
async def _cleanup_stale_connection(self, connection_id: str) -> None:
    """
    Remove a stale connection from DynamoDB.
    Fire-and-forget -- failures are logged but do not affect the push operation.
    """
    try:
        async with self._session.resource("dynamodb", region_name=self._region) as dynamodb:
            # 1. Query ws_subscriptions by connection_id-index to find all rooms
            sub_table = await dynamodb.Table(self._subscriptions_table)
            response = await sub_table.query(
                IndexName="connection_id-index",
                KeyConditionExpression=Key("connection_id").eq(connection_id),
            )

            # 2. Batch delete all subscription entries
            async with sub_table.batch_writer() as batch:
                for item in response.get("Items", []):
                    await batch.delete_item(
                        Key={"room": item["room"], "connection_id": connection_id}
                    )

            # 3. Delete from ws_connections
            conn_table = await dynamodb.Table(self._connections_table)
            await conn_table.delete_item(Key={"connection_id": connection_id})

    except Exception:
        logger.error("Cleanup failed for stale connection %s", connection_id, exc_info=True)
```

---

## FastAPI Dependency

### File: `src/dependencies/realtime.py`

```python
from functools import lru_cache

from src.config.config import get_settings
from src.realtime.push import RealtimePushService

_push_service: RealtimePushService | None = None


async def get_push_service() -> RealtimePushService:
    """
    Singleton RealtimePushService instance.
    Initialized on first call -- reused across requests.
    """
    global _push_service
    if _push_service is None:
        settings = get_settings()
        _push_service = RealtimePushService(settings)
        await _push_service.initialize()
    return _push_service
```

---

## Configuration

### Add to `src/config/config.py`

```python
# AWS WebSocket Push (used by push_to_room + realtime_push_worker)
AWS_REGION: str = "us-east-1"
WS_API_GATEWAY_ENDPOINT: str = ""  # https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
WS_CONNECTIONS_TABLE: str = "ws_connections"
WS_SUBSCRIPTIONS_TABLE: str = "ws_subscriptions"
```

All four variables must be set in `.env` for the push utility to function. When `WS_API_GATEWAY_ENDPOINT` is empty, `push_to_room` should log a warning and return 0 (no-op mode for local development without AWS).

---

## Dependencies

### Add to `requirements.txt`

```
aioboto3>=13.0          # async boto3 wrapper for DynamoDB + API Gateway Management API
```

`aioboto3` wraps `boto3` with `asyncio` support. It provides async context managers for DynamoDB resources and API Gateway Management API clients.

---

## Tasks

### 1. Package Setup
- [ ] Create `src/realtime/__init__.py`
- [ ] Create `src/realtime/push.py`

### 2. Configuration
- [ ] Add `AWS_REGION`, `WS_API_GATEWAY_ENDPOINT`, `WS_CONNECTIONS_TABLE`, `WS_SUBSCRIPTIONS_TABLE` to `src/config/config.py`
- [ ] Update `.env.example` with the four new variables
- [ ] Add `aioboto3` to `requirements.txt`

### 3. RealtimePushService
- [ ] Implement `__init__` accepting Settings with AWS config
- [ ] Implement `initialize()` creating the aioboto3 Session
- [ ] Implement `push_to_room(room, event, skip_visitors)`:
  - [ ] Query `ws_subscriptions` table by PK `room`
  - [ ] Return early (0) if no subscribers
  - [ ] If `skip_visitors=True`: BatchGetItem from `ws_connections` to get `connection_type`, filter out `"visitor"` connections
  - [ ] POST to `@connections/{connection_id}` for each subscriber in parallel via `asyncio.gather`
  - [ ] Return count of successful pushes
- [ ] Implement `_push_to_connection(apigw, connection_id, payload)`:
  - [ ] Call `apigw.post_to_connection(ConnectionId=..., Data=...)`
  - [ ] Catch `GoneException` (410) -- fire-and-forget cleanup task
  - [ ] Catch generic exceptions -- log warning, return False
- [ ] Implement `_cleanup_stale_connection(connection_id)`:
  - [ ] Query `ws_subscriptions` by `connection_id-index` GSI
  - [ ] Batch delete all subscription entries for this connection
  - [ ] Delete from `ws_connections`
  - [ ] Log errors but never raise (fire-and-forget)
- [ ] No-op mode: if `WS_API_GATEWAY_ENDPOINT` is empty, log warning and return 0

### 4. FastAPI Dependency
- [ ] Create `src/dependencies/realtime.py` with `get_push_service()` singleton factory
- [ ] Ensure the service is initialized lazily on first use

### 5. Unit Tests
- [ ] **Test: push_to_room with subscribers** -- mock DynamoDB query returns 3 connections, mock `post_to_connection` succeeds, verify 3 POSTs made and returns 3
- [ ] **Test: push_to_room with empty room** -- mock DynamoDB query returns empty list, verify no `post_to_connection` calls, returns 0
- [ ] **Test: push_to_room with skip_visitors=True** -- mock 3 subscribers (2 agents, 1 visitor), verify only 2 POSTs made (visitor skipped)
- [ ] **Test: push_to_room with skip_visitors=False** -- mock same 3 subscribers, verify all 3 receive the push
- [ ] **Test: GoneException triggers cleanup** -- mock `post_to_connection` raising `GoneException` for one connection, verify `_cleanup_stale_connection` is called
- [ ] **Test: cleanup_stale_connection** -- mock DynamoDB queries and deletes, verify all subscription entries and connection record deleted
- [ ] **Test: cleanup failure is logged but does not raise** -- mock DynamoDB delete raising exception, verify error logged but no exception propagated
- [ ] **Test: no-op when WS_API_GATEWAY_ENDPOINT is empty** -- verify returns 0 with warning log
- [ ] **Test: parallel execution** -- verify `asyncio.gather` is used (not sequential await)
- [ ] **Test: non-410 push failure** -- mock `post_to_connection` raising generic ClientError, verify logged and returns False

### 6. Integration Test Approach
- [ ] Document how to test with LocalStack:
  - Run LocalStack with DynamoDB and API Gateway services
  - Create tables with correct schema and GSIs
  - Set `WS_API_GATEWAY_ENDPOINT` to LocalStack endpoint
  - Run tests against real DynamoDB operations
- [ ] Document how to test with shared AWS dev environment:
  - Use a dedicated `dev` stage API Gateway
  - Use `dev-` prefixed DynamoDB tables
  - Set env vars to point to dev resources

---

## Acceptance Criteria

- [ ] `RealtimePushService` class implemented in `src/realtime/push.py`
- [ ] `push_to_room(room, event, skip_visitors)` queries DynamoDB and pushes to API Gateway
- [ ] Visitor connections filtered when `skip_visitors=True`
- [ ] `GoneException` (410) triggers fire-and-forget cleanup of stale connections
- [ ] All pushes executed in parallel via `asyncio.gather`
- [ ] No-op mode when `WS_API_GATEWAY_ENDPOINT` is not configured
- [ ] `aioboto3` added to `requirements.txt`
- [ ] AWS config variables added to `src/config/config.py`
- [ ] FastAPI dependency (`get_push_service`) provides singleton instance
- [ ] Unit tests passing with mocked AWS clients
- [ ] Ruff passes cleanly
- [ ] Coverage threshold met (80%)

---

## Notes

- The same `RealtimePushService` instance is shared between request handlers (direct push) and the `realtime_push_worker` (worker push). Both call `push_to_room` -- the only difference is the trigger.
- Connection pooling via the shared `aioboto3.Session` avoids creating new HTTP connections per push.
- The `_cleanup_stale_connection` method uses `asyncio.create_task` so cleanup runs concurrently without blocking the push response. This is acceptable because cleanup is best-effort -- DynamoDB TTLs provide a safety net.
- For local development without AWS, set `WS_API_GATEWAY_ENDPOINT=""` to enable no-op mode. All `push_to_room` calls will log and return 0.

## Blocks

- **RT-BE-009** (Realtime Push Worker) -- uses `push_to_room` for worker-path delivery
- **RT-BE-010** (Agent Reply + IM Dispatch) -- uses `push_to_room` for direct-path delivery
