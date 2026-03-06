# Conversation Tasks

Task specs for the omnichannel customer support conversation system.

**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

## Task Index

### Phase 1: Conversation Foundation (P0)

| Task | Title | Service | Depends On |
|------|-------|---------|------------|
| [CONV-BE-001](./CONV-BE-001-conversation-models-crud.md) | Conversation + ContactIdentifier + CannedResponse Models & CRUD | Messaging API | — |
| [CONV-BE-002](./CONV-BE-002-message-extensions-conv-messages.md) | Message Model Extensions + Conversation Messages Endpoint | Messaging API | CONV-BE-001 |
| [CONV-BE-003](./CONV-BE-003-agent-preferences.md) | Agent Preferences Model & CRUD | Account API | — |
| [CONV-GW-001](./CONV-GW-001-gateway-routes.md) | Gateway Route Configuration | Gateway | CONV-BE-001, CONV-BE-003 |

### Phase 2: Bot Router + Agent Routing (P1)

| Task | Title | Service | Depends On |
|------|-------|---------|------------|
| [CONV-BE-004](./CONV-BE-004-bot-rules-evaluation.md) | BotRule Model + Rule Evaluation Engine | Messaging API | CONV-BE-001 |
| [CONV-BE-005](./CONV-BE-005-inbound-flow-agent-routing.md) | Inbound Conversation Flow + Agent Routing | Messaging API | CONV-BE-001, CONV-BE-002, CONV-BE-004, CONV-BE-003 |

### Phase 3: Real-Time Infrastructure (P1)

| Task | Title | Service | Depends On |
|------|-------|---------|------------|
| [CONV-AWS-001](./CONV-AWS-001-websocket-infrastructure.md) | AWS WebSocket Infrastructure | AWS (API Gateway + Lambda + DynamoDB) | — |
| [CONV-BE-006](./CONV-BE-006-realtime-push-worker.md) | Realtime Push Worker + RabbitMQ Topology | Messaging API | CONV-BE-001, CONV-AWS-001 |

### Phase 4: Frontend Integration (P1)

| Task | Title | Service | Depends On |
|------|-------|---------|------------|
| [CONV-FE-001](./CONV-FE-001-websocket-client-hooks.md) | WebSocket Client + Real-Time Hooks | Web Core | CONV-AWS-001 |
| [CONV-FE-002](./CONV-FE-002-conversation-inbox-chat.md) | Conversation Inbox + Chat View UI | Web Core | CONV-BE-001, CONV-BE-002, CONV-FE-001 |

## Dependency Graph

```
CONV-BE-001 (Models + CRUD) ──┬──→ CONV-BE-002 (Message Extensions)
                               │          │
CONV-BE-003 (Agent Prefs) ────┤          │
                               │          │
                               ├──→ CONV-GW-001 (Gateway Routes)
                               │
                               ├──→ CONV-BE-004 (Bot Rules)
                               │          │
                               │          ▼
                               ├──→ CONV-BE-005 (Inbound Flow + Routing)
                               │
                               └──→ CONV-BE-006 (Realtime Push Worker)
                                          ▲
CONV-AWS-001 (AWS WebSocket) ─────────────┤
                                          │
                               ┌──→ CONV-FE-001 (WS Client + Hooks)
                               │          │
                               │          ▼
                               └──→ CONV-FE-002 (Inbox + Chat UI)
```
