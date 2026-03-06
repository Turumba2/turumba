# RT-AWS-001: AWS WebSocket Infrastructure -- API Gateway + DynamoDB + Lambda

**Type:** Infrastructure
**Service:** AWS (API Gateway + Lambda + DynamoDB)
**Assignee:** bengeos
**Priority:** P1 -- Required for realtime push
**Phase:** 2 -- Realtime Infrastructure
**Depends On:** RT-BE-007 (internal endpoints must exist for Lambda callbacks)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 7.1-7.3](../../../TURUMBA_REALTIME_MESSAGING.md#71-aws-api-gateway-websocket--unified-for-agents--visitors), [Section 13.1](../../../TURUMBA_REALTIME_MESSAGING.md#131-aws-websocket-infrastructure), [WebSocket Lifecycle](../../../realtime/06-WEBSOCKET-LIFECYCLE.md)

---

## Summary

Set up the AWS infrastructure for real-time WebSocket communication supporting **both agents and visitors** through a unified API Gateway WebSocket API. This includes three DynamoDB tables for connection/subscription/presence state, and seven Lambda functions handling the full WebSocket lifecycle -- authentication, room subscriptions, typing indicators, presence, visitor message forwarding, and disconnect cleanup.

Visitors connect through the same WebSocket API as agents. The `$connect` Lambda distinguishes connection type via the `?type` query parameter and validates accordingly: Cognito JWT for agents, Messaging API callback for visitors.

**Approach:** Manual AWS Console setup first to validate, codify (CDK/SAM/Terraform) later.

---

## Part 1: API Gateway WebSocket API

### Configuration

- **Protocol:** WebSocket
- **Stage:** `dev` (and later `prod`)
- **Endpoint:** `wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}`
- **Custom domain (later):** `wss://ws.turumba.io`

### Route Selection Expression

```
$request.body.action
```

Client sends `{ "action": "subscribe", "room": "conv:uuid" }` -- routes to `subscribe` Lambda.

### Routes

| Route Key | Integration | Connection Type | Description |
|-----------|------------|-----------------|-------------|
| `$connect` | Lambda: `ws-connect` | Both | Validate token, store connection |
| `$disconnect` | Lambda: `ws-disconnect` | Both | Cleanup connections + subscriptions |
| `subscribe` | Lambda: `ws-subscribe` | Agent only | Join room |
| `unsubscribe` | Lambda: `ws-subscribe` | Agent only | Leave room (same Lambda, different action) |
| `typing` | Lambda: `ws-typing` | Agent only | Relay typing to conv room |
| `presence` | Lambda: `ws-presence` | Agent only | Update agent status + broadcast |
| `visitor_message` | Lambda: `ws-visitor-message` | Visitor only | Forward message to Messaging API |
| `visitor_typing` | Lambda: `ws-visitor-typing` | Visitor only | Relay typing to conv room |

---

## Part 2: DynamoDB Tables

All tables use **on-demand billing** and have **TTL enabled** on the `ttl` attribute for automatic stale record cleanup.

### `ws_connections` -- Connection registry (agents + visitors)

| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| `connection_id` | S | PK | API Gateway connection ID |
| `connection_type` | S | | `"agent"` or `"visitor"` |
| `user_id` | S | | Agent: Cognito `sub`. Visitor: `"vs_abc123"` |
| `account_ids` | SS | | Agent: from JWT claims (StringSet). Visitor: single account_id |
| `email` | S | | Agent only (null for visitors) |
| `endpoint_id` | S | | Visitor only -- chat_endpoint ID (null for agents) |
| `connected_at` | S | | ISO 8601 |
| `ttl` | N | | Epoch + 24h -- auto-cleanup |

**GSI:** `user_id-index` (PK: `user_id`) -- find all connections for a user or visitor.

### `ws_subscriptions` -- Room membership

| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| `room` | S | PK | `"account:{uuid}"`, `"conv:{uuid}"`, `"user:{uuid}"`, `"visitor:{visitor_id}"` |
| `connection_id` | S | SK | |
| `user_id` | S | | Agent user_id or visitor_id |
| `subscribed_at` | S | | ISO 8601 |
| `ttl` | N | | Epoch + 24h |

**GSI:** `connection_id-index` (PK: `connection_id`) -- cleanup all subscriptions on disconnect.

### `ws_presence` -- Agent presence (agents only)

| Attribute | Type | Key | Notes |
|-----------|------|-----|-------|
| `account_id` | S | PK | |
| `user_id` | S | SK | |
| `status` | S | | `online`, `away`, `offline` |
| `last_seen` | S | | ISO 8601 |
| `connection_count` | N | | Active connections for this user |
| `ttl` | N | | Epoch + 5min -- heartbeat refresh |

**Note:** Visitors do NOT have presence entries. Only agents appear in the presence table.

---

## Part 3: Lambda Functions

All Python 3.12 runtime. Each Lambda needs:
- IAM role with DynamoDB read/write access
- API Gateway Management API invoke access (`execute-api:ManageConnections`)
- CloudWatch Logs write access
- Environment variables: `CONNECTIONS_TABLE`, `SUBSCRIPTIONS_TABLE`, `PRESENCE_TABLE`, `WS_API_ENDPOINT`, `MESSAGING_API_INTERNAL_URL`, `COGNITO_USER_POOL_ID`, `AWS_REGION`

### 1. `ws-connect` ($connect) -- Both agent and visitor

Handles authentication for both connection types based on the `?type` query parameter.

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    params = event.get("queryStringParameters") or {}
    token = params.get("token")
    conn_type = params.get("type", "agent")  # "agent" or "visitor"

    if not token:
        return {"statusCode": 401}

    if conn_type == "agent":
        return _handle_agent_connect(connection_id, token)
    elif conn_type == "visitor":
        return _handle_visitor_connect(connection_id, token)
    else:
        return {"statusCode": 400}


def _handle_agent_connect(connection_id, token):
    # Validate Cognito JWT (RS256 against JWKS)
    try:
        payload = validate_cognito_jwt(token)  # Fetch JWKS (cached), verify RS256 signature
    except Exception:
        return {"statusCode": 401}

    user_id = payload["sub"]
    email = payload.get("email", "")
    account_ids = set(payload.get("custom:account_ids", "").split(","))

    # Store connection in DynamoDB
    dynamodb.put_item(TableName=CONNECTIONS_TABLE, Item={
        "connection_id": connection_id,
        "connection_type": "agent",
        "user_id": user_id,
        "account_ids": account_ids,
        "email": email,
        "endpoint_id": None,
        "connected_at": datetime.now(UTC).isoformat(),
        "ttl": int(time.time()) + 86400,
    })

    # Auto-subscribe to personal room
    dynamodb.put_item(TableName=SUBSCRIPTIONS_TABLE, Item={
        "room": f"user:{user_id}",
        "connection_id": connection_id,
        "user_id": user_id,
        "subscribed_at": datetime.now(UTC).isoformat(),
        "ttl": int(time.time()) + 86400,
    })

    # Update presence: increment connection_count, set online
    for account_id in account_ids:
        _update_presence(account_id, user_id, status="online", increment=True)

    return {"statusCode": 200}


def _handle_visitor_connect(connection_id, token):
    # Call Messaging API to validate visitor token
    response = requests.post(
        f"{MESSAGING_API_INTERNAL_URL}/internal/validate-visitor",
        json={"token": token},
        timeout=5,
    )

    if response.status_code != 200:
        return {"statusCode": 401}

    data = response.json()
    if not data.get("valid"):
        return {"statusCode": 401}

    visitor_id = data["visitor_id"]
    account_id = data["account_id"]
    endpoint_id = data["endpoint_id"]

    # Store connection in DynamoDB
    dynamodb.put_item(TableName=CONNECTIONS_TABLE, Item={
        "connection_id": connection_id,
        "connection_type": "visitor",
        "user_id": visitor_id,
        "account_ids": {account_id},
        "email": None,
        "endpoint_id": endpoint_id,
        "connected_at": datetime.now(UTC).isoformat(),
        "ttl": int(time.time()) + 86400,
    })

    # Auto-subscribe to visitor room
    dynamodb.put_item(TableName=SUBSCRIPTIONS_TABLE, Item={
        "room": f"visitor:{visitor_id}",
        "connection_id": connection_id,
        "user_id": visitor_id,
        "subscribed_at": datetime.now(UTC).isoformat(),
        "ttl": int(time.time()) + 86400,
    })

    # NO presence update for visitors
    return {"statusCode": 200}
```

### 2. `ws-disconnect` ($disconnect) -- Both agent and visitor

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]

    # Get connection info
    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})

    # Query all subscriptions for this connection (via GSI)
    subs = dynamodb.query(
        SUBSCRIPTIONS_TABLE,
        IndexName="connection_id-index",
        KeyConditionExpression="connection_id = :cid",
        ExpressionAttributeValues={":cid": connection_id},
    )

    # Batch delete all subscriptions
    for sub in subs:
        dynamodb.delete_item(SUBSCRIPTIONS_TABLE, {
            "room": sub["room"],
            "connection_id": connection_id,
        })

    # Delete connection record
    dynamodb.delete_item(CONNECTIONS_TABLE, {"connection_id": connection_id})

    # Agent only: update presence (decrement connection_count)
    if conn and conn.get("connection_type") == "agent":
        for account_id in conn.get("account_ids", []):
            _update_presence(account_id, conn["user_id"], decrement=True)
            # If connection_count reaches 0 -> set status = "offline"
            # and broadcast agent:presence { status: "offline" } to account rooms

    # Visitor: NO presence update
    return {"statusCode": 200}
```

### 3. `ws-subscribe` (subscribe + unsubscribe) -- Agent only

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    action = body.get("action")  # "subscribe" or "unsubscribe"
    room = body.get("room")

    if not room:
        return {"statusCode": 400}

    # Get connection to validate room access
    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn:
        return {"statusCode": 403}

    # Reject visitor connections from using subscribe/unsubscribe
    if conn.get("connection_type") == "visitor":
        return {"statusCode": 403}

    # Validate room access: account_id must be in agent's account_ids
    if room.startswith("account:"):
        account_id = room.split(":")[1]
        if account_id not in conn.get("account_ids", set()):
            return {"statusCode": 403}

    # For conv rooms: verify conversation belongs to agent's account
    # (Lambda reads account_ids from connection metadata -- no external call needed)

    if action == "unsubscribe":
        dynamodb.delete_item(SUBSCRIPTIONS_TABLE, {
            "room": room,
            "connection_id": connection_id,
        })
    else:
        dynamodb.put_item(SUBSCRIPTIONS_TABLE, {
            "room": room,
            "connection_id": connection_id,
            "user_id": conn["user_id"],
            "subscribed_at": datetime.now(UTC).isoformat(),
            "ttl": int(time.time()) + 86400,
        })

    return {"statusCode": 200}
```

### 4. `ws-typing` (typing) -- Agent only

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    conversation_id = body.get("conversation_id")
    typing = body.get("typing", True)

    if not conversation_id:
        return {"statusCode": 400}

    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn or conn.get("connection_type") != "agent":
        return {"statusCode": 403}

    # Query all connections in the conversation room
    room = f"conv:{conversation_id}"
    subscribers = dynamodb.query(
        SUBSCRIPTIONS_TABLE,
        KeyConditionExpression="room = :r",
        ExpressionAttributeValues={":r": room},
    )

    # Relay typing indicator to all except sender
    api_gw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_API_ENDPOINT)
    payload = json.dumps({
        "type": "conversation:typing",
        "data": {
            "user_id": conn["user_id"],
            "conversation_id": conversation_id,
            "typing": typing,
        },
    })

    for sub in subscribers:
        if sub["connection_id"] != connection_id:
            try:
                api_gw.post_to_connection(ConnectionId=sub["connection_id"], Data=payload)
            except api_gw.exceptions.GoneException:
                _cleanup_stale_connection(sub["connection_id"])

    return {"statusCode": 200}
```

### 5. `ws-presence` (presence) -- Agent only

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    status = body.get("status")  # "online", "away", "offline"

    if status not in ("online", "away", "offline"):
        return {"statusCode": 400}

    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn or conn.get("connection_type") != "agent":
        return {"statusCode": 403}

    # Update presence for all accounts and broadcast
    for account_id in conn.get("account_ids", []):
        # Update ws_presence table
        _update_presence(account_id, conn["user_id"], status=status)

        # Broadcast to all connections in this account room
        _broadcast_to_room(f"account:{account_id}", {
            "type": "agent:presence",
            "data": {"user_id": conn["user_id"], "status": status},
        }, exclude=connection_id)

    return {"statusCode": 200}
```

### 6. `ws-visitor-message` (visitor_message) -- Visitor only

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    content = body.get("content")
    content_type = body.get("content_type", "text")

    if not content:
        return {"statusCode": 400}

    # Lookup connection in DynamoDB
    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn or conn.get("connection_type") != "visitor":
        return {"statusCode": 403}

    visitor_id = conn["user_id"]
    account_id = list(conn["account_ids"])[0]
    endpoint_id = conn["endpoint_id"]

    # Call Messaging API to create message
    response = requests.post(
        f"{MESSAGING_API_INTERNAL_URL}/internal/visitor-message",
        json={
            "visitor_id": visitor_id,
            "account_id": account_id,
            "endpoint_id": endpoint_id,
            "content": content,
            "content_type": content_type,
        },
        timeout=10,
    )

    if response.status_code != 200:
        # Send error to visitor
        api_gw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_API_ENDPOINT)
        error_payload = json.dumps({
            "type": "error",
            "code": "message_failed",
        })
        api_gw.post_to_connection(ConnectionId=connection_id, Data=error_payload)
        return {"statusCode": 200}

    result = response.json()

    # Check if message was rejected (no matching config)
    if result.get("allowed") is False:
        api_gw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_API_ENDPOINT)
        error_payload = json.dumps({
            "type": "error",
            "code": "conversation_not_allowed",
            "reason": result.get("reason"),
        })
        api_gw.post_to_connection(ConnectionId=connection_id, Data=error_payload)
        return {"statusCode": 200}

    # If new conversation: subscribe visitor to conv room
    if result.get("is_new_conversation"):
        dynamodb.put_item(TableName=SUBSCRIPTIONS_TABLE, Item={
            "room": f"conv:{result['conversation_id']}",
            "connection_id": connection_id,
            "user_id": visitor_id,
            "subscribed_at": datetime.now(UTC).isoformat(),
            "ttl": int(time.time()) + 86400,
        })

    # Send ACK to visitor
    api_gw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_API_ENDPOINT)
    ack_payload = json.dumps({
        "type": "ack",
        "message_id": result["message_id"],
        "conversation_id": result["conversation_id"],
        "created_at": result["created_at"],
    })
    api_gw.post_to_connection(ConnectionId=connection_id, Data=ack_payload)

    return {"statusCode": 200}
```

### 7. `ws-visitor-typing` (visitor_typing) -- Visitor only

```python
def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event["body"])
    typing = body.get("typing", True)

    conn = dynamodb.get_item(CONNECTIONS_TABLE, {"connection_id": connection_id})
    if not conn or conn.get("connection_type") != "visitor":
        return {"statusCode": 403}

    # Find the visitor's conversation room from subscriptions
    subs = dynamodb.query(
        SUBSCRIPTIONS_TABLE,
        IndexName="connection_id-index",
        KeyConditionExpression="connection_id = :cid",
        ExpressionAttributeValues={":cid": connection_id},
    )

    conv_room = None
    for sub in subs:
        if sub["room"].startswith("conv:"):
            conv_room = sub["room"]
            break

    if not conv_room:
        return {"statusCode": 200}  # No active conversation yet

    conversation_id = conv_room.split(":")[1]

    # Relay typing to all others in the conversation room
    subscribers = dynamodb.query(
        SUBSCRIPTIONS_TABLE,
        KeyConditionExpression="room = :r",
        ExpressionAttributeValues={":r": conv_room},
    )

    api_gw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_API_ENDPOINT)
    payload = json.dumps({
        "type": "conversation:typing",
        "data": {
            "user_id": conn["user_id"],
            "conversation_id": conversation_id,
            "typing": typing,
        },
    })

    for sub in subscribers:
        if sub["connection_id"] != connection_id:
            try:
                api_gw.post_to_connection(ConnectionId=sub["connection_id"], Data=payload)
            except api_gw.exceptions.GoneException:
                _cleanup_stale_connection(sub["connection_id"])

    return {"statusCode": 200}
```

---

## Part 4: IAM Roles

### Lambda Execution Role

DynamoDB access:

```json
{
  "Effect": "Allow",
  "Action": [
    "dynamodb:PutItem",
    "dynamodb:GetItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:UpdateItem",
    "dynamodb:BatchGetItem"
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

API Gateway Management API access:

```json
{
  "Effect": "Allow",
  "Action": "execute-api:ManageConnections",
  "Resource": "arn:aws:execute-api:*:*:*/*/POST/@connections/*"
}
```

CloudWatch Logs access:

```json
{
  "Effect": "Allow",
  "Action": [
    "logs:CreateLogGroup",
    "logs:CreateLogStream",
    "logs:PutLogEvents"
  ],
  "Resource": "arn:aws:logs:*:*:*"
}
```

### Lambda Environment Variables

| Variable | Value | Used By |
|----------|-------|---------|
| `CONNECTIONS_TABLE` | `ws_connections` | All Lambdas |
| `SUBSCRIPTIONS_TABLE` | `ws_subscriptions` | All Lambdas |
| `PRESENCE_TABLE` | `ws_presence` | ws-connect, ws-disconnect, ws-presence |
| `WS_API_ENDPOINT` | `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}` | ws-typing, ws-presence, ws-visitor-message, ws-visitor-typing |
| `MESSAGING_API_INTERNAL_URL` | `http://gt_turumba_messaging_api:8000` | ws-connect (visitor), ws-visitor-message |
| `COGNITO_USER_POOL_ID` | Cognito pool ID | ws-connect (agent JWT validation) |
| `AWS_REGION` | `us-east-1` | ws-connect (Cognito JWKS URL derivation) |

