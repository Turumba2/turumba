# CONV-003: Bot Router & Agent Routing

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P1 — Depends on CONV-001 + CONV-002
**Feature Area:** Customer Support — Automated Routing
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Implement the bot-first routing system: a `BotRule` entity for configuring routing rules, a rule evaluation engine that processes inbound messages, and an agent routing algorithm that matches conversations to the best available agent based on preferences, availability, and capacity.

This is the intelligence layer — when a customer sends a message, the bot router:
1. Evaluates configured rules (keyword match, time-of-day, channel type)
2. Sends an auto-reply if configured (using channel adapters from HSM-001)
3. Routes to the best available agent by querying Agent Preferences (CONV-002) from the Account API
4. Falls back to a queue if no agent is available

**Scope:**
- `BotRule` model + full CRUD
- Rule evaluation engine (RabbitMQ consumer on `conversation.message.created`)
- Agent routing algorithm with preference matching
- Service-to-service HTTP client (Messaging API → Account API)
- Inbound message → conversation creation pipeline (RabbitMQ consumer on webhook events)

**Prerequisites:** CONV-001, CONV-002, HSM-001 (Channel Adapters), HSM-003 (Webhook Receivers)

---

## Part 1: BotRule Model

### Database Model (`src/models/postgres/bot_rule.py`)

```python
from sqlalchemy import Boolean, CheckConstraint, Column, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Index

from src.models.postgres.base import PostgresBaseModel


class BotRule(PostgresBaseModel):
    """Configurable routing rules for automated first-response and agent assignment."""

    __tablename__ = "bot_rules"
    __table_args__ = (
        CheckConstraint(
            "trigger_type IN ('keyword', 'time_based', 'channel', "
            "'new_conversation', 'fallback')",
            name="ck_bot_rules_trigger_type",
        ),
        Index("ix_bot_rules_evaluation", "account_id", "is_active", "priority"),
    )

    account_id = Column(Uuid(as_uuid=True), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    priority = Column(Integer, nullable=False, default=100)
    is_active = Column(Boolean, nullable=False, default=True)
    trigger_type = Column(String(20), nullable=False)

    conditions = Column(JSONB, nullable=False, default=dict)
    actions = Column(JSONB, nullable=False, default=dict)
```

### `conditions` Schema by Trigger Type

**`keyword`:**
```json
{
  "keywords": ["refund", "return", "cancel"],
  "match_mode": "any",
  "case_sensitive": false,
  "channels": ["whatsapp", "telegram"]
}
```
- `match_mode`: `"any"` (at least one keyword matches) or `"all"` (all must match)
- `channels`: optional — restrict rule to specific channel types
- `case_sensitive`: optional, defaults to `false`

**`time_based`:**
```json
{
  "time_range": { "start": "18:00", "end": "08:00" },
  "timezone": "Africa/Addis_Ababa",
  "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
  "channels": ["whatsapp"]
}
```
- Matches when current time (in specified timezone) falls within the range
- `start > end` means overnight range (e.g., 18:00–08:00)
- `days`: optional — restrict to specific days of week

**`channel`:**
```json
{
  "channels": ["whatsapp", "messenger"],
  "exclude_channels": ["email"]
}
```
- Matches based on which channel the message arrived on

**`new_conversation`:**
```json
{
  "only_first_message": true,
  "channels": ["telegram"]
}
```
- Fires only when a brand-new conversation is created (not on subsequent messages)
- `only_first_message`: if true, only triggers on the first message of a new conversation

**`fallback`:**
```json
{}
```
- Always matches. Used as the catch-all rule (should have lowest priority / highest priority number).

### `actions` Schema

```json
{
  "reply_template_id": "uuid-of-template",
  "reply_text": "Static reply text (used if no template_id)",
  "assign_team_id": "uuid-of-team",
  "assign_strategy": "round_robin",
  "set_labels": ["billing", "refund"],
  "set_priority": "high",
  "set_status": "bot"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `reply_template_id` | UUID | Send a template as auto-reply (uses Template entity) |
| `reply_text` | String | Send static text as auto-reply (fallback if no template) |
| `assign_team_id` | UUID | Route to a specific team |
| `assign_strategy` | String | `round_robin`, `least_busy`, `manual_queue` |
| `set_labels` | Array | Auto-apply labels to the conversation |
| `set_priority` | String | Auto-set conversation priority |
| `set_status` | String | Set conversation status (e.g., `"bot"` for bot-handled) |

### Schemas (`src/schemas/bot_rule.py`)

```python
class BotRuleCreate(BaseModel):
    name: str
    description: str | None = None
    priority: int = 100
    is_active: bool = True
    trigger_type: str
    conditions: dict
    actions: dict

class BotRuleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    priority: int | None = None
    is_active: bool | None = None
    trigger_type: str | None = None
    conditions: dict | None = None
    actions: dict | None = None

class BotRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    name: str
    description: str | None
    priority: int
    is_active: bool
    trigger_type: str
    conditions: dict
    actions: dict
    created_at: datetime
    updated_at: datetime
```

### Controller + Router

Follow standard pattern. Default filter: `account_id:in:{x-account-ids}`.

```
POST   /v1/bot-rules/
GET    /v1/bot-rules/
GET    /v1/bot-rules/{id}
PATCH  /v1/bot-rules/{id}
DELETE /v1/bot-rules/{id}
```

### FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `name` | `eq`, `contains`, `icontains` | Yes |
| `trigger_type` | `eq`, `in` | No |
| `is_active` | `eq` | No |
| `priority` | `eq`, `le`, `ge` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |

---

## Part 2: Inbound Message Worker

A RabbitMQ consumer that processes inbound webhook events and creates/updates conversations.

### Queue Configuration

```
Exchange: messaging (topic, durable)
Queue: conversation.inbound
Binding: webhook.inbound.* → conversation.inbound
```

### File: `src/workers/inbound_worker.py`

### Processing Pipeline

```python
async def process_inbound_message(event: dict):
    """
    Called when a webhook.inbound.{channel_type} event arrives.

    event payload:
    {
        "channel_id": "uuid",
        "channel_type": "telegram",
        "account_id": "uuid",
        "inbound_message": {
            "provider_message_id": "12345",
            "sender_address": "telegram_chat_id",
            "message_body": "I want a refund",
            "timestamp": "2026-02-17T10:30:00Z",
            "metadata": { ... }
        }
    }
    """

    # 1. Resolve contact
    contact_id = await resolve_contact(
        account_id=event["account_id"],
        channel_type=event["channel_type"],
        identifier=event["inbound_message"]["sender_address"],
        display_name=event["inbound_message"]["metadata"].get("from_username"),
    )

    # 2. Find or create conversation
    conversation = await find_or_create_conversation(
        account_id=event["account_id"],
        channel_id=event["channel_id"],
        contact_id=contact_id,
        contact_identifier=event["inbound_message"]["sender_address"],
    )

    # 3. Create inbound message
    message = await create_message(
        account_id=event["account_id"],
        conversation_id=conversation.id,
        channel_id=event["channel_id"],
        contact_id=contact_id,
        direction="inbound",
        sender_type="contact",
        message_body=event["inbound_message"]["message_body"],
        delivery_address=event["inbound_message"]["sender_address"],
    )

    # 4. Update conversation
    await update_conversation(
        conversation_id=conversation.id,
        last_message_at=message.created_at,
    )

    # 5. Emit event for bot router
    await emit_event("conversation.message.created", {
        "conversation_id": str(conversation.id),
        "message_id": str(message.id),
        "account_id": str(event["account_id"]),
        "channel_type": event["channel_type"],
        "is_new_conversation": conversation.was_just_created,
    })
```

### Contact Resolution (`src/services/conversation/contact_resolver.py`)

```python
async def resolve_contact(account_id, channel_type, identifier, display_name=None) -> UUID:
    """
    Find or create a contact for an inbound message.

    1. Look up ContactIdentifier by (account_id, channel_type, identifier)
    2. If found → return contact_id
    3. If not found:
       a. Call Account API to create a new contact
          POST http://gt_turumba_account_api:8000/v1/contacts/
          { "name": display_name or identifier, "metadata": {"source_channel": channel_type} }
       b. Create ContactIdentifier record locally
       c. Return new contact_id
    """
```

### Conversation Resolution (`src/services/conversation/conversation_resolver.py`)

```python
async def find_or_create_conversation(account_id, channel_id, contact_id, contact_identifier):
    """
    Find an open/active conversation for this contact+channel, or create a new one.

    1. Query: SELECT * FROM conversations
       WHERE account_id = :account_id
         AND channel_id = :channel_id
         AND contact_identifier = :contact_identifier
         AND status NOT IN ('closed', 'resolved')
       ORDER BY created_at DESC LIMIT 1

    2. If found → return existing conversation

    3. If not found → create new conversation:
       - status = 'open'
       - priority = 'normal'
       - Mark was_just_created = True (transient flag for event emission)
    """
