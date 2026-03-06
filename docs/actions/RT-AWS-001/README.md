# RT-AWS-001: AWS WebSocket Infrastructure — Action Plans

**Issue:** [Turumba2/turumba#2](https://github.com/Turumba2/turumba/issues/2)
**Assignee:** bengeos
**Priority:** P1
**Status:** Not Started

## Blocker Status

| Blocker | Issue | Status | Impact |
|---------|-------|--------|--------|
| RT-BE-007 | turumba_messaging_api#67 | Not started | Blocks visitor Lambda testing (Phases 6-7) |

**Agent-side infrastructure (Phases 1-5) has ZERO blockers and can start immediately.**

## Phases

| Phase | Document | Can Start Now? | Estimated Effort |
|-------|----------|----------------|------------------|
| 1 | [01-dynamodb-tables.md](./01-dynamodb-tables.md) | Yes | 30 min |
| 2 | [02-iam-roles.md](./02-iam-roles.md) | Yes | 20 min |
| 3 | [03-lambda-shared-layer.md](./03-lambda-shared-layer.md) | Yes | 45 min |
| 4 | [04-lambda-agent-functions.md](./04-lambda-agent-functions.md) | Yes | 2-3 hours |
| 5 | [05-api-gateway-websocket.md](./05-api-gateway-websocket.md) | After Phase 1-4 | 30 min |
| 6 | [06-test-agent-flows.md](./06-test-agent-flows.md) | After Phase 5 | 1 hour |
| 7 | [07-lambda-visitor-functions.md](./07-lambda-visitor-functions.md) | After RT-BE-007 | 2 hours |
| 8 | [08-lambda-messaging-api-connectivity.md](./08-lambda-messaging-api-connectivity.md) | After Phase 7 | 1-2 hours |
| 9 | [09-test-visitor-flows.md](./09-test-visitor-flows.md) | After Phase 7-8 | 1 hour |

## Decisions Required Before Starting

1. **AWS Region** — Confirm `us-east-1` (must match Cognito User Pool region)
2. **IaC approach** — Manual Console first, codify later (as specified in issue)
3. **Stage name** — `dev` initially
4. **Lambda-to-Messaging-API connectivity** — VPC Lambda (Option A) vs Private HTTP API GW (Option B). Decision needed before Phase 8.

## Environment Variables Collected Along the Way

Track these as you create resources — they're needed for Lambda configuration in Phase 4/7:

```
CONNECTIONS_TABLE=ws_connections
SUBSCRIPTIONS_TABLE=ws_subscriptions
PRESENCE_TABLE=ws_presence
WS_API_ENDPOINT=                    # From Phase 5 (API Gateway callback URL)
MESSAGING_API_INTERNAL_URL=         # From Phase 8 (connectivity decision)
COGNITO_USER_POOL_ID=               # Existing Cognito pool
AWS_REGION=us-east-1                # Confirm
```