---

## Part 5: Setup Approach

1. **Manual AWS Console setup first** -- create each resource by hand
2. **Document each step** -- screenshots or step-by-step notes
3. **Test end-to-end** -- use `wscat` or Postman WebSocket to validate
4. **Codify later** -- once validated, convert to CDK/SAM/Terraform

### Lambda-to-Messaging API Connectivity

The Lambdas need to reach the Messaging API internal endpoints. Two approaches:

- **Option A: VPC Lambda + Docker network** (recommended for single-region) -- Lambdas run in the same VPC as ECS/Docker services. `MESSAGING_API_INTERNAL_URL=http://messaging-api.internal:8000`
- **Option B: Private HTTP API Gateway** (simpler, cross-region) -- Create a private HTTP API Gateway in front of the Messaging API. Add API key or IAM auth.

---

## Tasks

### API Gateway
- [ ] Create WebSocket API in API Gateway
- [ ] Configure route selection expression: `$request.body.action`
- [ ] Create all 8 routes: `$connect`, `$disconnect`, `subscribe`, `unsubscribe`, `typing`, `presence`, `visitor_message`, `visitor_typing`
- [ ] Wire each route to its Lambda function
- [ ] Deploy to `dev` stage
- [ ] Note the WebSocket URL and callback URL

### DynamoDB
- [ ] Create `ws_connections` table (PK: `connection_id`) with on-demand billing
- [ ] Create `ws_connections` GSI: `user_id-index` (PK: `user_id`)
- [ ] Enable TTL on `ws_connections` (attribute: `ttl`)
- [ ] Create `ws_subscriptions` table (PK: `room`, SK: `connection_id`) with on-demand billing
- [ ] Create `ws_subscriptions` GSI: `connection_id-index` (PK: `connection_id`)
- [ ] Enable TTL on `ws_subscriptions` (attribute: `ttl`)
- [ ] Create `ws_presence` table (PK: `account_id`, SK: `user_id`) with on-demand billing
- [ ] Enable TTL on `ws_presence` (attribute: `ttl`)