```

---

## Part 3: Bot Router (Rule Evaluation Engine)

A RabbitMQ consumer that evaluates bot rules against new conversation messages.

### Queue Configuration

```
Exchange: messaging (topic, durable)
Queue: conversation.bot_router
Binding: conversation.message.created → conversation.bot_router
```

### File: `src/workers/bot_router.py`

### Processing Pipeline

```python
async def process_message_for_routing(event: dict):
    """
    Called when a conversation.message.created event arrives.

    Decides whether to auto-reply, route to agent, or queue.
    """
    conversation = await get_conversation(event["conversation_id"])

    # Skip if conversation already has an agent
    if conversation.status in ("assigned", "pending"):
        return

    # Load active bot rules for this account, ordered by priority
    rules = await get_active_bot_rules(conversation.account_id)

    # Load the triggering message
    message = await get_message(event["message_id"])

    # Evaluate rules in priority order
    matched_rule = None
    for rule in rules:
        if await evaluate_rule(rule, message, conversation, event):
            matched_rule = rule
            break

    if matched_rule is None:
        return  # No rules matched, conversation stays in current status

    # Execute matched rule's actions
    await execute_actions(matched_rule, conversation, message)
```

### Rule Evaluation (`src/workers/bot_router_rules.py`)

```python
async def evaluate_rule(rule: BotRule, message: Message,
                        conversation: Conversation, event: dict) -> bool:
    """Evaluate a single rule against a message and conversation context."""

    if rule.trigger_type == "keyword":
        return evaluate_keyword_rule(rule.conditions, message.message_body)

    elif rule.trigger_type == "time_based":
        return evaluate_time_rule(rule.conditions)

    elif rule.trigger_type == "channel":
        return evaluate_channel_rule(rule.conditions, event["channel_type"])

    elif rule.trigger_type == "new_conversation":
        if not event.get("is_new_conversation"):
            return False
        return evaluate_channel_rule(rule.conditions, event["channel_type"])

    elif rule.trigger_type == "fallback":
        return True  # Always matches

    return False


def evaluate_keyword_rule(conditions: dict, message_body: str) -> bool:
    keywords = conditions.get("keywords", [])
    match_mode = conditions.get("match_mode", "any")
    case_sensitive = conditions.get("case_sensitive", False)

    if not case_sensitive:
        message_body = message_body.lower()
        keywords = [k.lower() for k in keywords]

    if match_mode == "any":
        return any(kw in message_body for kw in keywords)
    elif match_mode == "all":
        return all(kw in message_body for kw in keywords)
    return False


def evaluate_time_rule(conditions: dict) -> bool:
    """Check if current time falls within the configured time range."""
    from datetime import datetime
    import zoneinfo

    tz_name = conditions.get("timezone", "UTC")
    tz = zoneinfo.ZoneInfo(tz_name)
    now = datetime.now(tz)

    # Check day filter
    days = conditions.get("days")
    if days:
        day_name = now.strftime("%a").lower()
        if day_name not in days:
            return False

    # Check time range
    time_range = conditions.get("time_range")
    if not time_range:
        return True

    start = datetime.strptime(time_range["start"], "%H:%M").time()
    end = datetime.strptime(time_range["end"], "%H:%M").time()
    current_time = now.time()

    if start <= end:
        # Normal range (e.g., 09:00 - 17:00)
        return start <= current_time <= end
    else:
        # Overnight range (e.g., 18:00 - 08:00)
        return current_time >= start or current_time <= end


def evaluate_channel_rule(conditions: dict, channel_type: str) -> bool:
    channels = conditions.get("channels", [])
    exclude = conditions.get("exclude_channels", [])

    if channel_type in exclude:
        return False
    if not channels:
        return True  # No filter = match all
    return channel_type in channels
