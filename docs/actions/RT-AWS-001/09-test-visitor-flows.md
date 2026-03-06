# Phase 9: Test Visitor Flows

**Prerequisites:** Phase 7 + Phase 8 complete, Messaging API deployed with internal endpoints
**Outcome:** All visitor WebSocket flows validated end-to-end

---

## Setup

### Generate a Visitor Token

The Messaging API issues visitor tokens when a chat endpoint is accessed. You need a valid visitor JWT (HMAC-SHA256) with these claims:

```json
{
  "sub": "vs_test123",
  "account_id": "{your-account-uuid}",
  "endpoint_id": "{your-chat-endpoint-uuid}",
  "type": "visitor",
  "exp": 1700000000
}
```

Option A — Generate one manually for testing using Python:

```python
import jwt
import time

token = jwt.encode(
    {
        "sub": "vs_test123",
        "account_id": "{your-account-uuid}",
        "endpoint_id": "{your-chat-endpoint-uuid}",
        "type": "visitor",
        "exp": int(time.time()) + 3600,  # 1 hour
    },
    "{your-VISITOR_JWT_SECRET}",
    algorithm="HS256",
)
print(token)
```

Option B — Use the chat endpoint API if it's implemented (creates a visitor session and returns a token).

### Set Variables

```bash
WS_URL="wss://{api-id}.execute-api.{region}.amazonaws.com/dev"
AGENT_TOKEN="eyJraWQiOi..."     # Valid Cognito JWT
VISITOR_TOKEN="eyJhbGciOi..."   # Valid visitor JWT
```

---

## Test 1: Visitor Connect — Valid Token

```bash
wscat -c "${WS_URL}?token=${VISITOR_TOKEN}&type=visitor"
```

**Expected:** Connection established.

**Verify in DynamoDB:**

1. `ws_connections`:
   - [ ] `connection_type` = `"visitor"`
   - [ ] `user_id` = `"vs_test123"`
   - [ ] `account_ids` = set with one account UUID
   - [ ] `endpoint_id` = chat endpoint UUID
   - [ ] `email` = null (not set for visitors)

2. `ws_subscriptions`:
   - [ ] Auto-subscribed to `visitor:vs_test123` room

3. `ws_presence`:
   - [ ] NO entry created for the visitor

---

## Test 2: Visitor Connect — Invalid Token

```bash
wscat -c "${WS_URL}?token=not.a.real.token&type=visitor"
```

- [ ] Connection rejected (401)

Check CloudWatch Logs for `ws-connect` — should show the rejection reason from the Messaging API.

---

## Test 3: Visitor Connect — Expired Token

Generate a token with `exp` in the past:

```python
token = jwt.encode({..., "exp": int(time.time()) - 60}, secret, algorithm="HS256")
```

```bash
wscat -c "${WS_URL}?token=${EXPIRED_TOKEN}&type=visitor"
```

- [ ] Connection rejected (401, reason: "expired")

---

## Test 4: Visitor Connect — Inactive Chat Endpoint

If you can set `is_active = false` on the chat endpoint in the DB:

- [ ] Connection rejected (401, reason: "endpoint_inactive")

---

## Test 5: Visitor Send Message — First Message (New Conversation)

With the visitor connected (from Test 1), send:

```json
{"action": "visitor_message", "content": "Hello, I need help!", "content_type": "text"}
```

**Expected response on the WebSocket:**

```json
{
  "type": "ack",
  "message_id": "...",
  "conversation_id": "...",
  "created_at": "2026-03-06T..."
}
```

Verify:
- [ ] Received `ack` with `message_id`, `conversation_id`, `created_at`
- [ ] `ws_subscriptions`: visitor auto-subscribed to `conv:{conversation_id}` room
- [ ] Messaging API DB: message created with `direction: inbound`, `sender_type: contact`
- [ ] Messaging API DB: conversation created (if `is_new_conversation: true`)

---

## Test 6: Visitor Send Message — Second Message (Existing Conversation)

Send another message:

```json
{"action": "visitor_message", "content": "My order number is 12345", "content_type": "text"}
```

**Expected:**
- [ ] Received `ack` with the SAME `conversation_id` as Test 5
- [ ] No new subscription created (already subscribed to conv room)
- [ ] Message appended to existing conversation

---

## Test 7: Visitor Message — No Matching Config

If you can configure the Messaging API so that no conversation config matches the chat endpoint:

```json
{"action": "visitor_message", "content": "test", "content_type": "text"}
```

**Expected:**

```json
{
  "type": "error",
  "code": "conversation_not_allowed",
  "reason": "no_matching_config"
}
```

- [ ] Error message received
- [ ] No message or conversation created

---

## Test 8: Visitor Typing — With Active Conversation

First, set up an agent connection subscribed to the same conversation room:

**Terminal 1 (Agent):**
```bash
wscat -c "${WS_URL}?token=${AGENT_TOKEN}&type=agent"
```
Then subscribe:
```json
{"action": "subscribe", "room": "conv:{conversation-id-from-test-5}"}
```

**Terminal 2 (Visitor):** Send typing:
```json
{"action": "visitor_typing", "typing": true}
```

**Expected on Agent (Terminal 1):**

