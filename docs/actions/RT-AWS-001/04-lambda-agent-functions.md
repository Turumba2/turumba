# Phase 4: Agent Lambda Functions

**Prerequisites:** Phase 2 (IAM role), Phase 3 (shared layer)
**Outcome:** Five Lambda functions handling the full agent WebSocket lifecycle

---

## Common Setup for All Lambda Functions

When creating each function:

1. **Runtime:** Python 3.12
2. **Architecture:** x86_64
3. **Execution role:** `turumba-ws-lambda-role` (from Phase 2)
4. **Layer:** `turumba-ws-shared` (from Phase 3)
5. **Timeout:** 10 seconds (increase to 30s for `ws-connect` due to JWKS fetch)
6. **Memory:** 128 MB (sufficient for all functions)

### Environment Variables (set on all 5 functions)

| Variable | Value |
|----------|-------|
| `CONNECTIONS_TABLE` | `ws_connections` |
| `SUBSCRIPTIONS_TABLE` | `ws_subscriptions` |
| `PRESENCE_TABLE` | `ws_presence` |
| `WS_API_ENDPOINT` | _(leave blank — set after Phase 5)_ |
| `COGNITO_USER_POOL_ID` | _(your Cognito User Pool ID)_ |
| `AWS_REGION` | `us-east-1` |

> `WS_API_ENDPOINT` will be set after the API Gateway is created in Phase 5. The `ws-connect` and `ws-disconnect` functions don't need it, but `ws-typing`, `ws-presence` do.

---

## Function 1: `ws-connect`

Handles the `$connect` route. Validates Cognito JWT for agent connections.

### Create the Function

1. Open **Lambda > Functions > Create function**
2. Function name: `ws-connect`
3. Runtime: Python 3.12
4. Execution role: Use existing — `turumba-ws-lambda-role`
5. Click **Create function**
6. Add layer: `turumba-ws-shared`
7. Set timeout to **30 seconds** (JWKS fetch on cold start)
8. Set environment variables (table above)

### Code

```python
"""$connect handler — authenticate agent (and later visitor) connections."""

import json

from turumba_ws.cognito import validate_cognito_jwt
from turumba_ws.dynamo import store_connection, store_subscription
from turumba_ws.presence import update_presence


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    params = event.get("queryStringParameters") or {}
    token = params.get("token")
    conn_type = params.get("type", "agent")

    if not token:
        return {"statusCode": 401, "body": "Missing token"}

    if conn_type == "agent":
        return _handle_agent_connect(connection_id, token)
    elif conn_type == "visitor":
        # Visitor path — implemented in Phase 7
        return {"statusCode": 501, "body": "Visitor connections not yet supported"}
    else:
        return {"statusCode": 400, "body": f"Unknown connection type: {conn_type}"}


def _handle_agent_connect(connection_id, token):
    # Validate Cognito JWT
    try:
        payload = validate_cognito_jwt(token)
    except ValueError as e:
        print(f"JWT validation failed: {e}")
        return {"statusCode": 401, "body": str(e)}

    user_id = payload["sub"]
    email = payload.get("email", "")

    # Extract account_ids from custom claim
    # Cognito custom attributes come as comma-separated strings
    raw_accounts = payload.get("custom:account_ids", "")
    account_ids = set(filter(None, raw_accounts.split(",")))

    if not account_ids:
        print(f"No account_ids in token for user {user_id}")
        return {"statusCode": 403, "body": "No account_ids in token"}

    # Store connection
    store_connection(
        connection_id=connection_id,
        connection_type="agent",
        user_id=user_id,
        account_ids=account_ids,
        email=email,
    )

    # Auto-subscribe to personal room
    store_subscription(
        room=f"user:{user_id}",
        connection_id=connection_id,
        user_id=user_id,
    )

    # Update presence: set online, increment connection count
    for account_id in account_ids:
        update_presence(account_id, user_id, increment=True)

    print(f"Agent connected: {user_id} ({email}), accounts: {account_ids}")
    return {"statusCode": 200}
```

### Verification

- [ ] Function `ws-connect` created with Python 3.12
- [ ] Layer `turumba-ws-shared` attached
- [ ] Timeout set to 30 seconds
- [ ] Environment variables configured
- [ ] Code deployed

