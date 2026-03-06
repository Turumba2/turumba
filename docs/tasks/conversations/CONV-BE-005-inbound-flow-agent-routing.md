# CONV-BE-005: Inbound Conversation Flow + Agent Routing

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P1 — Wires everything together for the conversation pipeline
**Phase:** 2 — Bot Router + Agent Routing
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md) §6, §7, §10

---

## Summary

Modify the existing `inbound_message_worker` to create/resume conversations from inbound messages, create a new `bot_router_worker` that evaluates bot rules and routes conversations to agents, and implement the agent routing algorithm that queries the Account API for eligible agents.

This task wires together CONV-BE-001 (models), CONV-BE-002 (message extensions), CONV-BE-003 (agent preferences), and CONV-BE-004 (bot rules) into a working end-to-end inbound flow.

---

## Part 1: Modify inbound_message_worker

### Current Behavior
The existing `inbound_message_worker` creates a `Message` record from inbound webhook events.

### New Behavior
After creating the message, the worker must also:

1. **Resolve contact** via `ContactIdentifier`:
   - Lookup by `(account_id, channel_type, identifier)` where identifier is the sender's platform ID (phone number, telegram user_id, etc.)
   - If found → use the `contact_id`
   - If not found → call Account API to create a contact, then create a `ContactIdentifier`

2. **Find or create conversation**:
   - Query for an open conversation matching `(account_id, channel_id, contact_identifier)` where status NOT IN (`closed`, `resolved`)
   - If found → use existing conversation
   - If not found → create new `Conversation` with `status = "open"`
   - If found with `status = "resolved"` → reopen (set `status = "open"`)

3. **Link message to conversation**:
   - Set `message.conversation_id = conversation.id`
   - Set `message.sender_type = "contact"`
   - Set `message.sender_id = contact_id`

4. **Update conversation timestamps**:
   - Set `conversation.last_message_at = now()`

5. **Emit event**:
   - `conversation.message.created` via outbox
   - If new conversation: also emit `conversation.created`

---

## Part 2: Bot Router Worker

### New Worker: `src/workers/bot_router_worker.py`

A RabbitMQ consumer that processes conversation events and applies bot rules.

```
Consumes from: "bot_routing" queue
Bindings:
  - conversation.created
  - conversation.message.created (only for inbound messages, sender_type = "contact")

For each event:
  1. Load conversation from DB
  2. Skip if conversation.status is "assigned" or "pending" (already handled by agent)
  3. Load active BotRules for account (ordered by priority)
  4. Build InboundContext from message + conversation
  5. Call evaluate_rules(context, rules) → EvaluationResult
  6. Execute matched actions:
     a. reply_text / reply_template_id → create outbound Message (sender_type: bot) + dispatch
     b. set_labels → update conversation.labels
     c. set_priority → update conversation.priority
     d. assign_team_id + assign_strategy → call agent routing algorithm
  7. Emit events: conversation.routed, conversation.assigned (if agent found)
  8. ACK message
```

### RabbitMQ Topology

Add new queue `bot_routing` on the `messaging` exchange with bindings:
- `conversation.created`
- `conversation.message.created`

---

## Part 3: Agent Routing Algorithm

### Location: `src/services/conversation/routing.py`

```python
async def find_best_agent(
    account_id: str,
    channel_type: str,
    labels: list[str],
    account_api_client: AccountApiClient,
) -> str | None:
    """Find the best available agent for a conversation."""

    # 1. Fetch eligible agent preferences from Account API
    preferences = await account_api_client.get_agent_preferences(
        is_available=True,
        available_channels=channel_type,
        available_topics=labels,
    )

    # 2. Filter by working hours (respect timezone)
    now = datetime.now(UTC)
    eligible = [p for p in preferences if _is_within_hours(p, now)]

    # 3. Filter by capacity (active_conversations < max_concurrent)
    # Note: active conversation count comes from local DB
    for agent in eligible:
        agent.active_count = await _count_active_conversations(agent.user_id)
    eligible = [a for a in eligible if a.active_count < a.max_concurrent_conversations]

    # 4. Sort: least active conversations first, then longest idle
    eligible.sort(key=lambda a: (a.active_count, a.last_seen))

    # 5. Return top candidate or None
    return eligible[0].user_id if eligible else None
```