```json
{
  "type": "conversation:typing",
  "data": {
    "user_id": "vs_test123",
    "conversation_id": "...",
    "typing": true
  }
}
```

- [ ] Agent receives visitor typing indicator
- [ ] Visitor does NOT receive their own typing back

Send stop typing:
```json
{"action": "visitor_typing", "typing": false}
```

- [ ] Agent receives `"typing": false`

---

## Test 9: Visitor Typing — No Active Conversation

Connect a fresh visitor (no messages sent yet):

```json
{"action": "visitor_typing", "typing": true}
```

- [ ] No error — silently ignored (no conv room to broadcast to)

---

## Test 10: Visitor Attempts Agent-Only Actions

A connected visitor tries to subscribe to a room:

```json
{"action": "subscribe", "room": "account:{some-uuid}"}
```

- [ ] Rejected (403 — "Visitors cannot subscribe to rooms")

Visitor tries to send typing as an agent:

```json
{"action": "typing", "conversation_id": "some-uuid", "typing": true}
```

- [ ] Rejected (403 — "Agent connection required")

Visitor tries to update presence:

```json
{"action": "presence", "status": "online"}
```

- [ ] Rejected (403 — "Agent connection required")

---

## Test 11: Visitor Disconnect Cleanup

Close the visitor connection (Ctrl+C).

**Verify in DynamoDB:**

- [ ] `ws_connections`: visitor's record deleted
- [ ] `ws_subscriptions`: all visitor subscriptions deleted (`visitor:vs_test123` room, `conv:{uuid}` room)
- [ ] `ws_presence`: NO changes (visitors don't have presence)

---

## Test 12: Agent Receives Visitor Message in Real-Time

This tests the full loop: visitor sends message → Messaging API creates it → realtime push worker → agent receives it.

> **Note:** This test depends on the realtime push worker (RT-BE-006) being implemented. If not yet available, skip this test.

1. Agent connects and subscribes to a conversation room
2. Visitor sends a message
3. Agent should receive a push message:

```json
{
  "type": "conversation:message",
  "data": {
    "message_id": "...",
    "conversation_id": "...",
    "content": "...",
    "direction": "inbound",
    "sender_type": "contact"
  }
}
```

- [ ] Agent receives the message in real-time (if realtime push worker is active)

---

## Test 13: Concurrent Visitors

Connect two visitors (different tokens/visitor_ids) to the same chat endpoint:

- [ ] Both connections succeed
- [ ] Each has their own `visitor:{id}` room
- [ ] Messages create separate conversations
- [ ] Typing from one does not leak to the other

---

## Troubleshooting

### Visitor connect times out

- Check `ws-connect` CloudWatch Logs
- Verify `MESSAGING_API_INTERNAL_URL` is correct
- Test connectivity (Phase 8 verification)

### Visitor message returns "message_failed"

- Check `ws-visitor-message` CloudWatch Logs
- Check Messaging API logs for the `/internal/visitor-message` endpoint
- Verify the Messaging API has conversation configs set up for the chat endpoint

### Typing not relayed

- Verify both connections are in the same `conv:{uuid}` room (check `ws_subscriptions`)
- Check `ws-visitor-typing` CloudWatch Logs
- Verify `WS_API_ENDPOINT` is set correctly

---

## Results Summary

| Test | Description | Pass? |
|------|-------------|-------|
| 1 | Visitor connect with valid token | |
| 2 | Visitor connect with invalid token (401) | |
| 3 | Visitor connect with expired token (401) | |
| 4 | Visitor connect with inactive endpoint (401) | |
| 5 | First visitor message (new conversation + ACK) | |
| 6 | Second visitor message (existing conversation) | |
| 7 | Visitor message — no matching config (error) | |
| 8 | Visitor typing relayed to agent | |
| 9 | Visitor typing — no conversation (silent) | |
| 10 | Visitor attempts agent-only actions (403) | |
| 11 | Visitor disconnect cleanup | |
| 12 | Agent receives visitor message in real-time | |
| 13 | Concurrent visitors — isolation | |

---

## All Phases Complete

Once all tests pass, the full acceptance criteria from the issue are met:

- [x] WebSocket API accessible at `wss://...`
- [x] Both agent and visitor connections authenticated
- [x] Connection state stored with `connection_type` distinguishing agents from visitors
- [x] Visitor connections validated via Messaging API callback
- [x] Room subscription model works (agents subscribe, visitors auto-subscribe)
- [x] Visitor messages forwarded, ACK returned, conv room auto-created
- [x] Typing indicators relayed for both agent and visitor
- [x] Agent presence broadcasts (visitors excluded)
- [x] Disconnect cleanup working
- [x] Stale connections handled (GoneException)
- [x] TTL enabled on all tables
- [x] All Lambda environment variables documented and configured

### Post-Setup: Tighten Security

1. Tighten the API Gateway Management IAM policy to the specific API ID
2. Tighten CloudWatch Logs policy to `/aws/lambda/ws-*`
3. Document the WebSocket URL for downstream consumers:
   - **RT-BE-006** (Realtime Push Worker) — needs API Gateway endpoint + DynamoDB tables
   - **RT-FE-001** (WebSocket Client) — needs the `wss://` URL
   - **RT-FE-003** (Chat Widget) — needs the `wss://` URL for visitor connections
