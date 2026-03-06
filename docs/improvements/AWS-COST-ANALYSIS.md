# AWS Cost Analysis — Turumba Realtime Messaging

Pricing implications of the architecture defined in `TURUMBA_REALTIME_MESSAGING.md`. All prices use **us-east-1** rates as of early 2025. Actual costs vary by region.

---

## AWS Services Used by This Design

| Service | Role in Architecture |
|---------|---------------------|
| API Gateway WebSocket | Agent + visitor WebSocket connections |
| Lambda | $connect, $disconnect, $default, ws-subscribe, ws-typing, ws-presence, ws-visitor-message (7 functions) |
| DynamoDB | ws_connections, ws_subscriptions, ws_presence (3 tables) |
| API Gateway @connections (POST) | Push messages to connected clients |
| NAT Gateway (if Lambda in VPC) | Lambda → Messaging API connectivity |

**Not included:** RabbitMQ, PostgreSQL, ECS/EC2 for Messaging API — these exist regardless of the realtime feature.

---

## Pricing Breakdown by Component

### 1. API Gateway WebSocket

| Item | Rate |
|------|------|
| Connection minutes | $0.25 per million connection-minutes |
| Messages (sent + received) | $1.00 per million messages |
| @connections POST (server → client push) | $1.00 per million |

**How it accumulates:**

For each connected agent:
- 1 connection, held for ~8 hours/day = 480 connection-minutes/day
- Receives inbox updates, typing indicators, presence events
- Typical: ~500 received messages/day (busy agent)

For each visitor:
- 1 connection, held for ~10 minutes average
- Sends ~5 messages, receives ~5 messages + typing indicators

### 2. Lambda

| Item | Rate |
|------|------|
| Requests | $0.20 per million requests |
| Duration | $0.0000166667 per GB-second (128MB = $0.0000020833/s) |
| Free tier | 1M requests + 400,000 GB-seconds/month |

Typical invocation: 128MB, ~50ms execution = $0.000000104 per invocation.

### 3. DynamoDB (On-Demand)

| Item | Rate |
|------|------|
| Write request units (WRU) | $1.25 per million |
| Read request units (RRU) | $0.25 per million |
| Storage | $0.25 per GB/month |
| TTL deletes | Free |

Each WebSocket action generates 1-3 DynamoDB operations. Storage is negligible (connection state is ephemeral).

### 4. NAT Gateway (if Lambda in VPC)

| Item | Rate |
|------|------|
| Hourly charge | $0.045/hour = $32.40/month |
| Data processing | $0.045 per GB |

**This is the hidden cost bomb.** A single NAT Gateway costs ~$32/month just existing, and you need one per AZ for high availability (2 AZs = $65/month, 3 AZs = $97/month).

---

## Cost Scenarios

### Scenario 1: Small Team (5 agents, 50 conversations/day)

```
Assumptions:
- 5 agents connected 8 hours/day, 22 working days/month
- 50 conversations/day, avg 10 messages each = 500 messages/day
- 30 visitors/day, avg 10 min session, 5 messages each
- All visitors are unique sessions

Monthly calculations:

API Gateway WebSocket:
  Agent connection-minutes: 5 agents x 480 min x 22 days = 52,800
  Visitor connection-minutes: 30 visitors x 10 min x 22 days = 6,600
  Total connection-minutes: 59,400
  Cost: 59,400 / 1,000,000 x $0.25 = $0.01

  Messages (WS frames in + out):
    Agent: typing, subscribe, presence, receive pushes ~500/day x 5 x 22 = 55,000
    Visitor: send + receive ~10/session x 30 x 22 = 6,600
    Server push (@connections POST): ~500 messages x 5 agents x 22 = 55,000
    Total: ~116,600
  Cost: 116,600 / 1,000,000 x $1.00 = $0.12

Lambda:
  Invocations: connect/disconnect/message/typing/subscribe
    ~20 invocations per visitor session x 30 x 22 = 13,200
    ~50 invocations per agent per day x 5 x 22 = 5,500
    Total: ~18,700
  Cost: Free tier covers this entirely

DynamoDB:
  Writes: connection store, subscription updates, presence
    ~10 writes per visitor session x 30 x 22 = 6,600
    ~20 writes per agent per day x 5 x 22 = 2,200
    Total: ~8,800 WRU
  Reads: push_to_room subscriber lookups
    ~5 reads per message push x 500 x 22 = 55,000
    Total: ~55,000 RRU
  Cost: $0.01 (writes) + $0.01 (reads) = $0.02

NAT Gateway (if Lambda in VPC):
  $32.40/month (single AZ) or $64.80/month (2 AZs)

TOTAL (without NAT Gateway): ~$0.15/month
TOTAL (with NAT Gateway, 2 AZs): ~$65/month
```

