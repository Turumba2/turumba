# Realtime Messaging — Implementation Tasks

Task specs for implementing the Turumba Realtime Messaging feature as defined in [TURUMBA_REALTIME_MESSAGING.md](../../TURUMBA_REALTIME_MESSAGING.md).

**Replaces:** `docs/tasks/conversations/` (not implemented, superseded by this plan)

---

## Team Assignments

| Role | Person | Tasks |
|------|--------|-------|
| Tech Lead / Infra | **bengeos** | RT-AWS-001, RT-GW-001 |
| Backend Developer | **tesfayegirma-116** (tesfa) | RT-ACC-001, RT-ACC-002, RT-BE-001 through RT-BE-010 |
| Frontend Developer | **nahomfix** | RT-FE-001, RT-FE-002, RT-FE-003 |

---

## Phase 1: Data Foundation (P0)

All tasks are independent — can be developed in parallel.

| Task | Title | Service | Assignee | Depends On |
|------|-------|---------|----------|------------|
| [RT-ACC-001](./account-api/RT-ACC-001-teams-crud.md) | Teams + TeamMembers CRUD | Account API | tesfa | — |
| [RT-ACC-002](./account-api/RT-ACC-002-internal-contact-endpoints.md) | Internal Contact Endpoints | Account API | tesfa | — |
| [RT-BE-001](./messaging-api/RT-BE-001-conversation-model-crud.md) | Conversation Model + CRUD | Messaging API | tesfa | — |
| [RT-BE-002](./messaging-api/RT-BE-002-conversation-config-model-crud.md) | ConversationConfig Model + CRUD | Messaging API | tesfa | — |
| [RT-BE-003](./messaging-api/RT-BE-003-chat-endpoint-model-crud.md) | ChatEndpoint Model + CRUD + Public Session API | Messaging API | tesfa | — |
| [RT-BE-004](./messaging-api/RT-BE-004-message-extensions-conv-messages.md) | Message Extensions + Conversation Messages | Messaging API | tesfa | RT-BE-001 |

## Phase 2: Core Logic (P0)

Sequential chain — config evaluation feeds into inbound flow and visitor endpoints.

| Task | Title | Service | Assignee | Depends On |
|------|-------|---------|----------|------------|
| [RT-BE-005](./messaging-api/RT-BE-005-config-evaluation-engine.md) | Config Evaluation Engine | Messaging API | tesfa | RT-BE-002 |
| [RT-BE-006](./messaging-api/RT-BE-006-inbound-conversation-flow.md) | Inbound Conversation Flow (IM) | Messaging API | tesfa | RT-BE-001, RT-BE-004, RT-BE-005, RT-ACC-002 |
| [RT-BE-007](./messaging-api/RT-BE-007-internal-visitor-endpoints.md) | Internal Visitor Endpoints (Lambda Callbacks) | Messaging API | tesfa | RT-BE-001, RT-BE-003, RT-BE-004, RT-BE-005 |

## Phase 3: Realtime Infrastructure (P1)

| Task | Title | Service | Assignee | Depends On |
|------|-------|---------|----------|------------|
| [RT-AWS-001](./infrastructure/RT-AWS-001-websocket-dynamodb-lambda.md) | AWS WebSocket + DynamoDB + Lambda | AWS | bengeos | RT-BE-007 |
| [RT-BE-008](./messaging-api/RT-BE-008-push-to-room-utility.md) | push_to_room Utility | Messaging API | tesfa | RT-AWS-001 |
| [RT-BE-009](./messaging-api/RT-BE-009-realtime-push-worker.md) | Realtime Push Worker + RabbitMQ Topology | Messaging API | tesfa | RT-BE-008 |
| [RT-BE-010](./messaging-api/RT-BE-010-agent-reply-dispatch.md) | Agent Reply + IM Dispatch Flow | Messaging API | tesfa | RT-BE-004, RT-BE-008 |
| [RT-GW-001](./infrastructure/RT-GW-001-gateway-routes.md) | Gateway Routes | Gateway | bengeos | RT-BE-001, RT-BE-002, RT-BE-003, RT-ACC-001 |

