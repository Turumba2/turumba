# Phase 6: Test Agent Flows

**Prerequisites:** Phase 5 complete (API Gateway deployed, smoke test passing)
**Outcome:** All agent WebSocket flows validated end-to-end

---

## Setup

### Install `wscat`

```bash
npm install -g wscat
```

### Get a Valid Cognito Token

Option A — From your running app (browser devtools > Application > Local Storage > look for `idToken` or `accessToken`).

Option B — Via AWS CLI:

```bash
aws cognito-idp initiate-auth \
  --client-id {your-client-id} \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME={email},PASSWORD={password} \
  --region us-east-1
```

Copy the `IdToken` from the response.

### Set Variables

```bash
WS_URL="wss://{api-id}.execute-api.{region}.amazonaws.com/dev"
TOKEN="eyJraWQiOi..."
```

---

## Test 1: Agent Connect — Valid Token

```bash
wscat -c "${WS_URL}?token=${TOKEN}&type=agent"
```

**Expected:** Connection established (stays open).

**Verify in DynamoDB:**

1. `ws_connections` — scan for the latest record:
   - [ ] `connection_id` present
   - [ ] `connection_type` = `"agent"`
   - [ ] `user_id` = Cognito `sub` from your token
   - [ ] `account_ids` = set of account UUIDs from token
   - [ ] `email` populated
   - [ ] `ttl` set (epoch + 24 hours)

2. `ws_subscriptions` — query `room = user:{user_id}`:
   - [ ] Auto-subscribed to personal `user:{user_id}` room

3. `ws_presence` — scan for the user:
   - [ ] `status` = `"online"`
   - [ ] `connection_count` = 1

**Leave this connection open for the next tests.**

---

## Test 2: Agent Connect — Missing Token

```bash
wscat -c "${WS_URL}?type=agent"
```

- [ ] Connection rejected immediately (401)

---

## Test 3: Agent Connect — Invalid Token

```bash
wscat -c "${WS_URL}?token=not.a.real.jwt&type=agent"
```

- [ ] Connection rejected immediately (401)

---

## Test 4: Agent Connect — Expired Token

Use an expired JWT (you can decode one and check `exp`). If you don't have one handy, skip for now.

- [ ] Connection rejected (401)

---

## Test 5: Subscribe to Account Room

In the open `wscat` session from Test 1, send:

```json
{"action": "subscribe", "room": "account:{your-account-id}"}
```

Replace `{your-account-id}` with one of the account IDs in the agent's token.

**Verify in DynamoDB:**

- [ ] `ws_subscriptions` has a new record: `room = account:{uuid}`, `connection_id = {your-connection}`

**Expected response:** Connection stays open (200 returned server-side, no message sent to client).

---

## Test 6: Subscribe to Unauthorized Account Room

```json
{"action": "subscribe", "room": "account:00000000-0000-0000-0000-000000000000"}
```

Use an account ID that is NOT in the agent's token.

- [ ] Should receive a 403 (connection stays open, no subscription created)

Check DynamoDB:
- [ ] No subscription created for this room

---

## Test 7: Subscribe to Conversation Room

```json
{"action": "subscribe", "room": "conv:11111111-1111-1111-1111-111111111111"}
```

- [ ] Subscription created (conv rooms are allowed for all authenticated agents)

---

## Test 8: Unsubscribe from Room

```json
{"action": "unsubscribe", "room": "conv:11111111-1111-1111-1111-111111111111"}
```

- [ ] Subscription removed from DynamoDB

---

## Test 9: Typing Indicator

This test requires **two agent connections** to observe the relay.

### Open a second connection

In a new terminal:

```bash
wscat -c "${WS_URL}?token=${TOKEN}&type=agent"
```

### Subscribe both to the same conversation room

In **both** sessions:

```json
{"action": "subscribe", "room": "conv:22222222-2222-2222-2222-222222222222"}
```

### Send typing from connection 1

```json
{"action": "typing", "conversation_id": "22222222-2222-2222-2222-222222222222", "typing": true}
```

**Expected on connection 2:**

```json
{"type": "conversation:typing", "data": {"user_id": "...", "conversation_id": "22222222-2222-2222-2222-222222222222", "typing": true}}
```