---

## Part 4: Service-to-Service HTTP Client

### Extend `src/clients/account_api.py`

Add methods to the existing `AccountApiClient`:

```python
async def get_agent_preferences(
    self,
    is_available: bool | None = None,
    available_channels: str | None = None,
    available_topics: list[str] | None = None,
) -> list[AgentPreferenceData]:
    """Fetch agent preferences from Account API for routing."""
    params = {}
    filters = []
    if is_available is not None:
        filters.append(f"is_available:eq:{is_available}")
    if available_channels:
        filters.append(f"available_channels:contains:{available_channels}")
    # ... build filter string
    response = await self._get("/v1/agent-preferences", params=params)
    return [AgentPreferenceData(**item) for item in response["data"]]

async def create_contact(self, account_id: str, data: dict) -> dict:
    """Create a contact in Account API from inbound message sender info."""
    response = await self._post("/v1/contacts", json=data)
    return response["data"]
```

Uses Docker network DNS: `http://gt_turumba_account_api:8000` (internal, not through gateway).

---

## Tasks

### Inbound Worker Modifications
- [ ] Add ContactIdentifier lookup/creation logic to `inbound_message_worker`
- [ ] Add conversation find-or-create logic
- [ ] Link inbound messages to conversations (set conversation_id, sender_type, sender_id)
- [ ] Update conversation.last_message_at on each inbound message
- [ ] Handle conversation reopening (resolved → open on new inbound message)
- [ ] Emit conversation.created and conversation.message.created events

### Bot Router Worker
- [ ] Create `src/workers/bot_router_worker.py`
- [ ] Add `bot_routing` queue to RabbitMQ topology
- [ ] Consume conversation.created and conversation.message.created events
- [ ] Skip routing for conversations already assigned/pending
- [ ] Integrate rule evaluation engine from CONV-BE-004
- [ ] Execute actions: auto-reply (text or template), set labels, set priority
- [ ] Execute actions: find and assign agent via routing algorithm
- [ ] Emit conversation.routed and conversation.assigned events
- [ ] Add Dockerfile/docker-compose entry for the worker

### Agent Routing
- [ ] Create `src/services/conversation/routing.py`
- [ ] Implement agent preference filtering (availability, channels, topics)
- [ ] Implement working hours check with timezone support
- [ ] Implement capacity check (active conversations vs max concurrent)
- [ ] Implement sorting (least active, then longest idle)

### Account API Client
- [ ] Add `get_agent_preferences()` method to `AccountApiClient`
- [ ] Add `create_contact()` method to `AccountApiClient`
- [ ] Handle errors gracefully (timeouts, service unavailable)

---

## Tests

- [ ] Inbound message creates conversation when none exists
- [ ] Inbound message appends to existing open conversation
- [ ] Inbound message reopens resolved conversation
- [ ] ContactIdentifier is created for new platform contacts
- [ ] ContactIdentifier is reused for returning contacts
- [ ] Bot router matches keyword rule → auto-reply + assign
- [ ] Bot router matches time-based rule → offline reply
- [ ] Bot router skips already-assigned conversations
- [ ] Bot router fallback rule matches when nothing else does
- [ ] Agent routing: filters by availability, channels, topics
- [ ] Agent routing: respects working hours with timezone
- [ ] Agent routing: respects capacity limits
- [ ] Agent routing: returns None when no agents available
- [ ] Agent routing: round-robin fairness (least active first)

---

## Acceptance Criteria

- [ ] Inbound webhook messages automatically create/resume conversations
- [ ] ContactIdentifier resolution works for all channel types
- [ ] Bot rules evaluate correctly and execute all action types
- [ ] Agent routing finds the best available agent based on preferences
- [ ] Service-to-service HTTP calls to Account API work reliably
- [ ] End-to-end flow: inbound message → conversation → bot → agent assignment
- [ ] All tests passing, Ruff clean

---

## Dependencies

- **CONV-BE-001** — Conversation, ContactIdentifier models
- **CONV-BE-002** — Message extensions (conversation_id, sender_type)
- **CONV-BE-003** — Agent preferences (Account API)
- **CONV-BE-004** — BotRule model + evaluation engine

## Blocks

- **CONV-BE-006** (Realtime Push Worker) — events emitted here are consumed by push worker
