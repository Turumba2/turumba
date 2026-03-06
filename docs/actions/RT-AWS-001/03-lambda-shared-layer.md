# Phase 3: Lambda Shared Layer

**Prerequisites:** Phase 2 complete (IAM role exists)
**Outcome:** A Lambda layer with Cognito JWT validation utilities and shared DynamoDB helpers

---

## Why a Shared Layer?

Multiple Lambda functions need:
- Cognito JWT validation (RS256 + JWKS caching) — used by `ws-connect`
- DynamoDB helper functions — used by all Lambdas
- Presence update logic — used by `ws-connect`, `ws-disconnect`, `ws-presence`
- Room broadcast logic — used by `ws-typing`, `ws-presence`, `ws-visitor-typing`

A Lambda layer avoids duplicating this code across 7 functions.

---

## Step 1: Create the Layer Code Locally

Create the following directory structure on your machine:

```
turumba-ws-layer/
  python/
    turumba_ws/
      __init__.py
      cognito.py
      dynamo.py
      presence.py
      broadcast.py
```

### `python/turumba_ws/__init__.py`

```python
"""Turumba WebSocket shared utilities."""
```

### `python/turumba_ws/cognito.py`

Cognito JWT validation with JWKS caching.

```python
"""Cognito JWT validation for WebSocket $connect."""

import json
import os
import time
import urllib.request

import jwt
from jwt.algorithms import RSAAlgorithm

# Cache JWKS keys in memory (Lambda warm start reuses this)
_jwks_cache = {"keys": None, "fetched_at": 0}
_JWKS_CACHE_TTL = 3600  # 1 hour


def _get_jwks():
    """Fetch and cache Cognito JWKS public keys."""
    now = time.time()
    if _jwks_cache["keys"] and (now - _jwks_cache["fetched_at"]) < _JWKS_CACHE_TTL:
        return _jwks_cache["keys"]

    region = os.environ["AWS_REGION"]
    user_pool_id = os.environ["COGNITO_USER_POOL_ID"]
    jwks_url = (
        f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json"
    )

    with urllib.request.urlopen(jwks_url, timeout=5) as resp:
        jwks = json.loads(resp.read())

    _jwks_cache["keys"] = {k["kid"]: k for k in jwks["keys"]}
    _jwks_cache["fetched_at"] = now
    return _jwks_cache["keys"]


def validate_cognito_jwt(token: str) -> dict:
    """
    Validate a Cognito JWT token.

    Returns the decoded payload on success.
    Raises ValueError on any validation failure.
    """
    # Decode header to get kid
    try:
        unverified_header = jwt.get_unverified_header(token)
    except jwt.DecodeError as exc:
        raise ValueError("malformed_token") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise ValueError("missing_kid")

    # Lookup public key
    jwks = _get_jwks()
    key_data = jwks.get(kid)
    if not key_data:
        raise ValueError("unknown_kid")

    # Convert JWK to PEM
    public_key = RSAAlgorithm.from_jwk(json.dumps(key_data))

    # Verify and decode
    region = os.environ["AWS_REGION"]
    user_pool_id = os.environ["COGNITO_USER_POOL_ID"]
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"

    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False},  # Cognito uses client_id, not aud
        )
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("token_expired") from exc
    except jwt.InvalidTokenError as exc:
        raise ValueError("invalid_token") from exc

    return payload
```

### `python/turumba_ws/dynamo.py`

DynamoDB helper functions.

