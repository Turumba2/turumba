# Architecture Review — Turumba Realtime Messaging

Honest critical assessment of the architecture defined in `TURUMBA_REALTIME_MESSAGING.md` and the detailed workflows in `docs/realtime/`.

---

## What's Done Well

### 1. Unified Inbox Model
Single `conversations` table with `channel_id` / `chat_endpoint_id` mutual exclusion is clean. Agents get one inbox regardless of source. The CHECK constraint enforces this at the DB level.

### 2. Multi-Config Evaluation System
The `conversation_configs` model with priority-ordered evaluation is genuinely powerful. Enables VIP routing, audience segmentation, and per-source behavior — all without code changes. First-match-wins is simple to reason about.

### 3. Clean Separation of Concerns
- `chat_endpoints` = widget UI/UX only (colors, pre-chat forms, CORS)
- `conversation_configs` = routing logic only (audience, teams, creation mode)
- No overlapping responsibilities after the contradiction cleanup

### 4. Comprehensive Workflow Documentation
The `docs/realtime/` workflow documents with timing estimates, sequence diagrams, and worked examples are unusually thorough for a spec-stage project. They'll accelerate implementation.

---

## Concerns

### CONCERN 1 (Critical): Fire-and-Forget Push Before Persistence

**Location:** `docs/realtime/03-AGENT-REPLY-FLOW.md`, Section 8.4 of the spec

The agent reply flow pushes the message via WebSocket *before* writing to the database:

```
Agent POST /messages → push_to_room() → return 202 → background: persist to DB
```

**Why this is dangerous for a support tool:**
- If the background persist fails (DB down, connection pool exhausted, constraint violation), the agent sees the message delivered, the visitor sees it, but it's **not in the database**. No audit trail, no conversation history.
- A support tool's conversation history is its core value. Chatwoot, Intercom, Zendesk — all persist first, push second. They accept the ~50ms latency penalty for correctness.
- The 202 response means the client has no way to know if persistence succeeded without polling.

**Recommendation:** Persist first, push second. The ~50ms added latency is imperceptible to humans in a chat context. If sub-50ms push is truly needed, persist synchronously *and* push in parallel (not sequentially), but still return 200 only after DB commit succeeds.

### CONCERN 2 (Critical): Lambda-to-Messaging-API Connectivity

**Location:** Section 2.3, `docs/realtime/02-VISITOR-CHAT-FLOW.md`

The spec describes Lambda calling back to the Messaging API on the Docker network:

```
Lambda ──HTTP──→ gt_turumba_messaging_api:8000/internal/visitor-message
```

**The problem:** AWS Lambda functions run in AWS's VPC, not in the Docker Compose network. `gt_turumba_messaging_api:8000` is a Docker container DNS name that Lambda cannot resolve.

**Options not discussed in the spec:**
1. **Lambda in VPC** — Place Lambda in the same VPC as the ECS/EC2 services. Adds cold start latency (~1-5s for VPC-attached Lambda), requires NAT Gateway for outbound.
2. **Public endpoint with API key** — Expose `/internal/*` through KrakenD with an API key. Simpler but adds gateway hop + security surface.
3. **Lambda calls KrakenD** — Lambda calls the gateway's public URL. Requires a service-to-service auth scheme for internal endpoints.

This is a deployment architecture gap that needs resolution before implementation.

### CONCERN 3 (High): Messaging API Becoming a Monolith

The Messaging API now owns: channels, messages, templates, group messages, scheduled messages, outbox events, conversations, chat endpoints, conversation configs, AND the realtime push worker. It also makes HTTP calls to Account API for contact lookup, group membership, and contact creation.

**Risk:** The realtime push worker (consuming RabbitMQ, querying DynamoDB, pushing to API Gateway @connections) has very different scaling characteristics from the REST API. Under load, the worker's DynamoDB and API Gateway calls could consume connection pool resources needed by the REST endpoints.

**Recommendation:** Run the `realtime_push_worker` as a **separate deployment** (separate container/process) from the Messaging API web server. They share the codebase but scale independently. This is already how the other workers (dispatch, group processor) are structured.

