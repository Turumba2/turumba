# CONV-BE-004: BotRule Model + Rule Evaluation Engine

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P1 — Required for automated conversation routing
**Phase:** 2 — Bot Router + Agent Routing
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md) §3.5, §6

---

## Summary

Implement the `BotRule` model with full CRUD and a rule evaluation engine that matches inbound messages against configurable rules (keyword, time-based, channel, fallback). Rules are evaluated in priority order and produce actions (auto-reply, assign team, set labels/priority). This is the data + evaluation layer — the actual worker that consumes inbound events and applies rules is in CONV-BE-005.

---

## Part 1: BotRule Model

### Database Model (`src/models/postgres/bot_rule.py`)

```python
from sqlalchemy import Boolean, CheckConstraint, Column, Index, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB

from src.models.postgres.base import PostgresBaseModel


class BotRule(PostgresBaseModel):
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
    priority = Column(Integer, nullable=False, default=100)
    is_active = Column(Boolean, nullable=False, default=True)
    trigger_type = Column(String(30), nullable=False)
    conditions = Column(JSONB, nullable=False, default=dict)
    actions = Column(JSONB, nullable=False, default=dict)
    metadata_ = Column("metadata", JSONB, nullable=True, default=dict)
```

### Conditions Schema

```json
{
  "keywords": ["refund", "return", "cancel"],
  "match_mode": "any",
  "channels": ["whatsapp", "telegram"],
  "time_range": {
    "start": "18:00",
    "end": "08:00",
    "tz": "Africa/Addis_Ababa"
  }
}
```

### Actions Schema

```json
{
  "reply_template_id": "uuid",
  "reply_text": "We're offline right now...",
  "assign_team_id": "uuid",
  "assign_strategy": "round_robin",
  "set_labels": ["billing"],
  "set_priority": "high"
}
```

### Schemas, Controller, Router

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
| `priority` | `eq`, `ge`, `le` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |

---

## Part 2: Rule Evaluation Engine

### Location: `src/services/bot_rule/evaluation.py`

A pure function that takes an inbound message context and an ordered list of bot rules, and returns the first matching rule's actions.

```python
@dataclass
class InboundContext:
    message_body: str
    channel_type: str
    account_id: str
    conversation_status: str
    timestamp: datetime

@dataclass
class EvaluationResult:
    matched_rule: BotRule | None
    actions: dict  # The actions from the matched rule

def evaluate_rules(context: InboundContext, rules: list[BotRule]) -> EvaluationResult:
    """Evaluate rules in priority order, return first match."""
    for rule in rules:
        if _matches(context, rule):
            return EvaluationResult(matched_rule=rule, actions=rule.actions)
    return EvaluationResult(matched_rule=None, actions={})
```

### Matcher Functions

```python
def _matches(context: InboundContext, rule: BotRule) -> bool:
    """Check if a rule matches the inbound context."""
    conditions = rule.conditions

    match rule.trigger_type:
        case "keyword":
            return _match_keywords(context.message_body, conditions)
        case "time_based":
            return _match_time(context.timestamp, conditions)
        case "channel":
            return _match_channel(context.channel_type, conditions)
        case "new_conversation":
            return context.conversation_status == "open"
        case "fallback":
            return True  # Always matches
        case _:
            return False

def _match_keywords(message_body: str, conditions: dict) -> bool:
    keywords = conditions.get("keywords", [])
    match_mode = conditions.get("match_mode", "any")
    body_lower = message_body.lower()

    if match_mode == "all":
        return all(kw.lower() in body_lower for kw in keywords)
    return any(kw.lower() in body_lower for kw in keywords)

def _match_time(timestamp: datetime, conditions: dict) -> bool:
    time_range = conditions.get("time_range")
    if not time_range:
        return False
    tz = ZoneInfo(time_range.get("tz", "UTC"))
    local_time = timestamp.astimezone(tz).time()
    start = time.fromisoformat(time_range["start"])
    end = time.fromisoformat(time_range["end"])
    # Handle overnight ranges (e.g., 18:00-08:00)
    if start > end:
        return local_time >= start or local_time <= end
    return start <= local_time <= end

def _match_channel(channel_type: str, conditions: dict) -> bool:
    channels = conditions.get("channels", [])
    return channel_type in channels if channels else True
```

---

## Tasks

- [ ] Create `src/models/postgres/bot_rule.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create schemas in `src/schemas/bot_rule.py`
- [ ] Create service, controller, router (standard CRUD pattern)
- [ ] Register router in `src/main.py`
- [ ] Create Alembic migration
- [ ] Create `src/services/bot_rule/evaluation.py` with rule evaluation engine
- [ ] Implement keyword matching (any/all modes)
- [ ] Implement time-based matching (with timezone, overnight ranges)
- [ ] Implement channel matching
- [ ] Implement new_conversation and fallback trigger types

---

## Tests

- [ ] BotRule CRUD: create, list, get, update, delete
- [ ] BotRule: filter by trigger_type, is_active
- [ ] BotRule: account scoping via `x-account-ids`
- [ ] Evaluation: keyword "any" mode — matches if any keyword found
- [ ] Evaluation: keyword "all" mode — matches only if all keywords found
- [ ] Evaluation: keyword matching is case-insensitive
- [ ] Evaluation: time-based — inside business hours → no match
- [ ] Evaluation: time-based — outside business hours → match
- [ ] Evaluation: time-based — overnight range (18:00-08:00) works correctly
- [ ] Evaluation: channel filter — matches when channel in list
- [ ] Evaluation: channel filter — no match when channel not in list
- [ ] Evaluation: new_conversation — matches only "open" status
- [ ] Evaluation: fallback — always matches
- [ ] Evaluation: priority order — first matching rule wins
- [ ] Evaluation: no rules match → empty actions returned

---

## Acceptance Criteria

- [ ] `bot_rules` table created via Alembic with check constraint and index
- [ ] Full CRUD at `/v1/bot-rules/` with filtering, sorting, pagination
- [ ] Rule evaluation engine correctly evaluates all trigger types
- [ ] Priority ordering respected (lower number = evaluated first)
- [ ] All tests passing, Ruff clean

---

## Dependencies

- **CONV-BE-001** — Conversation model (for status context in evaluation)

## Blocks

- **CONV-BE-005** (Inbound Flow) — uses the evaluation engine