- [ ] Connection 2 receives the typing indicator
- [ ] Connection 1 does NOT receive it (sender excluded)

### Send typing stop

```json
{"action": "typing", "conversation_id": "22222222-2222-2222-2222-222222222222", "typing": false}
```

- [ ] Connection 2 receives `"typing": false`

---

## Test 10: Presence Update

With both connections still open, subscribe both to an account room:

```json
{"action": "subscribe", "room": "account:{your-account-id}"}
```

From connection 1, send:

```json
{"action": "presence", "status": "away"}
```

**Expected on connection 2:**

```json
{"type": "agent:presence", "data": {"user_id": "...", "status": "away"}}
```

- [ ] Connection 2 receives the presence broadcast
- [ ] DynamoDB `ws_presence` shows `status: away` for the user

Set back to online:

```json
{"action": "presence", "status": "online"}
```

- [ ] Presence updated, broadcast received

---

## Test 11: Invalid Presence Status

```json
{"action": "presence", "status": "busy"}
```

- [ ] Rejected (400) — "busy" is not a valid status

---

## Test 12: Disconnect Cleanup

Close connection 2 (Ctrl+C in `wscat`).

**Verify in DynamoDB:**

1. `ws_connections`:
   - [ ] Connection 2's record deleted

2. `ws_subscriptions`:
   - [ ] All subscriptions for connection 2 deleted (conv room, account room, user room)

3. `ws_presence`:
   - [ ] `connection_count` decremented (still 1 because connection 1 is active)
   - [ ] `status` still `"online"` (connection 1 is still connected)

---

## Test 13: Last Connection Disconnect — Goes Offline

Close connection 1 (Ctrl+C).

**Verify in DynamoDB:**

1. `ws_connections`:
   - [ ] Connection 1's record deleted

2. `ws_presence`:
   - [ ] `connection_count` = 0
   - [ ] `status` = `"offline"`

---

## Test 14: Multiple Accounts

If your test user belongs to multiple accounts, verify:

- [ ] Presence updated in `ws_presence` for ALL accounts on connect
- [ ] Presence decremented for ALL accounts on disconnect
- [ ] Subscribe to each account room independently

---

## Test 15: TTL Behavior

Check that `ttl` values are set correctly:

- [ ] `ws_connections.ttl` — epoch + 24 hours from connect time
- [ ] `ws_subscriptions.ttl` — epoch + 24 hours from subscribe time
- [ ] `ws_presence.ttl` — epoch + 5 minutes (heartbeat refresh)

> TTL actual deletion by DynamoDB can take up to 48 hours. You're just verifying the values are correct, not that deletion happened.

---

## Troubleshooting

### Connection rejected but no error details

Check the `ws-connect` Lambda's **CloudWatch Logs**:
1. Open **Lambda > ws-connect > Monitor > View CloudWatch logs**
2. Look for the most recent log stream
3. Check for JWT validation errors

### Typing/Presence not being received

1. Verify both connections are subscribed to the same room (check `ws_subscriptions`)
2. Check `WS_API_ENDPOINT` is set correctly on the broadcasting Lambda
3. Check CloudWatch Logs for the Lambda that was invoked

### DynamoDB records not appearing

1. Check the Lambda has the correct table names in environment variables
2. Check CloudWatch Logs for DynamoDB permission errors
3. Verify the IAM role has the correct policy

---

## Results Summary

| Test | Description | Pass? |
|------|-------------|-------|
| 1 | Agent connect with valid token | |
| 2 | Connect without token (401) | |
| 3 | Connect with invalid token (401) | |
| 4 | Connect with expired token (401) | |
| 5 | Subscribe to authorized account room | |
| 6 | Subscribe to unauthorized account room (403) | |
| 7 | Subscribe to conversation room | |
| 8 | Unsubscribe from room | |
| 9 | Typing indicator relay (two connections) | |
| 10 | Presence update + broadcast | |
| 11 | Invalid presence status (400) | |
| 12 | Disconnect cleanup (one of two connections) | |
| 13 | Last connection disconnect (goes offline) | |
| 14 | Multiple accounts | |
| 15 | TTL values correct | |

**Next:** [Phase 7 — Visitor Lambda Functions](./07-lambda-visitor-functions.md) (blocked on RT-BE-007)
