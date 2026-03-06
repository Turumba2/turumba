# Prioritized Recommendations — Before Implementation

Action items to address before starting implementation of the Turumba Realtime Messaging feature, ordered by impact.

---

## Priority 1: Fix the Persistence Model (Concern 1)

**Change:** Agent reply flow persists to DB first, then pushes via WebSocket.

**Current (dangerous):**
```
POST /messages → push_to_room() → return 202 → background persist
```

**Proposed (safe):**
```
POST /messages → DB insert + commit → push_to_room() → return 201 with message object
```

**Impact:**
- Adds ~30-50ms to the agent reply response time (DB round-trip)
- Eliminates the entire class of "phantom message" bugs
- Changes response from 202 to 201, response body includes the persisted message
- Client-side optimistic rendering still works — just reconcile with the 201 response instead of a background event

**Files to update:**
- `TURUMBA_REALTIME_MESSAGING.md` Section 5.2, Section 8.4
- `docs/realtime/03-AGENT-REPLY-FLOW.md`

---

## Priority 2: Resolve Lambda Connectivity (Concern 2)

**Decision needed:** How do Lambda functions reach the Messaging API?

| Option | Latency | Complexity | Security |
|--------|---------|------------|----------|
| Lambda in VPC + private DNS | +1-5s cold start | High (NAT Gateway, VPC config) | Best (private network) |
| Lambda calls public KrakenD + service API key | +5-10ms (gateway hop) | Low | Medium (API key management) |
| Lambda calls ALB/NLB internal endpoint | +2-5ms | Medium (load balancer setup) | Good (security groups) |

**Recommendation:** Option 3 (internal ALB). Put the Messaging API behind an internal Application Load Balancer. Lambda calls the ALB DNS name. No VPC attachment needed for Lambda (avoids cold start penalty). Security groups restrict ALB to Lambda's security group only.

**Files to update:**
- `TURUMBA_REALTIME_MESSAGING.md` Section 2.3
- `docs/realtime/02-VISITOR-CHAT-FLOW.md`
- New: infrastructure diagram showing ALB placement

---

## Priority 3: Separate the Push Worker Deployment (Concern 3)

**Change:** Deploy `realtime_push_worker` as its own container/service, not co-located with the Messaging API web server.

**Why:** Different scaling profiles. The REST API scales with HTTP request volume. The push worker scales with message volume x subscribers. Under load, they compete for resources.

**Implementation:**
- Already structured as a standalone worker (`src/workers/realtime_push_worker.py`)
- Just needs its own Dockerfile/docker-compose service entry
- Shares the same codebase, same DB connection, same RabbitMQ connection
- Can scale horizontally (multiple push worker instances consuming from the same queue)

**Files to update:**
- `docker-compose.yml` — add `realtime_push_worker` service
- `TURUMBA_REALTIME_MESSAGING.md` Section 2.2

---

## Priority 4: Add Config Conflict Detection (Concern 6)

**Change:** On `conversation_configs` create/update, check if any `enabled_channels` or `enabled_chat_endpoints` UUIDs already appear in another active config for the same account.

**Behavior:**
- Not a hard error — allow the save
- Return a warning in the response: `"warnings": ["Channel 'Telegram' is also targeted by config 'VIP Support' (priority 1). That config will match first."]`
- Frontend can display this warning to the admin

**Implementation:** Simple query at save time — `SELECT name, priority FROM conversation_configs WHERE account_id = ? AND is_active = true AND (enabled_channels && ? OR enabled_chat_endpoints && ?)` using PostgreSQL array overlap operator.

---

## Priority 5: Document Local Development Strategy

**Change:** Add a `docs/realtime/LOCAL-DEV.md` explaining how developers work with the AWS-dependent components locally.

**Options to document:**
1. **LocalStack** for API Gateway WebSocket + DynamoDB emulation
2. **Shared dev AWS account** with isolated stages
3. **Mock mode** — environment variable that swaps `push_to_room()` for a no-op logger and uses in-memory dicts instead of DynamoDB

Recommendation: Start with option 3 (mock mode) for fast iteration, graduate to option 2 for integration testing.

---

## Implementation Order

```
1. Fix persistence model          — 1 day (spec change + update workflow docs)
2. Resolve Lambda connectivity    — 1 day (architecture decision + document)
3. Separate push worker           — 0.5 day (docker-compose change)
4. Config conflict detection      — during CONV-BE-003 implementation
5. Local dev documentation        — during first sprint setup
```

Total spec changes: ~2.5 days before implementation begins.
