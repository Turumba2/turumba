# Phase 7: Visitor Lambda Functions

**Prerequisites:** Phase 5 complete, **RT-BE-007 resolved** (internal endpoints exist in Messaging API)
**Outcome:** Visitor WebSocket flows working — connect, message, typing

> **BLOCKED:** This phase requires `POST /internal/validate-visitor` and `POST /internal/visitor-message` to exist in the Messaging API. Do not start until turumba_messaging_api#67 is merged and deployed.

---

## Overview

Three changes in this phase:
1. **Update `ws-connect`** — Add the visitor authentication path
2. **Create `ws-visitor-message`** — New Lambda for visitor messages
3. **Create `ws-visitor-typing`** — New Lambda for visitor typing indicators
4. **Add 2 new routes** to the API Gateway

---

## Function Update: `ws-connect` (Add Visitor Path)

### Update the Code

Replace the visitor stub in `ws-connect` with the actual implementation:

```python
"""$connect handler — authenticate agent and visitor connections."""

import json
import os
import urllib.request

from turumba_ws.cognito import validate_cognito_jwt
from turumba_ws.dynamo import store_connection, store_subscription
from turumba_ws.presence import update_presence

MESSAGING_API_URL = os.environ.get("MESSAGING_API_INTERNAL_URL", "")


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
        return _handle_visitor_connect(connection_id, token)
    else:
        return {"statusCode": 400, "body": f"Unknown connection type: {conn_type}"}


def _handle_agent_connect(connection_id, token):
    """Validate Cognito JWT and store agent connection."""
    try:
        payload = validate_cognito_jwt(token)
    except ValueError as e:
        print(f"Agent JWT validation failed: {e}")
        return {"statusCode": 401, "body": str(e)}

    user_id = payload["sub"]
    email = payload.get("email", "")
    raw_accounts = payload.get("custom:account_ids", "")
    account_ids = set(filter(None, raw_accounts.split(",")))

    if not account_ids:
        print(f"No account_ids in token for user {user_id}")
        return {"statusCode": 403, "body": "No account_ids in token"}

    store_connection(
        connection_id=connection_id,
        connection_type="agent",
        user_id=user_id,
        account_ids=account_ids,
        email=email,
    )

    store_subscription(
        room=f"user:{user_id}",
        connection_id=connection_id,
        user_id=user_id,
    )

    for account_id in account_ids:
        update_presence(account_id, user_id, increment=True)

    print(f"Agent connected: {user_id} ({email}), accounts: {account_ids}")
    return {"statusCode": 200}


def _handle_visitor_connect(connection_id, token):
    """Validate visitor token via Messaging API callback and store visitor connection."""
    if not MESSAGING_API_URL:
        print("MESSAGING_API_INTERNAL_URL not configured")
        return {"statusCode": 500, "body": "Visitor auth not configured"}

    # Call Messaging API to validate visitor token
    url = f"{MESSAGING_API_URL}/internal/validate-visitor"
    data = json.dumps({"token": token}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"Visitor validation HTTP error: {e.code}")
        return {"statusCode": 401, "body": "Visitor validation failed"}
    except Exception as e:
        print(f"Visitor validation error: {e}")
        return {"statusCode": 500, "body": "Visitor validation unavailable"}

    if not result.get("valid"):
        reason = result.get("reason", "unknown")
        print(f"Visitor token invalid: {reason}")
        return {"statusCode": 401, "body": reason}

    visitor_id = result["visitor_id"]
    account_id = result["account_id"]
    endpoint_id = result["endpoint_id"]

    # Store visitor connection
    store_connection(
        connection_id=connection_id,
        connection_type="visitor",
        user_id=visitor_id,
        account_ids={account_id},
        endpoint_id=endpoint_id,
    )

    # Auto-subscribe to visitor room
    store_subscription(
        room=f"visitor:{visitor_id}",
        connection_id=connection_id,
        user_id=visitor_id,
    )

    # NO presence update for visitors
    print(f"Visitor connected: {visitor_id}, endpoint: {endpoint_id}, account: {account_id}")
    return {"statusCode": 200}
```

### Add Environment Variable

Add to `ws-connect`:

| Variable | Value |
|----------|-------|
| `MESSAGING_API_INTERNAL_URL` | _(from Phase 8 connectivity decision)_ |

---

## Function 6: `ws-visitor-message`

Forwards visitor messages to the Messaging API and returns an ACK.

### Create the Function

1. **Lambda > Create function**
2. Function name: `ws-visitor-message`
3. Runtime: Python 3.12
4. Execution role: `turumba-ws-lambda-role`
5. Timeout: **15 seconds** (calls Messaging API which does DB work)
6. Layer: `turumba-ws-shared`

### Environment Variables

All standard variables plus:

| Variable | Value |
|----------|-------|
| `MESSAGING_API_INTERNAL_URL` | _(from Phase 8)_ |

### Code