```

### Action Execution (`src/workers/bot_router_actions.py`)

```python
async def execute_actions(rule: BotRule, conversation: Conversation, message: Message):
    """Execute the matched rule's actions."""
    actions = rule.actions
    updates = {}

    # 1. Send auto-reply
    if actions.get("reply_template_id"):
        await send_template_reply(conversation, actions["reply_template_id"])
    elif actions.get("reply_text"):
        await send_text_reply(conversation, actions["reply_text"])

    # 2. Apply labels
    if actions.get("set_labels"):
        existing = conversation.labels or []
        updates["labels"] = list(set(existing + actions["set_labels"]))

    # 3. Set priority
    if actions.get("set_priority"):
        updates["set_priority"] = actions["set_priority"]

    # 4. Set status
    if actions.get("set_status"):
        updates["status"] = actions["set_status"]

    # 5. Route to agent
    if actions.get("assign_team_id") or actions.get("assign_strategy"):
        agent = await find_best_agent(
            account_id=str(conversation.account_id),
            team_id=actions.get("assign_team_id"),
            strategy=actions.get("assign_strategy", "round_robin"),
            channel_type=get_channel_type(conversation.channel_id),
            topic=actions.get("set_labels", [None])[0],
        )
        if agent:
            updates["assignee_id"] = agent["user_id"]
            updates["status"] = "assigned"
        else:
            # No agent available — keep in queue
            updates["status"] = updates.get("status", "open")

    # 6. Apply all updates
    if updates:
        await update_conversation(conversation.id, **updates)

    # 7. Emit routing event
    await emit_event("conversation.routed", {
        "conversation_id": str(conversation.id),
        "rule_id": str(rule.id),
        "rule_name": rule.name,
        "assignee_id": updates.get("assignee_id"),
    })


async def send_text_reply(conversation: Conversation, text: str):
    """Create an outbound bot message and dispatch via channel adapter."""
    # 1. Create message record
    message = await create_message(
        account_id=str(conversation.account_id),
        conversation_id=conversation.id,
        channel_id=conversation.channel_id,
        contact_id=conversation.contact_id,
        direction="outbound",
        sender_type="bot",
        message_body=text,
        delivery_address=conversation.contact_identifier,
    )

    # 2. Dispatch via channel adapter (from HSM-001)
    adapter = get_adapter(get_channel_type(conversation.channel_id))
    credentials = await get_channel_credentials(conversation.channel_id)
    result = await adapter.send(DispatchPayload(
        message_id=message.id,
        channel_id=conversation.channel_id,
        channel_type=get_channel_type(conversation.channel_id),
        credentials=credentials,
        delivery_address=conversation.contact_identifier,
        message_body=text,
    ))

    # 3. Update message status
    status = "sent" if result.success else "failed"
    await update_message(message.id, status=status, sent_at=datetime.now(UTC))
```

---

## Part 4: Agent Routing Algorithm

### File: `src/services/conversation/agent_router.py`

```python
async def find_best_agent(
    account_id: str,
    team_id: str | None = None,
    strategy: str = "round_robin",
    channel_type: str | None = None,
    topic: str | None = None,
    language: str | None = None,
) -> dict | None:
    """
    Find the best available agent for a conversation.

    Returns agent dict with user_id, or None if no agent available.
    """

    # 1. Fetch available agents from Account API
    agents = await fetch_available_agents(account_id)

    # 2. Filter by preferences
    candidates = []
    for agent in agents:
        if not agent["is_available"]:
            continue

        # Channel preference filter
        if channel_type and agent.get("available_channels"):
            if channel_type not in agent["available_channels"]:
                continue

        # Topic preference filter
        if topic and agent.get("available_topics"):
            if topic not in agent["available_topics"]:
                continue

        # Language preference filter
        if language and agent.get("languages"):
            if language not in agent["languages"]:
                continue

        # Working hours filter
        if agent.get("available_hours"):
            if not is_within_working_hours(agent["available_hours"]):
                continue

        # Capacity filter
        active_count = await get_active_conversation_count(agent["user_id"])
        max_capacity = agent.get("max_concurrent_conversations", 5)
        if active_count >= max_capacity:
            continue

        candidates.append({
            **agent,
            "active_conversations": active_count,
        })

    if not candidates:
        return None

    # 3. Apply routing strategy
    if strategy == "round_robin":
        return select_round_robin(candidates)
    elif strategy == "least_busy":
        return select_least_busy(candidates)
    elif strategy == "manual_queue":
        return None  # Don't auto-assign, leave in queue for manual pickup
    else:
        return select_round_robin(candidates)


def select_round_robin(candidates: list[dict]) -> dict:
    """Select the agent who has been idle the longest (fairness)."""
    # Sort by: last assignment time ascending (least recently assigned first)
    # Tie-break: least active conversations
    return sorted(candidates, key=lambda a: (
        a.get("last_assigned_at", "1970-01-01"),
        a["active_conversations"],
    ))[0]