```python
"""DynamoDB helper functions for WebSocket Lambdas."""

import os
import time
from datetime import UTC, datetime

import boto3

_dynamodb = None

TTL_24H = 86400
TTL_5MIN = 300


def get_dynamodb():
    """Get a cached DynamoDB resource."""
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    return _dynamodb


def connections_table():
    return get_dynamodb().Table(os.environ["CONNECTIONS_TABLE"])


def subscriptions_table():
    return get_dynamodb().Table(os.environ["SUBSCRIPTIONS_TABLE"])


def presence_table():
    return get_dynamodb().Table(os.environ["PRESENCE_TABLE"])


def now_iso():
    return datetime.now(UTC).isoformat()


def ttl_epoch(seconds=TTL_24H):
    return int(time.time()) + seconds


def store_connection(connection_id: str, connection_type: str, user_id: str,
                     account_ids: set, email: str = None, endpoint_id: str = None):
    """Store a connection record in ws_connections."""
    item = {
        "connection_id": connection_id,
        "connection_type": connection_type,
        "user_id": user_id,
        "account_ids": account_ids,
        "connected_at": now_iso(),
        "ttl": ttl_epoch(TTL_24H),
    }
    if email:
        item["email"] = email
    if endpoint_id:
        item["endpoint_id"] = endpoint_id

    connections_table().put_item(Item=item)


def get_connection(connection_id: str) -> dict | None:
    """Fetch a connection record."""
    resp = connections_table().get_item(Key={"connection_id": connection_id})
    return resp.get("Item")


def delete_connection(connection_id: str):
    """Delete a connection record."""
    connections_table().delete_item(Key={"connection_id": connection_id})


def store_subscription(room: str, connection_id: str, user_id: str):
    """Subscribe a connection to a room."""
    subscriptions_table().put_item(Item={
        "room": room,
        "connection_id": connection_id,
        "user_id": user_id,
        "subscribed_at": now_iso(),
        "ttl": ttl_epoch(TTL_24H),
    })


def delete_subscription(room: str, connection_id: str):
    """Remove a subscription."""
    subscriptions_table().delete_item(Key={
        "room": room,
        "connection_id": connection_id,
    })


def get_subscriptions_by_connection(connection_id: str) -> list[dict]:
    """Get all rooms a connection is subscribed to (via GSI)."""
    resp = subscriptions_table().query(
        IndexName="connection_id-index",
        KeyConditionExpression="connection_id = :cid",
        ExpressionAttributeValues={":cid": connection_id},
    )
    return resp.get("Items", [])


def get_room_subscribers(room: str) -> list[dict]:
    """Get all connections in a room."""
    resp = subscriptions_table().query(
        KeyConditionExpression="room = :r",
        ExpressionAttributeValues={":r": room},
    )
    return resp.get("Items", [])
```

### `python/turumba_ws/presence.py`

Presence update logic (agents only).

```python
"""Agent presence management."""

import os

from turumba_ws.dynamo import presence_table, now_iso, ttl_epoch, TTL_5MIN


def update_presence(account_id: str, user_id: str, status: str = None,
                    increment: bool = False, decrement: bool = False):
    """
    Update agent presence in ws_presence table.

    - increment=True: bump connection_count by 1, set online
    - decrement=True: reduce connection_count by 1, set offline if 0
    - status provided: set explicit status
    """
    table = presence_table()

    if increment:
        table.update_item(
            Key={"account_id": account_id, "user_id": user_id},
            UpdateExpression=(
                "SET #status = :online, last_seen = :now, "
                "connection_count = if_not_exists(connection_count, :zero) + :one, "
                "#ttl = :ttl"
            ),
            ExpressionAttributeNames={"#status": "status", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":online": "online",
                ":now": now_iso(),
                ":zero": 0,
                ":one": 1,
                ":ttl": ttl_epoch(TTL_5MIN),
            },
        )
        return "online"

    if decrement:
        resp = table.update_item(
            Key={"account_id": account_id, "user_id": user_id},
            UpdateExpression=(
                "SET connection_count = connection_count - :one, "
                "last_seen = :now, #ttl = :ttl"
            ),
            ConditionExpression="connection_count > :zero",
            ExpressionAttributeNames={"#ttl": "ttl"},
            ExpressionAttributeValues={
                ":one": 1,
                ":now": now_iso(),
                ":zero": 0,
                ":ttl": ttl_epoch(TTL_5MIN),
            },
            ReturnValues="ALL_NEW",
        )
        new_count = resp.get("Attributes", {}).get("connection_count", 0)
        if new_count <= 0:
            # Set offline
            table.update_item(
                Key={"account_id": account_id, "user_id": user_id},
                UpdateExpression="SET #status = :offline, last_seen = :now",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={
                    ":offline": "offline",
                    ":now": now_iso(),
                },
            )
            return "offline"
        return None

    if status:
        table.update_item(
            Key={"account_id": account_id, "user_id": user_id},
            UpdateExpression=(
                "SET #status = :status, last_seen = :now, #ttl = :ttl"
            ),
            ExpressionAttributeNames={"#status": "status", "#ttl": "ttl"},
            ExpressionAttributeValues={
                ":status": status,
                ":now": now_iso(),
                ":ttl": ttl_epoch(TTL_5MIN),
            },
        )
        return status

    return None
```