### Lambda Functions
- [ ] Create `ws-connect` Lambda (Python 3.12) with dual-path auth (agent JWT + visitor callback)
- [ ] Create `ws-disconnect` Lambda with subscription cleanup + agent presence decrement
- [ ] Create `ws-subscribe` Lambda with room access validation (agent only)
- [ ] Create `ws-typing` Lambda with relay to conv room (agent only)
- [ ] Create `ws-presence` Lambda with broadcast to account rooms (agent only)
- [ ] Create `ws-visitor-message` Lambda with Messaging API callback + ACK + conv room subscribe
- [ ] Create `ws-visitor-typing` Lambda with relay to conv room (visitor only)
- [ ] Create shared Lambda layer for Cognito JWT validation (JWKS caching)
- [ ] Configure IAM roles with DynamoDB + API Gateway Management API + CloudWatch access
- [ ] Set environment variables on all Lambdas

### Testing
- [ ] Agent: `$connect` with valid Cognito JWT -> 200, connection stored with `connection_type: "agent"`
- [ ] Agent: `$connect` with invalid/missing JWT -> 401
- [ ] Visitor: `$connect` with valid visitor token -> 200, connection stored with `connection_type: "visitor"`
- [ ] Visitor: `$connect` with invalid visitor token -> 401 (Messaging API rejects)
- [ ] Agent: subscribe to `account:{id}` room -> subscription created
- [ ] Agent: subscribe to unauthorized account room -> 403
- [ ] Visitor: attempt subscribe action -> 403 (visitors cannot subscribe manually)
- [ ] Agent: typing -> relayed to other connections in conv room
- [ ] Visitor: `visitor_typing` -> relayed to agents in conv room
- [ ] Visitor: `visitor_message` -> Messaging API called, ACK returned
- [ ] Visitor: `visitor_message` with new conversation -> visitor auto-subscribed to conv room
- [ ] Agent: presence update -> broadcast to account room connections
- [ ] Agent/Visitor: `$disconnect` -> connection + subscriptions cleaned up
- [ ] Agent: `$disconnect` with zero remaining connections -> presence set to offline
- [ ] TTL cleanup -- stale connections auto-removed after 24h