```python
"""visitor_message handler — forward visitor messages to Messaging API."""

import json
import os
import urllib.request

from turumba_ws.broadcast import post_to_connection
from turumba_ws.dynamo import get_connection, store_subscription


MESSAGING_API_URL = os.environ.get("MESSAGING_API_INTERNAL_URL", "")


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event.get("body", "{}"))
    content = body.get("content")
    content_type = body.get("content_type", "text")

    if not content:
        return {"statusCode": 400, "body": "Missing content"}

    # Lookup connection — must be a visitor
    conn = get_connection(connection_id)
    if not conn or conn.get("connection_type") != "visitor":
        return {"statusCode": 403, "body": "Visitor connection required"}

    visitor_id = conn["user_id"]
    account_ids = conn.get("account_ids", set())
    account_id = list(account_ids)[0] if account_ids else None
    endpoint_id = conn.get("endpoint_id")

    if not account_id or not endpoint_id:
        _send_error(connection_id, "missing_context")
        return {"statusCode": 200}

    # Call Messaging API to create message
    url = f"{MESSAGING_API_URL}/internal/visitor-message"
    payload = {
        "visitor_id": visitor_id,
        "account_id": account_id,
        "endpoint_id": endpoint_id,
        "content": content,
        "content_type": content_type,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"Messaging API HTTP error: {e.code}")
        _send_error(connection_id, "message_failed")
        return {"statusCode": 200}
    except Exception as e:
        print(f"Messaging API error: {e}")
        _send_error(connection_id, "message_failed")
        return {"statusCode": 200}

    # Check if message was rejected (no matching config)
    if result.get("allowed") is False:
        _send_error(
            connection_id,
            "conversation_not_allowed",
            reason=result.get("reason"),
        )
        return {"statusCode": 200}

    # If new conversation: auto-subscribe visitor to conv room
    if result.get("is_new_conversation"):
        store_subscription(
            room=f"conv:{result['conversation_id']}",
            connection_id=connection_id,
            user_id=visitor_id,
        )
        print(f"Visitor {visitor_id} auto-subscribed to conv:{result['conversation_id']}")

    # Send ACK to visitor
    ack = {
        "type": "ack",
        "message_id": result["message_id"],
        "conversation_id": result["conversation_id"],
        "created_at": result["created_at"],
    }
    post_to_connection(connection_id, ack)

    print(f"Visitor {visitor_id} message forwarded, conversation: {result['conversation_id']}")
    return {"statusCode": 200}


def _send_error(connection_id: str, code: str, reason: str = None):
    """Send an error message to the visitor."""
    payload = {"type": "error", "code": code}
    if reason:
        payload["reason"] = reason
    post_to_connection(connection_id, payload)
```

---

## Function 7: `ws-visitor-typing`

Relays visitor typing indicators to agents in the conversation room.

### Create the Function

1. Function name: `ws-visitor-typing`
2. Runtime: Python 3.12
3. Execution role: `turumba-ws-lambda-role`
4. Timeout: 10 seconds
5. Layer: `turumba-ws-shared`

### Code

```python
"""visitor_typing handler — relay visitor typing to agents in conversation room."""

import json

from turumba_ws.broadcast import broadcast_to_room, cleanup_stale_connection
from turumba_ws.dynamo import get_connection, get_subscriptions_by_connection


def handler(event, context):
    connection_id = event["requestContext"]["connectionId"]
    body = json.loads(event.get("body", "{}"))
    typing = body.get("typing", True)

    # Lookup connection — must be a visitor
    conn = get_connection(connection_id)
    if not conn or conn.get("connection_type") != "visitor":
        return {"statusCode": 403, "body": "Visitor connection required"}

    # Find the visitor's conversation room from their subscriptions
    subs = get_subscriptions_by_connection(connection_id)
    conv_room = None
    for sub in subs:
        if sub["room"].startswith("conv:"):
            conv_room = sub["room"]
            break

    if not conv_room:
        # No active conversation yet — silently ignore
        return {"statusCode": 200}

    conversation_id = conv_room.split(":")[1]

    # Relay typing to all others in the conversation room
    payload = {
        "type": "conversation:typing",
        "data": {
            "user_id": conn["user_id"],
            "conversation_id": conversation_id,
            "typing": typing,
        },
    }

    stale = broadcast_to_room(conv_room, payload, exclude_connection=connection_id)
    for stale_cid in stale:
        cleanup_stale_connection(stale_cid)

    return {"statusCode": 200}
```

---

## Add Routes to API Gateway

1. Open **API Gateway > turumba-ws > Routes**
2. Add two new routes:

| Route Key | Lambda Function |
|-----------|----------------|
| `visitor_message` | `ws-visitor-message` |
| `visitor_typing` | `ws-visitor-typing` |

3. For each route:
   - Click the route
   - Attach integration: Lambda, select the function
   - Ensure Lambda Proxy integration is checked

4. If auto-deploy is enabled, the routes are live immediately. Otherwise, deploy to `dev` stage.

5. Grant API Gateway permission to invoke the new Lambdas (if not automatic):

```bash
aws lambda add-permission \
  --function-name ws-visitor-message \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:{region}:{account-id}:{api-id}/*"

aws lambda add-permission \
  --function-name ws-visitor-typing \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:{region}:{account-id}:{api-id}/*"
```

---

## Verification

- [ ] `ws-connect` updated with visitor authentication path
- [ ] `ws-visitor-message` created, layer attached, 15s timeout
- [ ] `ws-visitor-typing` created, layer attached, 10s timeout
- [ ] `MESSAGING_API_INTERNAL_URL` set on `ws-connect` and `ws-visitor-message`
- [ ] Two new routes added to API Gateway: `visitor_message`, `visitor_typing`
- [ ] API Gateway has permission to invoke both new Lambdas

**Next:** [Phase 8 — Lambda-to-Messaging API Connectivity](./08-lambda-messaging-api-connectivity.md)