## Phase 4: Frontend Integration (P1)

| Task | Title | Service | Assignee | Depends On |
|------|-------|---------|----------|------------|
| [RT-FE-001](./frontend/RT-FE-001-websocket-client-hooks.md) | WebSocket Client + React Hooks | Web Core | nahomfix | RT-AWS-001 |
| [RT-FE-002](./frontend/RT-FE-002-conversation-inbox-chat.md) | Conversation Inbox + Chat View UI | Web Core | nahomfix | RT-FE-001, RT-GW-001 |
| [RT-FE-003](./frontend/RT-FE-003-chat-widget-app.md) | Chat Widget App (Vite Bundle) | Web Core | nahomfix | RT-BE-003, RT-FE-001 |

---

## Dependency Graph

```
Phase 1 (all parallel):
  RT-ACC-001 (Teams) ───────────────────────────────────────→ RT-GW-001 (bengeos)
  RT-ACC-002 (Internal Contacts) ───────────────┐
  RT-BE-001 (Conversation CRUD) ──┬─────────────┼──────────→ RT-GW-001
  RT-BE-002 (ConvConfig CRUD) ────┼──→ RT-BE-005│──────────→ RT-GW-001
  RT-BE-003 (ChatEndpoint CRUD) ──┤             │ ─────────→ RT-GW-001
  RT-BE-004 (Message Ext) ←───────┘             │
                                   │             │
Phase 2 (sequential):             │             │
  RT-BE-005 (Config Eval) ────────┼─────────────┤
                                   │             │
  RT-BE-006 (Inbound Flow) ←──────┘─────────────┘
  RT-BE-007 (Visitor Endpoints) ←── RT-BE-001 + RT-BE-003 + RT-BE-005

Phase 3 (after Phase 2):
  RT-AWS-001 (AWS Infra, bengeos) ←── RT-BE-007
       │
       ├──→ RT-BE-008 (push_to_room)
       │         │
       │         ├──→ RT-BE-009 (Push Worker)
       │         └──→ RT-BE-010 (Agent Reply)
       │
       └──→ RT-FE-001 (WS Client, nahomfix)

Phase 4 (after Phase 3):
  RT-GW-001 ──→ RT-FE-002 (Inbox UI, nahomfix)
  RT-FE-001 ──→ RT-FE-002
  RT-BE-003 + RT-FE-001 ──→ RT-FE-003 (Widget, nahomfix)
```

---

## Task Summary

| Category | Count | Assignee |
|----------|-------|----------|
| Account API (backend) | 2 | tesfa |
| Messaging API (backend) | 10 | tesfa |
| AWS Infrastructure | 1 | bengeos |
| Gateway | 1 | bengeos |
| Frontend | 3 | nahomfix |
| **Total** | **17** | |

---

## Related Documents

- [TURUMBA_REALTIME_MESSAGING.md](../../TURUMBA_REALTIME_MESSAGING.md) — Master specification
- [docs/realtime/](../../realtime/) — Detailed workflow documents with timing and diagrams
- [docs/improvements/](../../improvements/) — Architecture review and recommendations
- [docs/improvements/AWS-COST-ANALYSIS.md](../../improvements/AWS-COST-ANALYSIS.md) — AWS pricing implications

## Design Decisions

- **Persist-first pattern**: RT-BE-010 uses persist-first (DB → push → return 201) instead of the spec's fire-and-forget. See [RECOMMENDATIONS.md](../../improvements/RECOMMENDATIONS.md).
- **ContactIdentifiers deferred**: Per spec Section 3.3, contact_identifiers are not included. Initial flow uses direct contact lookup by phone/email.
- **Bot rules not included**: Bot-first routing, auto-reply rules, and agent preferences are Phase 5 (future).
