# Workflow 06: WebSocket Connection Lifecycle

Agent and visitor WebSocket connection lifecycle through the unified AWS API Gateway. Covers authentication, room subscriptions, presence management, typing indicators, and disconnect cleanup.

**Spec reference:** [TURUMBA_REALTIME_MESSAGING.md — Sections 7.1-7.6](../TURUMBA_REALTIME_MESSAGING.md#71-aws-api-gateway-websocket--unified-for-agents--visitors)

---

## Agent Connection Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AGENT CONNECTION                                                       │
│                                                                         │
│  Agent opens Turumba inbox in browser                                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 1. CONNECT                                         (~50ms)     │    │
│  │                                                                │    │
│  │    Frontend WebSocket manager:                                 │    │
│  │    ws = new WebSocket(                                         │    │
│  │      "wss://{api-id}.execute-api.{region}                      │    │
│  │        .amazonaws.com/{stage}                                  │    │
│  │        ?token={cognito_jwt}&type=agent"                        │    │
│  │    )                                                           │    │
│  │                                                                │    │
│  │    AWS API Gateway → Lambda ws-connect:              (~40ms)   │    │
│  │                                                                │    │
│  │    a. Parse query params: type=agent, token=jwt     (~0.1ms)   │    │
│  │                                                                │    │
│  │    b. Validate Cognito JWT:                          (~15ms)   │    │
│  │       ├── Fetch JWKS from Cognito (cached)                     │    │
│  │       ├── Verify RS256 signature                               │    │
│  │       ├── Check exp, iss, aud claims                           │    │
│  │       ├── Extract: sub (user_id), email,                       │    │
│  │       │   custom:account_ids                                   │    │
│  │       ├── Invalid → return 401, connection rejected            │    │
│  │       └── Valid → continue                                    │    │
│  │                                                                │    │
│  │    c. Store connection in DynamoDB:                   (~5ms)    │    │
│  │       Table: ws_connections                                    │    │
│  │       {                                                        │    │
│  │         connection_id: "conn_abc",                              │    │
│  │         connection_type: "agent",                               │    │
│  │         user_id: "cognito-sub-uuid",                            │    │
│  │         account_ids: ["account-uuid-1", "account-uuid-2"],      │    │
│  │         email: "agent@example.com",                             │    │
│  │         endpoint_id: null,  // agents don't have endpoints     │    │
│  │         connected_at: "2026-03-06T10:00:00Z",                   │    │
│  │         ttl: epoch + 24h                                        │    │
│  │       }                                                        │    │
│  │                                                                │    │
│  │    d. Auto-subscribe to personal room:               (~5ms)    │    │
│  │       Table: ws_subscriptions                                  │    │
│  │       {                                                        │    │
│  │         room: "user:{user_id}",                                 │    │
│  │         connection_id: "conn_abc",                              │    │
│  │         user_id: "cognito-sub-uuid",                            │    │
│  │         ttl: epoch + 24h                                        │    │
│  │       }                                                        │    │
│  │                                                                │    │
│  │    e. Update presence:                               (~5ms)    │    │
│  │       Table: ws_presence                                       │    │
│  │       UpdateExpression: SET #status = "online",                │    │
│  │         connection_count = connection_count + 1,               │    │
│  │         last_seen = now, ttl = epoch + 5min                    │    │
│  │                                                                │    │
│  │    f. Return 200 → WebSocket established                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 2. SUBSCRIBE TO ACCOUNT ROOM                       (~10ms)     │    │
│  │                                                                │    │
│  │    Frontend sends immediately after connect:                   │    │
│  │    ws.send(JSON.stringify({                                    │    │
│  │      action: "subscribe",                                     │    │
│  │      room: "account:{account_id}"                              │    │
│  │    }))                                                         │    │
│  │                                                                │    │
│  │    Lambda ws-subscribe:                                        │    │
│  │    a. Parse payload                                 (~0.1ms)   │    │
│  │    b. Validate: account_id in agent's account_ids   (~0.1ms)   │    │
│  │       ├── Not in list → send error frame, STOP                 │    │
│  │       └── Valid → continue                                    │    │
│  │    c. Put in ws_subscriptions:                       (~5ms)    │    │
│  │       { room: "account:{id}", connection_id, user_id }        │    │
│  │                                                                │    │
│  │    Now agent receives all account-level events:                │    │
│  │    new conversations, status changes, presence updates         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 3. SUBSCRIBE TO CONVERSATION ROOM                  (~10ms)     │    │
│  │    (when agent opens a specific conversation)                  │    │
│  │                                                                │    │
│  │    ws.send(JSON.stringify({                                    │    │
│  │      action: "subscribe",                                     │    │
│  │      room: "conv:{conversation_id}"                            │    │
│  │    }))                                                         │    │
│  │                                                                │    │
│  │    Lambda ws-subscribe:                                        │    │
│  │    a. Validate: load connection → get account_ids               │    │
│  │    b. Verify conversation belongs to agent's account            │    │
│  │       (Lambda queries DynamoDB for connection metadata)        │    │
│  │    c. Put in ws_subscriptions:                                 │    │
│  │       { room: "conv:{id}", connection_id, user_id }           │    │
│  │                                                                │    │
│  │    Now agent receives live messages, typing, and status        │    │
│  │    changes for this specific conversation.                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 4. TYPING INDICATOR                                (~8ms)      │    │
│  │    (while agent is typing a reply)                             │    │
│  │                                                                │    │
│  │    ws.send(JSON.stringify({                                    │    │
│  │      action: "typing",                                        │    │
│  │      conversation_id: "uuid",                                  │    │
│  │      typing: true                                              │    │
│  │    }))                                                         │    │
│  │                                                                │    │
│  │    Lambda ws-typing:                              (~8ms)       │    │
│  │    a. Query ws_subscriptions for room "conv:{id}" (~3ms)       │    │
│  │    b. For each subscriber (skip sender):          (~5ms)       │    │
│  │       POST @connections/{conn_id}                              │    │
│  │       { type: "conversation:typing",                           │    │
│  │         data: { user_id, conversation_id, typing: true } }    │    │
│  │                                                                │    │
│  │    Recipients: other agents + visitor in conv room              │    │
│  │                                                                │    │
│  │    Debounced on frontend: send every 3s while typing,          │    │
│  │    send typing: false 5s after last keystroke                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 5. PRESENCE UPDATE                                 (~12ms)     │    │
│  │                                                                │    │
│  │    ws.send(JSON.stringify({                                    │    │
│  │      action: "presence",                                      │    │
│  │      status: "away"   // "online" | "away" | "offline"         │    │
│  │    }))                                                         │    │
│  │                                                                │    │
│  │    Lambda ws-presence:                                         │    │
│  │    a. Update ws_presence table:                    (~3ms)      │    │
│  │       { account_id, user_id, status: "away",                   │    │
│  │         last_seen: now, ttl: epoch + 5min }                    │    │
│  │                                                                │    │
│  │    b. Broadcast to all account rooms:              (~8ms)      │    │
│  │       Query ws_subscriptions for "account:{id}"                │    │
│  │       For each subscriber:                                     │    │
│  │         POST @connections/{conn_id}                             │    │
│  │         { type: "agent:presence",                               │    │
│  │           data: { user_id, status: "away" } }                  │    │
│  │                                                                │    │
│  │    Heartbeat: frontend sends presence "online" every 30s        │    │
│  │    This refreshes the TTL in ws_presence.                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 6. UNSUBSCRIBE FROM CONVERSATION                   (~8ms)      │    │
│  │    (agent navigates away from conversation)                    │    │
│  │                                                                │    │
│  │    ws.send(JSON.stringify({                                    │    │
│  │      action: "unsubscribe",                                   │    │
│  │      room: "conv:{conversation_id}"                            │    │
│  │    }))                                                         │    │
│  │                                                                │    │
│  │    Lambda ws-subscribe (same Lambda, detects action):           │    │
│  │    Delete from ws_subscriptions:                               │    │
│  │      room = "conv:{id}" AND connection_id = "conn_abc"        │    │
│  │                                                                │    │
│  │    Agent no longer receives events for this conversation.      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 7. DISCONNECT                                      (~15ms)     │    │
│  │    (browser closes, network drops, or explicit close)          │    │
│  │                                                                │    │
│  │    API Gateway invokes $disconnect → Lambda ws-disconnect:      │    │
│  │                                                                │    │
│  │    a. Query ws_subscriptions by                                │    │
│  │       connection_id-index:                          (~3ms)     │    │
│  │       → get all rooms this connection belongs to               │    │
│  │       [user:{id}, account:{id}, conv:{id1}, conv:{id2}]       │    │
│  │                                                                │    │
│  │    b. Batch delete all subscriptions:               (~5ms)     │    │
│  │       Delete each { room, connection_id } pair                 │    │
│  │                                                                │    │
│  │    c. Delete from ws_connections:                   (~2ms)     │    │
│  │       connection_id = "conn_abc"                               │    │
│  │                                                                │    │
│  │    d. Update presence:                              (~5ms)     │    │
│  │       Decrement connection_count in ws_presence                │    │
│  │       If connection_count reaches 0:                           │    │
│  │         Set status = "offline"                                 │    │
│  │         Broadcast agent:presence { status: "offline" }         │    │
│  │         to all account rooms                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Visitor Connection Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│  VISITOR CONNECTION                                                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 1. CONNECT                                         (~60ms)     │    │
│  │                                                                │    │
│  │    Widget opens WebSocket:                                     │    │
│  │    ws = new WebSocket(                                         │    │
│  │      "wss://{api-id}...?token={visitor_token}&type=visitor"    │    │
│  │    )                                                           │    │
│  │                                                                │    │
│  │    Lambda ws-connect (visitor path):                            │    │
│  │                                                                │    │
│  │    a. Detect type=visitor                           (~0.1ms)   │    │
│  │                                                                │    │
│  │    b. Call Messaging API to validate:               (~20ms)    │    │
│  │       POST gt_turumba_messaging_api:8000                        │    │
│  │            /internal/validate-visitor                           │    │
│  │       { token: "vt_eyJhbGc..." }                               │    │
│  │                                                                │    │
│  │       Messaging API:                                           │    │
│  │       ├── Decode JWT (HMAC-SHA256, VISITOR_JWT_SECRET)         │    │
│  │       ├── Check exp claim (not expired?)                       │    │
│  │       ├── Lookup chat_endpoint by endpoint_id                  │    │
│  │       ├── Check is_active                                      │    │
│  │       └── Return: { valid, visitor_id, account_id,             │    │
│  │                     endpoint_id, chat_endpoint_name }          │    │
│  │                                                                │    │
│  │       ├── Invalid → return 401, connection rejected            │    │
│  │       └── Valid → continue                                    │    │
│  │                                                                │    │
│  │    c. Store connection:                              (~5ms)    │    │
│  │       ws_connections: {                                        │    │
│  │         connection_id, connection_type: "visitor",              │    │
│  │         user_id: "vs_abc123",                                   │    │
│  │         account_ids: ["account-uuid"],                          │    │
│  │         endpoint_id: "chat-endpoint-uuid",                      │    │
│  │         ttl: epoch + 24h                                        │    │
│  │       }                                                        │    │
│  │                                                                │    │
│  │    d. Auto-subscribe to visitor room:                (~5ms)    │    │
│  │       ws_subscriptions: {                                      │    │
│  │         room: "visitor:vs_abc123",                               │    │
│  │         connection_id, user_id: "vs_abc123"                     │    │
│  │       }                                                        │    │
│  │                                                                │    │
│  │    e. Return 200 → connected                                   │    │
│  │                                                                │    │
│  │    NOTE: No presence update for visitors.                       │    │
│  │    Visitors don't appear in presence maps.                     │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 2. SEND MESSAGE                                    (~30ms)     │    │
│  │    (see 02-VISITOR-CHAT-FLOW.md Phase 4 for full details)      │    │
│  │                                                                │    │
│  │    ws.send({ action: "visitor_message",                        │    │
│  │              content: "...", content_type: "text" })            │    │
│  │                                                                │    │
│  │    Lambda ws-visitor-message:                                  │    │
│  │    → Calls /internal/visitor-message                           │    │
│  │    → If new conversation: subscribe visitor to conv room       │    │
│  │    → Send ACK frame to visitor                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 3. TYPING INDICATOR                                (~8ms)      │    │
│  │                                                                │    │
│  │    ws.send({ action: "visitor_typing", typing: true })          │    │
│  │                                                                │    │
│  │    Lambda ws-visitor-typing:                                   │    │
│  │    a. Lookup connection → find conversation room    (~3ms)     │    │
│  │       (from ws_subscriptions: find conv:* room)                │    │
│  │    b. Relay typing to all others in room:           (~5ms)     │    │
│  │       { type: "conversation:typing",                           │    │
│  │         data: { user_id: "vs_abc123",                          │    │
│  │                 conversation_id, typing: true } }              │    │
│  │                                                                │    │
│  │    Agents in the conv room see "Visitor is typing..."          │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 4. RECEIVE EVENTS (passive — pushed by server)                  │    │
│  │                                                                │    │
│  │    Via conv:{conversation_id} room subscription:                │    │
│  │    ├── conversation:message  (agent replies)                    │    │
│  │    ├── conversation:typing   (agent is typing)                  │    │
│  │    └── conversation:updated  (status changes)                   │    │
│  │                                                                │    │
│  │    Via visitor:{visitor_id} room subscription:                   │    │
│  │    └── system messages (token refresh notices)                  │    │
│  │                                                                │    │
│  │    NEVER receives:                                              │    │
│  │    └── is_private messages (filtered by push_to_room)           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 5. DISCONNECT                                      (~10ms)     │    │
│  │                                                                │    │
│  │    Visitor closes browser tab / navigates away / network drop   │    │
│  │                                                                │    │
│  │    Lambda ws-disconnect:                                       │    │
│  │    a. Query subscriptions by connection_id-index    (~3ms)     │    │
│  │       → [visitor:vs_abc123, conv:{id}]                         │    │
│  │                                                                │    │
│  │    b. Batch delete all subscriptions                (~5ms)     │    │
│  │                                                                │    │
│  │    c. Delete from ws_connections                    (~2ms)     │    │
│  │                                                                │    │
│  │    d. NO presence update (visitors don't have presence)        │    │
│  │                                                                │    │
│  │    Conversation remains active. If visitor reconnects          │    │
│  │    (refreshes page), they go through /session again            │    │
│  │    and re-establish everything.                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Token Refresh Flows

### Agent Token Refresh (~200ms interruption)

```
Agent JWT nearing expiry
    │
    ├── Frontend detects (checks exp claim periodically)
    ├── Amplify refreshes Cognito token (automatic)
    ├── Close existing WebSocket connection
    │   → $disconnect Lambda cleans up
    └── Open new WebSocket with fresh JWT
        → $connect Lambda re-validates
        → Re-subscribe to all rooms
        → ~200ms gap in connectivity
```

### Visitor Token Refresh (~300ms interruption)

```
Visitor token nearing expiry (e.g., at 50 min mark)
    │
    ├── Widget detects from exp claim in JWT
    ├── Call POST /v1/public/chat/{key}/session
    │   with same visitor_id → get new visitor_token
    ├── Close existing WebSocket
    │   → $disconnect Lambda cleans up
    └── Open new WebSocket with fresh token
        → $connect Lambda re-validates via /internal/validate-visitor
        → Auto-subscribe to visitor:{id} room
        → If conversation exists, widget re-subscribes to conv:{id}
        → ~300ms gap (includes /session HTTP call)
```

---

## DynamoDB Operations Per Action

| Action | ws_connections | ws_subscriptions | ws_presence |
|--------|---------------|-----------------|-------------|
| Agent connect | PUT | PUT (user room) | UPDATE (+1) |
| Agent subscribe | — | PUT (room) | — |
| Agent unsubscribe | — | DELETE (room) | — |
| Agent typing | — | Query (room) | — |
| Agent presence | — | Query (account rooms) | PUT |
| Agent disconnect | DELETE | BatchDelete (all rooms) | UPDATE (-1) |
| Visitor connect | PUT | PUT (visitor room) | — |
| Visitor message | GetItem (lookup) | PUT (conv room, if new) | — |
| Visitor typing | — | Query (conv room) | — |
| Visitor disconnect | DELETE | BatchDelete (all rooms) | — |

---

## Reconnection Strategy

### Agent (frontend WebSocket manager)

```
On disconnect:
  attempt = 0
  while attempt < 5:
    wait = min(1000 * 2^attempt, 30000)  // 1s, 2s, 4s, 8s, 16s (cap 30s)
    sleep(wait)
    try connect()
    if success: break
    attempt++

  if attempt >= 5:
    Show banner: "Connection lost. Click to retry."
    (manual reconnect from this point)
```

### Visitor (widget WebSocket client)

```
On disconnect:
  if token expired:
    call /session → get new token
  attempt = 0
  while attempt < 5:
    wait = min(1000 * 2^attempt, 15000)  // 1s, 2s, 4s, 8s, 15s cap
    sleep(wait)
    try connect()
    if success: break
    attempt++

  if attempt >= 5:
    Show: "Connection lost. Please refresh the page."
```