**Verdict:** At small scale, the AWS realtime services cost almost nothing. The NAT Gateway (if needed) dominates the bill by 400x.

---

### Scenario 2: Medium Team (20 agents, 500 conversations/day)

```
Assumptions:
- 20 agents, 8 hours/day, 22 days/month
- 500 conversations/day, avg 12 messages each
- 200 visitor sessions/day, avg 15 min, 8 messages each

Monthly calculations:

API Gateway WebSocket:
  Connection-minutes: (20 x 480 x 22) + (200 x 15 x 22) = 211,200 + 66,000 = 277,200
  Cost: $0.07

  Messages + @connections POST:
    Agent inbound: ~2,000/day x 20 x 22 = 880,000
    Visitor: ~16/session x 200 x 22 = 70,400
    Server push: ~6,000 messages/day x avg 3 recipients x 22 = 396,000
    Total: ~1,346,400
  Cost: $1.35

Lambda:
  Invocations: ~100,000/month
  Cost: Free tier (1M free)

DynamoDB:
  Writes: ~60,000 WRU/month
  Reads: ~500,000 RRU/month
  Cost: $0.08 + $0.13 = $0.21

NAT Gateway: $64.80/month (2 AZs)

TOTAL (without NAT Gateway): ~$1.63/month
TOTAL (with NAT Gateway): ~$66/month
```

---

### Scenario 3: Large Scale (100 agents, 5,000 conversations/day)

```
Assumptions:
- 100 agents, 8 hours/day, 22 days/month
- 5,000 conversations/day, avg 15 messages each
- 2,000 visitor sessions/day, avg 20 min, 10 messages each
- Multiple concurrent conversations per agent

Monthly calculations:

API Gateway WebSocket:
  Connection-minutes: (100 x 480 x 22) + (2,000 x 20 x 22) = 1,056,000 + 880,000 = 1,936,000
  Cost: $0.48

  Messages + @connections POST:
    Agent: ~10,000/day x 100 x 22 = 22,000,000
    Visitor: ~20/session x 2,000 x 22 = 880,000
    Server push: 75,000 messages/day x avg 5 recipients x 22 = 8,250,000
    Total: ~31,130,000
  Cost: $31.13

Lambda:
  Invocations: ~2,000,000/month
  Duration: 2M x 50ms x 128MB = 12,800 GB-seconds
  Cost: $0.20 (requests after free tier) + $0.21 (duration) = $0.41

DynamoDB:
  Writes: ~500,000 WRU/month
  Reads: ~5,000,000 RRU/month
  Cost: $0.63 + $1.25 = $1.88

NAT Gateway: $64.80 + ~$5 data processing = ~$70/month

TOTAL (without NAT Gateway): ~$34/month
TOTAL (with NAT Gateway): ~$104/month
```

---

### Scenario 4: High Scale (500 agents, 50,000 conversations/day)

```
Assumptions:
- 500 agents across multiple shifts (300 concurrent)
- 50,000 conversations/day, avg 15 messages each
- 10,000 visitor sessions/day
- Fan-out: each message pushed to avg 8 connections (team members + subscriber agents)

Monthly calculations:

API Gateway WebSocket:
  Connection-minutes: ~15,000,000
  Cost: $3.75

  Messages + @connections POST: ~300,000,000
  Cost: $300

Lambda:
  Invocations: ~15,000,000
  Cost: $2.80 (requests) + $3.13 (duration) = $5.93

DynamoDB:
  Writes: ~5,000,000 WRU
  Reads: ~50,000,000 RRU
  Cost: $6.25 + $12.50 = $18.75

NAT Gateway: $70/month

TOTAL (without NAT Gateway): ~$329/month
TOTAL (with NAT Gateway): ~$399/month
```

---

## Cost Summary Table

| Scale | Agents | Convos/day | AWS Realtime Cost/month | With NAT Gateway |
|-------|--------|------------|------------------------|------------------|
| Small | 5 | 50 | **$0.15** | **$65** |
| Medium | 20 | 500 | **$1.63** | **$66** |
| Large | 100 | 5,000 | **$34** | **$104** |
| High | 500 | 50,000 | **$329** | **$399** |

