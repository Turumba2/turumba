# CONV-AWS-001: AWS WebSocket Infrastructure

**Type:** Infrastructure
**Service:** AWS (API Gateway + Lambda + DynamoDB)
**Priority:** P1 — Required for real-time push
**Phase:** 3 — Real-Time Infrastructure
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md) §5

---

## Summary

Set up the AWS infrastructure for real-time WebSocket communication: an API Gateway WebSocket API, three DynamoDB tables for connection/subscription/presence state, and five Lambda functions for the WebSocket lifecycle. This replaces the originally planned Node.js + Socket.IO + Redis service with fully managed AWS services.

**Approach:** Manual AWS Console setup first to validate, codify (CDK/SAM/Terraform) later.

---

## Part 1: API Gateway WebSocket API

### Configuration

- **Protocol:** WebSocket
- **Stage:** `prod` (or `dev` for development)
- **Endpoint:** `wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}`
- **Custom domain (later):** `wss://ws.turumba.example.com`

### Routes

| Route Key | Integration | Description |
|-----------|------------|-------------|
| `$connect` | Lambda: `ws-connect` | Auth + store connection |
| `$disconnect` | Lambda: `ws-disconnect` | Cleanup |
| `subscribe` | Lambda: `ws-subscribe` | Join room |
| `unsubscribe` | Lambda: `ws-subscribe` | Leave room (same Lambda, different action) |
| `typing` | Lambda: `ws-typing` | Relay typing indicator |
| `presence` | Lambda: `ws-presence` | Update agent status |

### Route Selection Expression

```
$request.body.action
```

Client sends: `{ "action": "subscribe", "room": "conv:uuid" }` → routes to `subscribe` Lambda.

---

## Part 2: DynamoDB Tables

### `ws_connections`

| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| `connection_id` | S | PK | API Gateway connection ID |
| `user_id` | S | | Cognito user sub |
| `email` | S | | |
| `account_ids` | SS | | StringSet from JWT claims |
| `connected_at` | S | | ISO 8601 |
| `ttl` | N | | Epoch + 24h (auto-cleanup) |

**GSI:** `user_id-index` (PK: `user_id`) — find all connections for a user.

### `ws_subscriptions`

| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| `room` | S | PK | `"account:{uuid}"`, `"conv:{uuid}"`, `"user:{uuid}"` |
| `connection_id` | S | SK | |
| `user_id` | S | | For display purposes |
| `subscribed_at` | S | | ISO 8601 |
| `ttl` | N | | Epoch + 24h |

**GSI:** `connection_id-index` (PK: `connection_id`) — cleanup all subscriptions on disconnect.

### `ws_presence`

| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| `account_id` | S | PK | |
| `user_id` | S | SK | |
| `status` | S | | `online`, `away`, `offline` |
| `last_seen` | S | | ISO 8601 |
| `connection_count` | N | | Active connections for this user |
| `ttl` | N | | Epoch + 5min (heartbeat refresh) |

Enable **TTL** on all three tables (attribute: `ttl`) for automatic stale record cleanup.

---

## Part 3: Lambda Functions

All Python 3.12 runtime. Each Lambda needs:
- IAM role with DynamoDB read/write access
- API Gateway Management API invoke access (`execute-api:ManageConnections`)
- Environment variables: `CONNECTIONS_TABLE`, `SUBSCRIPTIONS_TABLE`, `PRESENCE_TABLE`, `WS_API_ENDPOINT`

### `ws-connect` ($connect)

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    # Extract token from query string
    token = event.get("queryStringParameters", {}).get("token")
    if not token:
        return {"statusCode": 401}

    # Validate Cognito JWT
    try:
        payload = validate_jwt(token)  # RS256 against JWKS
    except Exception:
        return {"statusCode": 401}

    # Store connection
    dynamodb.put_item(
        TableName=CONNECTIONS_TABLE,
        Item={
            "connection_id": connection_id,
            "user_id": payload["sub"],
            "email": payload["email"],
            "account_ids": set(payload.get("custom:account_ids", "").split(",")),
            "connected_at": datetime.now(UTC).isoformat(),
            "ttl": int(time.time()) + 86400,
        },
    )

    # Auto-subscribe to user-specific room
    dynamodb.put_item(
        TableName=SUBSCRIPTIONS_TABLE,
        Item={
            "room": f"user:{payload['sub']}",
            "connection_id": connection_id,
            "user_id": payload["sub"],
            "subscribed_at": datetime.now(UTC).isoformat(),
            "ttl": int(time.time()) + 86400,
        },
    )

    return {"statusCode": 200}
```

### `ws-disconnect` ($disconnect)

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]

    # Get connection info
    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})

    # Delete all subscriptions for this connection (query GSI)
    subs = dynamodb.query(
        SUBSCRIPTIONS_TABLE,
        IndexName="connection_id-index",
        KeyConditionExpression="connection_id = :cid",
        ExpressionAttributeValues={":cid": connection_id},
    )
    for sub in subs:
        dynamodb.delete_item(SUBSCRIPTIONS_TABLE, {"room": sub["room"], "connection_id": connection_id})

    # Delete connection
    dynamodb.delete_item(CONNECTIONS_TABLE, {"connection_id": connection_id})

    # Update presence (decrement connection count, set offline if zero)
    if conn:
        for account_id in conn.get("account_ids", []):
            _update_presence(account_id, conn["user_id"], decrement=True)

    return {"statusCode": 200}
```