### CONCERN 4 (Medium): DynamoDB Vendor Lock-in

Three DynamoDB tables (`ws_connections`, `ws_subscriptions`, `ws_presence`) create hard AWS coupling. If you ever need to run on-premise or multi-cloud, these need replacement.

**Pragmatic view:** For a startup/scale-up, AWS lock-in is acceptable. DynamoDB is the right tool for connection state (low-latency key lookups, auto-expiry via TTL). Just be aware this is a one-way door.

**If you want an escape hatch:** Redis could serve the same role (connection mappings, pub/sub for presence, TTL for cleanup). But Redis adds operational burden (clustering, persistence) that DynamoDB avoids.

### CONCERN 5 (Medium): Weak contact_identifier Without ContactIdentifiers Table

The spec defers `contact_identifiers` (Section 3.3) but uses `contact_identifier` (a string field on conversations) throughout. This means:
- No cross-channel identity unification (same person on Telegram and WhatsApp = two contacts)
- Contact lookup relies on phone/email matching, which is fragile
- The `contact_identifier` field on conversations is denormalized and can go stale

This is acceptable for MVP but will become a data quality problem at scale. Plan for the ContactIdentifiers migration early.

### CONCERN 6 (Medium): No Config Conflict Detection

Multiple configs can reference the same source (e.g., two configs both enabling the same Telegram channel). The spec notes "A source should appear in at most ONE active config to avoid ambiguity" but doesn't enforce it.

**Risk:** An admin creates conflicting configs, messages silently route to the wrong team, nobody notices until a customer complains.

**Recommendation:** Add a validation warning (not a hard error) on config create/update: "This channel is already targeted by config 'X' with priority Y. Messages will match that config first."

### CONCERN 7 (Low): 202 Response Semantics

The agent reply endpoint returns 202 (Accepted) for the fire-and-forget pattern. If you switch to persist-first (Concern 1), this should become 201 (Created) with the full message object in the response body. The client needs the server-generated `id`, `created_at`, and `conversation_id` for reconciliation.

### CONCERN 8 (Low): No Rate Limiting on Internal Endpoints

The `/internal/*` endpoints (contact lookup, visitor message, validate-visitor) have no rate limiting. A compromised Lambda or misconfigured worker could flood the Account API.

**Recommendation:** Add basic rate limiting at the application level (e.g., per-account request count) or at the infrastructure level (security groups, API Gateway throttling on the Lambda side).

---

## Minor Observations

### team_members.role Redundancy
`team_members` has a `role` field (`member` / `lead`). But `teams` also has a `lead_id` field. These can diverge — a user could be `role: lead` in `team_members` but not be the `lead_id` on the `teams` table. Pick one source of truth.

### labels JSONB Indexing
`conversations.labels` is `JSONB default []`. If you plan to filter conversations by label (likely), you'll need a GIN index. Not mentioned in the spec.

### Visitor Token Refresh UX
The visitor token refresh flow (Section 06 WebSocket Lifecycle) requires a ~300ms WebSocket reconnection. During this window, messages are lost. For webchat, this is acceptable (sessions are short). But document it so the widget team knows to queue outbound messages during reconnection.

### Local Development Without AWS
The architecture requires AWS API Gateway WebSocket, Lambda, and DynamoDB. Local development needs either:
- LocalStack (emulates AWS services) — works but imperfect
- A shared dev AWS environment — simpler but costs money
- Mock mode in the codebase — requires building mock implementations

This isn't called out in the spec and will be the first question from developers.

---

## Overall Assessment

The architecture is **sound for a v1 product**. The unified inbox model, multi-config routing, and workflow documentation are above average. The main risk is the fire-and-forget push pattern (Concern 1) — fix this before implementation.

The AWS-heavy approach (API Gateway WebSocket + Lambda + DynamoDB) trades operational simplicity for vendor lock-in. For a team that's already on AWS, this is the right trade. The managed WebSocket infrastructure alone saves weeks of implementation vs. self-hosted alternatives.

The spec is implementation-ready after addressing Concerns 1-3.
