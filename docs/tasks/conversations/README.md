# Customer Support — Conversation Task Specs

Task specifications for the omnichannel customer support / conversation inbox feature.

**Architecture Reference:** [Conversation Architecture Plan](../../plans/conversations/ARCHITECTURE.md)

## Task Index

| Spec | Service | Priority | Description |
|------|---------|----------|-------------|
| [CONV-001](./CONV-001-conversation-models-crud.md) | turumba_messaging_api | P0 | Conversation, ContactIdentifier, CannedResponse models + CRUD, Message table extensions |
| [CONV-002](./CONV-002-agent-preferences.md) | turumba_account_api | P0 | AgentPreference model + CRUD + `/me` shortcut endpoint |
| [CONV-003](./CONV-003-bot-router-agent-routing.md) | turumba_messaging_api | P1 | BotRule model + CRUD, rule evaluation engine, agent routing algorithm |
| [CONV-004](./CONV-004-realtime-websocket-service.md) | turumba_realtime (NEW) | P1 | Standalone Socket.IO + RabbitMQ + Redis real-time event service |

## Dependency Graph

```
CONV-001 (Conversation Foundation)
    │
    ├──→ CONV-002 (Agent Preferences) — can be built in parallel
    │
    ├──→ CONV-003 (Bot Router) — depends on CONV-001 + CONV-002
    │         │
    │         └──→ HSM-001 (Channel Adapters) — prerequisite for dispatch
    │         └──→ HSM-003 (Webhook Receivers) — prerequisite for inbound flow
    │
    └──→ CONV-004 (Real-Time Service) — depends on CONV-001 for event types
```

## Prerequisites

- **HSM-001** (Channel Adapter Framework) — required for sending bot replies and agent messages
- **HSM-003** (Webhook Receivers) — required for receiving inbound customer messages
- These can be built in parallel with CONV-001 and CONV-002