### `ws-subscribe` (subscribe / unsubscribe)

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    action = body.get("action")
    room = body.get("room")

    if not room:
        return {"statusCode": 400}

    # Get connection to validate room access
    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn:
        return {"statusCode": 403}

    # Validate room access (account rooms must match user's account_ids)
    if room.startswith("account:"):
        account_id = room.split(":")[1]
        if account_id not in conn.get("account_ids", set()):
            return {"statusCode": 403}

    if action == "unsubscribe":
        dynamodb.delete_item(SUBSCRIPTIONS_TABLE, {"room": room, "connection_id": connection_id})
    else:
        dynamodb.put_item(SUBSCRIPTIONS_TABLE, {
            "room": room,
            "connection_id": connection_id,
            "user_id": conn["user_id"],
            "subscribed_at": datetime.now(UTC).isoformat(),
            "ttl": int(time.time()) + 86400,
        })

        # If subscribing to account room, update presence
        if room.startswith("account:"):
            account_id = room.split(":")[1]
            _update_presence(account_id, conn["user_id"], status="online")

    return {"statusCode": 200}
```

### `ws-typing` (typing)

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    conversation_id = body.get("conversation_id")
    typing = body.get("typing", True)

    if not conversation_id:
        return {"statusCode": 400}

    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn:
        return {"statusCode": 403}

    # Query all connections in this conversation room
    room = f"conv:{conversation_id}"
    subscribers = dynamodb.query(SUBSCRIPTIONS_TABLE, KeyConditionExpression="room = :r",
                                 ExpressionAttributeValues={":r": room})

    # Relay typing indicator to all except sender
    api_gw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_API_ENDPOINT)
    payload = json.dumps({
        "type": "conversation:typing",
        "data": {"user_id": conn["user_id"], "conversation_id": conversation_id, "typing": typing},
    })

    for sub in subscribers:
        if sub["connection_id"] != connection_id:
            try:
                api_gw.post_to_connection(ConnectionId=sub["connection_id"], Data=payload)
            except api_gw.exceptions.GoneException:
                _cleanup_stale_connection(sub["connection_id"])

    return {"statusCode": 200}
```

### `ws-presence` (presence)

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    status = body.get("status")  # "online", "away", "offline"

    if status not in ("online", "away", "offline"):
        return {"statusCode": 400}

    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn:
        return {"statusCode": 403}

    # Update presence for all accounts
    for account_id in conn.get("account_ids", []):
        _update_presence(account_id, conn["user_id"], status=status)

        # Broadcast to all connections in this account room
        _broadcast_to_room(f"account:{account_id}", {
            "type": "agent:presence",
            "data": {"user_id": conn["user_id"], "status": status},
        }, exclude=connection_id)

    return {"statusCode": 200}
```

---

## Part 4: IAM Roles

### Lambda Execution Role

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:PutItem",
    "dynamodb:GetItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:UpdateItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:*:*:table/ws_connections",
    "arn:aws:dynamodb:*:*:table/ws_connections/index/*",
    "arn:aws:dynamodb:*:*:table/ws_subscriptions",
    "arn:aws:dynamodb:*:*:table/ws_subscriptions/index/*",
    "arn:aws:dynamodb:*:*:table/ws_presence"
  ]
}
```

```json
{
  "Effect": "Allow",
  "Action": "execute-api:ManageConnections",
  "Resource": "arn:aws:execute-api:*:*:*/*/POST/@connections/*"
}
```

---

## Tasks

### API Gateway
- [ ] Create WebSocket API in API Gateway
- [ ] Configure route selection expression: `$request.body.action`
- [ ] Create routes: $connect, $disconnect, subscribe, unsubscribe, typing, presence
- [ ] Deploy to a stage (dev/prod)
- [ ] Note the WebSocket URL and callback URL

### DynamoDB
- [ ] Create `ws_connections` table (PK: connection_id) with TTL enabled
- [ ] Create `ws_connections` GSI: user_id-index
- [ ] Create `ws_subscriptions` table (PK: room, SK: connection_id) with TTL enabled
- [ ] Create `ws_subscriptions` GSI: connection_id-index
- [ ] Create `ws_presence` table (PK: account_id, SK: user_id) with TTL enabled

### Lambda Functions
- [ ] Create `ws-connect` Lambda (Python 3.12) with JWT validation
- [ ] Create `ws-disconnect` Lambda with subscription cleanup
- [ ] Create `ws-subscribe` Lambda with room access validation
- [ ] Create `ws-typing` Lambda with relay logic
- [ ] Create `ws-presence` Lambda with broadcast logic
- [ ] Create shared Lambda layer for JWT validation (Cognito JWKS)
- [ ] Configure IAM roles with DynamoDB + API Gateway Management API access
- [ ] Wire each Lambda to its API Gateway route

### Testing
- [ ] Test $connect with valid JWT → 200, connection stored
- [ ] Test $connect with invalid/missing JWT → 401
- [ ] Test $disconnect → connection + subscriptions cleaned up
- [ ] Test subscribe → subscription created in DynamoDB
- [ ] Test subscribe to unauthorized room → 403
- [ ] Test typing → relayed to other connections in room
- [ ] Test presence → broadcast to account room connections
- [ ] Test TTL cleanup — stale connections auto-removed after 24h

---

## Acceptance Criteria

- [ ] WebSocket API endpoint accessible at `wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}`
- [ ] JWT authentication enforced on $connect
- [ ] Connection state stored in DynamoDB with automatic TTL cleanup
- [ ] Room subscription model works (subscribe/unsubscribe)
- [ ] Typing indicators relayed between connected clients in same room
- [ ] Presence updates broadcast to account rooms
- [ ] Stale connections handled gracefully (GoneException → cleanup)

---

## Dependencies

None — can be built in parallel with backend tasks.

## Blocks

- **CONV-BE-006** (Realtime Push Worker) — needs the API Gateway endpoint + DynamoDB tables
- **CONV-FE-001** (WebSocket Client) — needs the WebSocket endpoint URL