def select_least_busy(candidates: list[dict]) -> dict:
    """Select the agent with the fewest active conversations (load balance)."""
    return sorted(candidates, key=lambda a: a["active_conversations"])[0]
```

### Service-to-Service HTTP Client (`src/clients/account_api.py`)

```python
import httpx
from src.config.config import settings

ACCOUNT_API_BASE = settings.ACCOUNT_API_INTERNAL_URL  # e.g., "http://gt_turumba_account_api:8000"


async def fetch_available_agents(account_id: str) -> list[dict]:
    """
    Fetch agent preferences from the Account API.

    GET {ACCOUNT_API_BASE}/v1/agent-preferences/?filter=is_available:eq:true&limit=200
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{ACCOUNT_API_BASE}/v1/agent-preferences/",
            params={
                "filter": "is_available:eq:true",
                "limit": 200,
            },
            headers={"x-internal-service": "messaging-api"},
        )
        resp.raise_for_status()
        return resp.json().get("items", [])


async def create_contact(account_id: str, name: str, metadata: dict) -> dict:
    """
    Create a contact in the Account API.

    POST {ACCOUNT_API_BASE}/v1/contacts/
    """
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{ACCOUNT_API_BASE}/v1/contacts/",
            json={"name": name, "metadata": metadata, "account_id": account_id},
            headers={"x-internal-service": "messaging-api"},
        )
        resp.raise_for_status()
        return resp.json()
```

### New Environment Variable

Add to `src/config/config.py`:

```python
ACCOUNT_API_INTERNAL_URL: str = "http://gt_turumba_account_api:8000"
```

---

## Part 5: Gateway Routes

Add endpoint definitions for bot rules in `turumba_gateway/config/partials/endpoints/bot-rules.json`:

```
POST   /v1/bot-rules/
GET    /v1/bot-rules/
GET    /v1/bot-rules/{id}
PATCH  /v1/bot-rules/{id}
DELETE /v1/bot-rules/{id}
```

Target: `gt_turumba_messaging_api:8000`, `no-op` encoding, authentication required.

---

## Tasks

### 1. BotRule Model & CRUD
- [ ] Create `src/models/postgres/bot_rule.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas in `src/schemas/bot_rule.py`
- [ ] Create service classes in `src/services/bot_rule/`
- [ ] Create controller in `src/controllers/bot_rule.py`
- [ ] Create router in `src/routers/bot_rule.py`
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration
- [ ] Define `FilterSortConfig` and `SchemaConfig`

### 2. Service-to-Service Client
- [ ] Create `src/clients/__init__.py`
- [ ] Create `src/clients/account_api.py` with `fetch_available_agents` and `create_contact`
- [ ] Add `ACCOUNT_API_INTERNAL_URL` to `src/config/config.py`
- [ ] Add `httpx` to `requirements.txt` (if not already present)
- [ ] Handle connection errors gracefully (retry with backoff, circuit breaker)

### 3. Inbound Message Worker
- [ ] Create `src/workers/inbound_worker.py`
- [ ] Implement contact resolution logic (`resolve_contact`)
- [ ] Implement conversation resolution logic (`find_or_create_conversation`)
- [ ] Create inbound message record with correct `sender_type` and `direction`
- [ ] Update `conversation.last_message_at`
- [ ] Emit `conversation.message.created` event
- [ ] Configure RabbitMQ queue binding: `webhook.inbound.*` → `conversation.inbound`

### 4. Bot Router Worker
- [ ] Create `src/workers/bot_router.py`
- [ ] Create `src/workers/bot_router_rules.py` — rule evaluation functions
- [ ] Create `src/workers/bot_router_actions.py` — action execution functions
- [ ] Implement `evaluate_keyword_rule` with `any`/`all` match modes
- [ ] Implement `evaluate_time_rule` with timezone-aware time ranges (including overnight)
- [ ] Implement `evaluate_channel_rule` with include/exclude
- [ ] Implement `evaluate_new_conversation_rule`
- [ ] Implement `evaluate_fallback_rule` (always matches)
- [ ] Priority-ordered rule evaluation (lower number = higher priority)
- [ ] Skip routing if conversation status is already `assigned` or `pending`
- [ ] Configure RabbitMQ queue binding: `conversation.message.created` → `conversation.bot_router`

### 5. Agent Routing Algorithm
- [ ] Create `src/services/conversation/agent_router.py`
- [ ] Implement `find_best_agent` with preference filtering
- [ ] Implement `select_round_robin` strategy
- [ ] Implement `select_least_busy` strategy
- [ ] Implement `manual_queue` strategy (return None)
- [ ] Channel preference filtering
- [ ] Topic preference filtering
- [ ] Language preference filtering
- [ ] Working hours filtering (timezone-aware)
- [ ] Capacity filtering (`active_conversations < max_concurrent_conversations`)
- [ ] `get_active_conversation_count` query (count conversations where `assignee_id = user_id AND status IN ('assigned', 'pending')`)

### 6. Action Execution
- [ ] Auto-reply with template (load template, render, dispatch via adapter)
- [ ] Auto-reply with static text (dispatch via adapter)
- [ ] Auto-label conversations
- [ ] Auto-set priority
- [ ] Auto-set status
- [ ] Agent assignment with conversation status update
- [ ] Emit `conversation.routed` and `conversation.assigned` events

### 7. Gateway Routes
- [ ] Create `config/partials/endpoints/bot-rules.json` in turumba_gateway
- [ ] Import in `config/krakend.tmpl`

### 8. Tests

**BotRule CRUD:**
- [ ] Create bot rule (all trigger types)
- [ ] List with filters (trigger_type, is_active, name search)
- [ ] Update rule
- [ ] Delete rule
- [ ] Account scoping

**Rule Evaluation:**
- [ ] Keyword rule: `any` mode matches when one keyword found
- [ ] Keyword rule: `all` mode fails when not all keywords found
- [ ] Keyword rule: case insensitive by default
- [ ] Keyword rule: channel filter restricts matching
- [ ] Time rule: matches within business hours
- [ ] Time rule: matches overnight range (18:00–08:00)
- [ ] Time rule: respects timezone
- [ ] Time rule: respects day filter
- [ ] Channel rule: matches correct channel type
- [ ] Channel rule: exclude_channels works
- [ ] New conversation rule: fires only on new conversations
- [ ] Fallback rule: always matches
- [ ] Priority ordering: lower priority number evaluated first
- [ ] First matching rule wins (subsequent rules skipped)
- [ ] Already-assigned conversations skip routing

**Agent Routing:**
- [ ] Round-robin: selects least recently assigned agent
- [ ] Least-busy: selects agent with fewest active conversations
- [ ] Channel preference filter excludes non-matching agents
- [ ] Topic preference filter works
- [ ] Working hours filter respects timezone
- [ ] Capacity filter: full agents excluded
- [ ] No available agent → returns None
- [ ] Manual queue strategy → returns None

**Inbound Worker:**
- [ ] New contact created when not found
- [ ] Existing contact resolved by identifier
- [ ] New conversation created for unknown contact+channel
- [ ] Existing conversation reused for known contact+channel
- [ ] Resolved conversation reopened on new message
- [ ] Message created with correct direction and sender_type
- [ ] conversation.last_message_at updated

---

## Acceptance Criteria

- [ ] `bot_rules` table created via Alembic migration
- [ ] Full CRUD endpoints at `/v1/bot-rules/` with filtering and sorting
- [ ] Inbound worker processes webhook events and creates conversations
- [ ] Contact resolution works (find existing or create new via Account API)
- [ ] Bot router evaluates rules in priority order on each new message
- [ ] Keyword matching works with `any`/`all` modes
- [ ] Time-based routing works with timezone support and overnight ranges
- [ ] Channel-based routing filters correctly
- [ ] Fallback rule catches unmatched conversations
- [ ] Auto-reply dispatched via channel adapter
- [ ] Agent routing respects availability, channels, topics, hours, capacity
- [ ] Round-robin and least-busy strategies work correctly
- [ ] Conversations routed to queue when no agent available
- [ ] Events emitted: `conversation.routed`, `conversation.assigned`
- [ ] Gateway routes configured for bot rules
- [ ] All tests passing, Ruff clean, coverage threshold met

---

## Dependencies

- **CONV-001** — Conversation, ContactIdentifier, and Message models must exist
- **CONV-002** — AgentPreference must be queryable in Account API
- **HSM-001** — Channel Adapter Framework for dispatching auto-replies
- **HSM-003** — Webhook Receivers for producing `webhook.inbound.*` events

## Blocks

- Frontend conversation inbox (needs routing to populate the inbox)
- **CONV-004** (Real-Time Service) — consumes routing events for push notifications