### `python/turumba_ws/broadcast.py`

Room broadcast logic using API Gateway Management API.

```python
"""Broadcast messages to WebSocket connections via API Gateway Management API."""

import json
import os

import boto3

_apigw_client = None


def get_apigw_client():
    """Get a cached API Gateway Management API client."""
    global _apigw_client
    if _apigw_client is None:
        endpoint = os.environ["WS_API_ENDPOINT"]
        _apigw_client = boto3.client(
            "apigatewaymanagementapi",
            endpoint_url=endpoint,
        )
    return _apigw_client


def post_to_connection(connection_id: str, payload: dict):
    """
    Send a message to a single WebSocket connection.

    Returns True if sent, False if connection is gone (stale).
    """
    client = get_apigw_client()
    try:
        client.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(payload).encode("utf-8"),
        )
        return True
    except client.exceptions.GoneException:
        return False


def broadcast_to_room(room: str, payload: dict, exclude_connection: str = None):
    """
    Send a message to all connections subscribed to a room.

    Returns list of stale connection_ids (GoneException).
    """
    from turumba_ws.dynamo import get_room_subscribers

    subscribers = get_room_subscribers(room)
    stale = []

    for sub in subscribers:
        cid = sub["connection_id"]
        if cid == exclude_connection:
            continue
        if not post_to_connection(cid, payload):
            stale.append(cid)

    return stale


def cleanup_stale_connection(connection_id: str):
    """Remove a stale connection and all its subscriptions."""
    from turumba_ws.dynamo import (
        delete_connection,
        delete_subscription,
        get_subscriptions_by_connection,
    )

    subs = get_subscriptions_by_connection(connection_id)
    for sub in subs:
        delete_subscription(sub["room"], connection_id)
    delete_connection(connection_id)
```

---

## Step 2: Install Dependencies into the Layer

The layer needs `PyJWT` and `cryptography` (for RS256). `boto3` is already available in the Lambda runtime.

```bash
cd turumba-ws-layer
pip install PyJWT[crypto] -t python/ --no-cache-dir --platform manylinux2014_x86_64 --only-binary=:all:
```

> The `--platform` flag ensures you get Linux-compatible binaries even if building on macOS.

---

## Step 3: Package the Layer

```bash
cd turumba-ws-layer
zip -r turumba-ws-layer.zip python/
```

The zip should contain:
```
python/
  turumba_ws/
    __init__.py
    cognito.py
    dynamo.py
    presence.py
    broadcast.py
  jwt/           (PyJWT package)
  cryptography/  (cryptography package)
  ...            (other dependencies)
```

---

## Step 4: Upload the Layer to AWS

1. Open **AWS Console > Lambda > Layers > Create layer**
2. Configure:
   - Name: `turumba-ws-shared`
   - Description: `Shared utilities for Turumba WebSocket Lambda functions`
   - Upload: select `turumba-ws-layer.zip`
   - Compatible runtimes: **Python 3.12**
   - Compatible architectures: **x86_64**
3. Click **Create**

Note the layer version ARN:
```
arn:aws:lambda:{region}:{account-id}:layer:turumba-ws-shared:1
```

---

## Verification

- [ ] Layer `turumba-ws-shared` created with version 1
- [ ] Layer contains `python/turumba_ws/` package with 5 modules
- [ ] Layer contains `PyJWT` and `cryptography` dependencies
- [ ] Compatible runtime is Python 3.12

### Quick Test

Create a temporary test Lambda to verify the layer works:

1. Create a Lambda function `ws-layer-test` (Python 3.12)
2. Add the `turumba-ws-shared` layer
3. Use this test code:

```python
def handler(event, context):
    # Test imports
    from turumba_ws.cognito import validate_cognito_jwt
    from turumba_ws.dynamo import connections_table
    from turumba_ws.presence import update_presence
    from turumba_ws.broadcast import broadcast_to_room
    import jwt

    return {"statusCode": 200, "body": "All imports successful"}
```

4. Test the function — should return 200
5. Delete the test function

**Next:** [Phase 4 — Agent Lambda Functions](./04-lambda-agent-functions.md)