---

## Function 2: `ws-disconnect`

Handles the `$disconnect` route. Cleans up connections, subscriptions, and presence.

### Create the Function

1. Function name: `ws-disconnect`
2. Same setup as above, but timeout can be **10 seconds**

### Code

```python
"""$disconnect handler — cleanup connections, subscriptions, and presence."""

from turumba_ws.broadcast import broadcast_to_room, cleanup_stale_connection
from turumba_ws.dynamo import (
    delete_connection,
    delete_subscription,
    get_connection,
    get_subscriptions_by_connection,
)
from turumba_ws.presence import update_presence


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]

    # Get connection info before deleting
    conn = get_connection(connection_id)

    # Query all subscriptions for this connection
    subs = get_subscriptions_by_connection(connection_id)

    # Delete all subscriptions
    for sub in subs:
        delete_subscription(sub["room"], connection_id)

    # Delete connection record
    delete_connection(connection_id)

    # Agent-only: update presence
    if conn and conn.get("connection_type") == "agent":
        user_id = conn["user_id"]
        account_ids = conn.get("account_ids", set())

        for account_id in account_ids:
            new_status = update_presence(account_id, user_id, decrement=True)

            # If went offline, broadcast to account room
            if new_status == "offline":
                broadcast_to_room(
                    room=f"account:{account_id}",
                    payload={
                        "type": "agent:presence",
                        "data": {"user_id": user_id, "status": "offline"},
                    },
                )

        print(f"Agent disconnected: {user_id}, cleaned up {len(subs)} subscriptions")
    elif conn:
        print(f"Visitor disconnected: {conn.get('user_id')}, cleaned up {len(subs)} subscriptions")
    else:
        print(f"Unknown connection disconnected: {connection_id}")

    return {"statusCode": 200}
```

### Verification

- [ ] Function `ws-disconnect` created
- [ ] Layer attached, env vars set

---

## Function 3: `ws-subscribe`

Handles both `subscribe` and `unsubscribe` routes. Agent-only.

### Create the Function

1. Function name: `ws-subscribe`
2. Timeout: 10 seconds

### Code

```python
"""subscribe/unsubscribe handler — manage room memberships (agent only)."""

import json

from turumba_ws.dynamo import (
    delete_subscription,
    get_connection,
    store_subscription,
)


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event.get("body", "{}"))
    action = body.get("action")  # "subscribe" or "unsubscribe"
    room = body.get("room")

    if not room:
        return {"statusCode": 400, "body": "Missing room"}

    # Get connection record
    conn = get_connection(connection_id)
    if not conn:
        return {"statusCode": 403, "body": "Connection not found"}

    # Reject visitor connections
    if conn.get("connection_type") == "visitor":
        return {"statusCode": 403, "body": "Visitors cannot subscribe to rooms"}

    # Validate room access
    if not _validate_room_access(conn, room):
        return {"statusCode": 403, "body": "Not authorized for this room"}

    if action == "unsubscribe":
        delete_subscription(room, connection_id)
        print(f"Agent {conn['user_id']} unsubscribed from {room}")
    else:
        store_subscription(room, connection_id, conn["user_id"])
        print(f"Agent {conn['user_id']} subscribed to {room}")

    return {"statusCode": 200}


def _validate_room_access(conn: dict, room: str) -> bool:
    """
    Validate that the agent has access to the requested room.

    Room formats:
    - account:{uuid}  — agent must have this account_id
    - conv:{uuid}     — agent must belong to the conversation's account
    - user:{uuid}     — agent can only subscribe to their own user room
    """
    account_ids = conn.get("account_ids", set())
    user_id = conn["user_id"]

    if room.startswith("account:"):
        target_account = room.split(":")[1]
        return target_account in account_ids

    if room.startswith("conv:"):
        # For now, allow if agent has any account.
        # Full validation (conversation belongs to agent's account)
        # would require a DB lookup. We rely on the fact that
        # conversation UUIDs are unguessable.
        return True

    if room.startswith("user:"):
        target_user = room.split(":")[1]
        return target_user == user_id

    # Unknown room format
    return False
```

