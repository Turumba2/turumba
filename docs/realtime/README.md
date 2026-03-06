# Realtime Messaging — Workflow Documentation

Detailed workflow breakdowns for the Turumba Realtime Messaging system. Each document covers a single workflow end-to-end with rich flow diagrams, step-by-step explanations, and error handling.

**Parent spec:** [`docs/TURUMBA_REALTIME_MESSAGING.md`](../TURUMBA_REALTIME_MESSAGING.md)

## Workflow Index

| # | Workflow | Description |
|---|----------|-------------|
| [01](./01-INBOUND-IM-FLOW.md) | Inbound IM Message Flow | WhatsApp/Telegram/SMS webhook → inbound worker → config evaluation → conversation creation → realtime push to agents |
| [02](./02-VISITOR-CHAT-FLOW.md) | Visitor Live Chat Flow | Widget initialization → session token → WebSocket connect → Lambda → visitor message → conversation creation → push to agents |
| [03](./03-AGENT-REPLY-FLOW.md) | Agent Reply Flow | Agent sends reply via REST → fire-and-forget WebSocket push → background DB persist → IM channel dispatch or webchat push |
| [04](./04-CONFIG-EVALUATION.md) | Config Evaluation Engine | Multi-config priority evaluation: source check → contact lookup → audience check → first match wins. Referenced by workflows 01 and 02. |
| [05](./05-REALTIME-PUSH.md) | Realtime Push Pipeline | `push_to_room` utility + `realtime_push_worker` + deduplication logic. How events reach agent and visitor browsers. |
| [06](./06-WEBSOCKET-LIFECYCLE.md) | WebSocket Connection Lifecycle | Agent and visitor connection lifecycle: connect, authenticate, subscribe to rooms, presence, disconnect, cleanup. |

## How Workflows Connect

```
                    ┌────────────────────────────────────┐
                    │         INBOUND SOURCES             │
                    └──────────┬───────────┬──────────────┘
                               │           │
                    ┌──────────▼──┐  ┌─────▼──────────────┐
                    │ 01 Inbound  │  │ 02 Visitor Chat    │
                    │ IM Flow     │  │ Flow               │
                    └──────┬──────┘  └──────┬─────────────┘
                           │                │
                    ┌──────▼────────────────▼──────┐
                    │ 04 Config Evaluation Engine  │
                    │ (source + audience matching) │
                    └──────────────┬───────────────┘
                                   │
                         Conversation + Message created
                                   │
                    ┌──────────────▼───────────────┐
                    │ 05 Realtime Push Pipeline    │
                    │ (direct push + worker)       │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ 06 WebSocket Lifecycle       │
                    │ (delivers to agent/visitor)  │
                    └──────────────────────────────┘
                                   ▲
                    ┌──────────────┘
                    │
             ┌──────┴──────────┐
             │ 03 Agent Reply  │
             │ Flow            │
             └─────────────────┘
```