---

## Acceptance Criteria

- [ ] WebSocket API accessible at `wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}`
- [ ] Both agent (Cognito JWT) and visitor (visitor token) connections authenticated on `$connect`
- [ ] Connection state stored in DynamoDB with `connection_type` field distinguishing agents from visitors
- [ ] Visitor connections validated via Messaging API `/internal/validate-visitor` callback
- [ ] Room subscription model works (subscribe/unsubscribe for agents, auto-subscribe for visitors)
- [ ] Visitor messages forwarded to Messaging API, ACK returned, conv room subscription auto-created
- [ ] Typing indicators relayed between connected clients in same conv room (both agent and visitor)
- [ ] Agent presence updates broadcast to account rooms (visitors excluded from presence)
- [ ] Disconnect cleanup removes all subscriptions, connection record, and decrements agent presence
- [ ] Stale connections handled gracefully (GoneException -> cleanup)
- [ ] TTL auto-cleanup enabled on all three tables
- [ ] All Lambda environment variables documented and configured

---

## Dependencies

- **RT-BE-007** (Internal Endpoints) -- `/internal/validate-visitor` and `/internal/visitor-message` must exist for Lambda callbacks

## Blocks

- **RT-BE-006** (Realtime Push Worker) -- needs the API Gateway endpoint + DynamoDB tables
- **RT-FE-001** (WebSocket Client) -- needs the WebSocket endpoint URL
- **RT-FE-003** (Chat Widget) -- needs the WebSocket endpoint URL for visitor connections
