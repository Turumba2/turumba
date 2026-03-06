# Phase 5: API Gateway WebSocket API

**Prerequisites:** Phase 4 complete (all 5 agent Lambda functions created)
**Outcome:** WebSocket API deployed with agent routes wired to Lambdas

---

## Step 1: Create the WebSocket API

1. Open **AWS Console > API Gateway**
2. Click **Create API**
3. Under **WebSocket API**, click **Build**
4. Configure:
   - API name: `turumba-ws`
   - Route selection expression: `$request.body.action`
   - Description: `Turumba realtime WebSocket API for agents and visitors`
5. Click **Next**

---

## Step 2: Add Routes

On the route configuration screen, add the following routes:

| Route Key | Description |
|-----------|-------------|
| `$connect` | Authentication on connect |
| `$disconnect` | Cleanup on disconnect |
| `subscribe` | Join a room (agent) |
| `unsubscribe` | Leave a room (agent) |
| `typing` | Typing indicator (agent) |
| `presence` | Presence update (agent) |

> The visitor routes (`visitor_message`, `visitor_typing`) will be added in Phase 7.

For each route:
1. Click **Add route**
2. Enter the route key
3. Click **checkmark** to confirm

Click **Next**.

---

## Step 3: Attach Lambda Integrations

For each route, attach the corresponding Lambda function:

| Route | Lambda Function |
|-------|----------------|
| `$connect` | `ws-connect` |
| `$disconnect` | `ws-disconnect` |
| `subscribe` | `ws-subscribe` |
| `unsubscribe` | `ws-subscribe` _(same function handles both)_ |
| `typing` | `ws-typing` |
| `presence` | `ws-presence` |

For each route:
1. Integration type: **Lambda**
2. Lambda function: select the corresponding function
3. Make sure **Use Lambda Proxy integration** is checked

Click **Next**.

---

## Step 4: Add a Stage

1. Stage name: `dev`
2. Auto-deploy: **enabled** (convenient for iterating during setup)
3. Click **Next**
4. Review and click **Create and deploy**

---

## Step 5: Note the Endpoints

After creation, go to the **Stages** tab and select `dev`:

1. **WebSocket URL** (for clients to connect):
   ```
   wss://{api-id}.execute-api.{region}.amazonaws.com/dev
   ```

2. **Connection URL** (for Lambda to push messages back — this is the callback URL):
   ```
   https://{api-id}.execute-api.{region}.amazonaws.com/dev
   ```

Record both values. The Connection URL is the `WS_API_ENDPOINT` for your Lambda environment variables.

---

## Step 6: Grant API Gateway Permission to Invoke Lambdas

API Gateway needs permission to invoke each Lambda function. If you used the Console integration setup, this is usually done automatically. Verify by checking each Lambda's **Configuration > Permissions > Resource-based policy**.

If missing, add a resource-based policy manually for each Lambda:

```bash
aws lambda add-permission \
  --function-name ws-connect \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:{region}:{account-id}:{api-id}/*"
```

Repeat for: `ws-disconnect`, `ws-subscribe`, `ws-typing`, `ws-presence`.

---

## Step 7: Update Lambda Environment Variables

Go back to each of the 5 Lambda functions and set `WS_API_ENDPOINT`:

```
WS_API_ENDPOINT=https://{api-id}.execute-api.{region}.amazonaws.com/dev
```

Functions that need this value for broadcasting:
- `ws-disconnect` (broadcasts presence offline)
- `ws-typing` (relays typing to room)
- `ws-presence` (broadcasts status to account room)

The other two (`ws-connect`, `ws-subscribe`) don't broadcast but setting it on all keeps configuration uniform.

---

## Step 8: Quick Smoke Test

Using `wscat` (install with `npm install -g wscat`):

### Test 1: Connect without token (expect 401)

```bash
wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/dev"
```

Expected: Connection rejected (401 — no token).

### Test 2: Connect with invalid token (expect 401)

```bash
wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/dev?token=invalid&type=agent"
```

Expected: Connection rejected (401 — invalid JWT).

### Test 3: Connect with valid Cognito JWT (expect 200)

Get a valid Cognito token first (from your app or via AWS CLI):

```bash
# Get a token from Cognito (example using hosted UI or aws cognito-idp)
TOKEN="eyJraWQiOi..."

wscat -c "wss://{api-id}.execute-api.{region}.amazonaws.com/dev?token=${TOKEN}&type=agent"
```

Expected: Connection established. Check DynamoDB:
- `ws_connections` should have a new record with `connection_type: agent`
- `ws_subscriptions` should have a `user:{user_id}` room entry
- `ws_presence` should show `status: online` for the user's accounts

If the smoke test passes, proceed to the full test suite in Phase 6.

---

## Verification

- [ ] WebSocket API `turumba-ws` created
- [ ] Route selection expression: `$request.body.action`
- [ ] 6 routes configured: `$connect`, `$disconnect`, `subscribe`, `unsubscribe`, `typing`, `presence`
- [ ] Each route wired to its Lambda function
- [ ] `subscribe` and `unsubscribe` both point to `ws-subscribe`
- [ ] Deployed to `dev` stage with auto-deploy enabled
- [ ] WebSocket URL noted: `wss://{api-id}...`
- [ ] Connection URL noted: `https://{api-id}...`
- [ ] API Gateway has permission to invoke all 5 Lambdas
- [ ] `WS_API_ENDPOINT` set on all 5 Lambda functions
- [ ] Smoke test: unauthenticated connection rejected (401)
- [ ] Smoke test: authenticated connection accepted (200)

**Next:** [Phase 6 — Test Agent Flows](./06-test-agent-flows.md)