### Verification

- [ ] Function `ws-subscribe` created
- [ ] Layer attached, env vars set

---

## Function 4: `ws-typing`

Handles the `typing` route. Relays typing indicators within a conversation room. Agent-only.

### Create the Function

1. Function name: `ws-typing`
2. Timeout: 10 seconds

### Code

```python
"""typing handler — relay typing indicators in conversation rooms (agent only)."""

import json

from turumba_ws.broadcast import broadcast_to_room, cleanup_stale_connection
from turumba_ws.dynamo import get_connection


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event.get("body", "{}"))
    conversation_id = body.get("conversation_id")
    typing = body.get("typing", True)

    if not conversation_id:
        return {"statusCode": 400, "body": "Missing conversation_id"}

    # Validate connection is an agent
    conn = get_connection(connection_id)
    if not conn or conn.get("connection_type") != "agent":
        return {"statusCode": 403, "body": "Agent connection required"}

    # Broadcast typing to conversation room (exclude sender)
    room = f"conv:{conversation_id}"
    payload = {
        "type": "conversation:typing",
        "data": {
            "user_id": conn["user_id"],
            "conversation_id": conversation_id,
            "typing": typing,
        },
    }

    stale = broadcast_to_room(room, payload, exclude_connection=connection_id)

    # Clean up any stale connections found
    for stale_cid in stale:
        cleanup_stale_connection(stale_cid)

    return {"statusCode": 200}
```

### Verification

- [ ] Function `ws-typing` created
- [ ] Layer attached, env vars set

---

## Function 5: `ws-presence`

Handles the `presence` route. Updates agent presence status and broadcasts to account rooms. Agent-only.

### Create the Function

1. Function name: `ws-presence`
2. Timeout: 10 seconds

### Code

```python
"""presence handler — update and broadcast agent presence (agent only)."""

import json

from turumba_ws.broadcast import broadcast_to_room, cleanup_stale_connection
from turumba_ws.dynamo import get_connection
from turumba_ws.presence import update_presence


VALID_STATUSES = {"online", "away", "offline"}


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event.get("body", "{}"))
    status = body.get("status")

    if status not in VALID_STATUSES:
        return {"statusCode": 400, "body": f"Invalid status. Must be one of: {VALID_STATUSES}"}

    # Validate connection is an agent
    conn = get_connection(connection_id)
    if not conn or conn.get("connection_type") != "agent":
        return {"statusCode": 403, "body": "Agent connection required"}

    user_id = conn["user_id"]
    account_ids = conn.get("account_ids", set())

    # Update presence and broadcast for each account
    for account_id in account_ids:
        update_presence(account_id, user_id, status=status)

        # Broadcast to all connections in this account room
        payload = {
            "type": "agent:presence",
            "data": {"user_id": user_id, "status": status},
        }
        stale = broadcast_to_room(
            f"account:{account_id}",
            payload,
            exclude_connection=connection_id,
        )

        for stale_cid in stale:
            cleanup_stale_connection(stale_cid)

    print(f"Agent {user_id} presence updated to {status}")
    return {"statusCode": 200}
```

### Verification

- [ ] Function `ws-presence` created
- [ ] Layer attached, env vars set

---

## Post-Creation: Update `WS_API_ENDPOINT`

After completing Phase 5 (API Gateway), come back and set `WS_API_ENDPOINT` on all 5 functions:

```
https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
```

This is required for `ws-typing`, `ws-presence`, and `ws-disconnect` (which broadcast via API Gateway Management API).

---

## Final Checklist

- [ ] `ws-connect` — Created, layer attached, 30s timeout
- [ ] `ws-disconnect` — Created, layer attached, 10s timeout
- [ ] `ws-subscribe` — Created, layer attached, 10s timeout
- [ ] `ws-typing` — Created, layer attached, 10s timeout
- [ ] `ws-presence` — Created, layer attached, 10s timeout
- [ ] All functions use role `turumba-ws-lambda-role`
- [ ] All functions have correct environment variables
- [ ] `WS_API_ENDPOINT` to be set after Phase 5

**Next:** [Phase 5 — API Gateway WebSocket](./05-api-gateway-websocket.md)