---

## Key Insights

### 1. The NAT Gateway is the Biggest Cost at Small/Medium Scale

At small scale, the NAT Gateway costs 400x more than all other AWS services combined. This is why the Lambda connectivity decision (see `RECOMMENDATIONS.md` Priority 2) matters financially:

| Connectivity Option | Monthly Cost Impact |
|--------------------|-------------------|
| Lambda in VPC + NAT Gateway | +$65-97/month fixed |
| Lambda calls public ALB (no VPC) | +$16-22/month (ALB hourly) |
| Lambda calls public KrakenD | +$0 (already running) |

**Recommendation:** Avoid NAT Gateway if possible. Use an internal ALB or route through KrakenD with a service API key.

### 2. Message Fan-Out Drives Cost at Scale

The dominant cost at high scale is `@connections POST` (server pushing to clients). Each message is pushed to every agent viewing the conversation + every agent's inbox update. With 500 agents and 50,000 conversations/day, that's 300M API Gateway messages/month.

**Mitigation strategies:**
- **Selective inbox updates** — Only push to agents whose inbox filter matches (e.g., team-scoped agents only get their team's conversations). Reduces fan-out by ~60-80%.
- **Batch push** — Aggregate multiple events into a single WebSocket frame (e.g., 5 inbox updates in 1 frame instead of 5 separate pushes). Reduces message count proportionally.
- **Presence-based push** — Only push to agents who are currently online. Skip offline agents entirely (they'll fetch on reconnect).

### 3. DynamoDB is Surprisingly Cheap

Connection state in DynamoDB is ephemeral (TTL auto-deletes) and small (< 1KB per item). Even at 500 agents and 50,000 conversations/day, DynamoDB costs under $20/month. On-demand pricing works well here because the traffic pattern is bursty.

### 4. Lambda Free Tier Covers Most Scenarios

Up to ~1,000 conversations/day, Lambda stays within the free tier (1M requests/month). Even at 50,000 conversations/day, Lambda costs < $6/month.

### 5. Comparison: Self-Hosted WebSocket Alternative

If you ran WebSocket connections on your own ECS/EC2 instances instead of API Gateway:

| Item | Self-Hosted | API Gateway |
|------|-------------|-------------|
| Infrastructure | ECS task ($30-100/month for sticky sessions + ALB) | Pay-per-use |
| Scaling | Manual (ALB + auto-scaling groups) | Automatic |
| Connection management | Code it yourself (heartbeats, reconnection, load balancing) | Managed |
| DynamoDB | Still need it or Redis for connection state | Built-in |
| Development time | 2-4 weeks additional | 0 (managed) |

**At < 100 agents, API Gateway is cheaper and simpler.** At > 500 agents with high fan-out, self-hosted becomes competitive on cost but adds operational complexity.

---

## Monthly Cost by Component (Visual)

```
Small (5 agents, 50 convos/day):
  API GW Messages  ████ $0.12
  API GW Connect   █ $0.01
  DynamoDB         █ $0.02
  Lambda           free
  ─────────────────────────
  NAT Gateway      ████████████████████████████████████████████████ $65.00

Large (100 agents, 5K convos/day):
  API GW Messages  ████████████████████████████████ $31.13
  API GW Connect   █ $0.48
  DynamoDB         ██ $1.88
  Lambda           █ $0.41
  ─────────────────────────
  NAT Gateway      █████████████████████████████████████████████████████████████████████ $70.00
```

The NAT Gateway cost is disproportionate at every scale. Avoid it.

---

## Recommendations

1. **Avoid NAT Gateway** — Use ALB or KrakenD for Lambda → Messaging API connectivity
2. **Start with DynamoDB on-demand** — Switch to provisioned capacity only if you exceed 50,000 convos/day and want predictable pricing
3. **Implement selective fan-out early** — Don't push inbox updates to all 500 agents when only 20 are on the relevant team
4. **Monitor @connections POST volume** — This is your primary cost driver at scale. Set up CloudWatch billing alarms at $50, $100, $200/month thresholds
5. **The free tier covers your first year** — Lambda free tier (1M requests) + API Gateway free tier (1M messages for first 12 months) means the realtime feature is essentially free during development and early launch
