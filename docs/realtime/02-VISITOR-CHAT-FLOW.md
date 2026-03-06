# Workflow 02: Visitor Live Chat Flow

End-to-end flow for a visitor using the embedded chat widget on an account user's website. Covers widget initialization, session creation, WebSocket connection through AWS API Gateway, visitor message handling via Lambda callbacks, conversation creation, and realtime push to agents.

**Spec reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 6](../TURUMBA_REALTIME_MESSAGING.md#6-live-chat-widget-webchat-channel)

---

## End-to-End Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: WIDGET INITIALIZATION (~200-500ms)                │
│                                                             │
│  Account admin has embedded this on their website:          │
│  <script src="https://chat.turumba.io/widget.js"            │
│          data-key="abc123..."></script>                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 1. Page loads → widget.js executes          (~50ms) │    │
│  │    ├── Read data-key attribute ("abc123...")         │    │
│  │    ├── Check localStorage for existing visitor_id   │    │
│  │    └── Render chat launcher button (minimized)      │    │
│  │                                                     │    │
│  │ 2. Fetch widget config (public, no auth): (~100ms)  │    │
│  │    GET /v1/public/chat/abc123...                     │    │
│  │    (KrakenD → Messaging API, rate-limited)           │    │
│  │                                                     │    │
│  │    Response:                                        │    │
│  │    {                                                │    │
│  │      name: "Support Chat",                          │    │
│  │      welcome_message: "Hi! How can we help?",       │    │
│  │      offline_message: "We're offline...",           │    │
│  │      widget_config: {                               │    │
│  │        color: "#4F46E5",                            │    │
│  │        position: "bottom-right",                    │    │
│  │        launcher_text: "Chat with us"                │    │
│  │      },                                             │    │
│  │      pre_chat_form: {                               │    │
│  │        enabled: true,                               │    │
│  │        fields: [                                    │    │
│  │          { name: "name", required: true },          │    │
│  │          { name: "email", required: false }         │    │
│  │        ]                                            │    │
│  │      }                                              │    │
│  │    }                                                │    │
│  │                                                     │    │
│  │    ├── Chat endpoint not found / inactive           │    │
│  │    │   → Widget does not render, STOP               │    │
│  │    └── Config received → apply styling              │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 3. Visitor clicks chat launcher                     │    │
│  │    ├── Chat window opens (expand animation)         │    │
│  │    │                                                │    │
│  │    ├── If pre_chat_form.enabled:                    │    │
│  │    │   → Show form (name, email fields)             │    │
│  │    │   → Visitor fills in and submits               │    │
│  │    │   → Collected: { name, email }                 │    │
│  │    │                                                │    │
│  │    └── If no pre-chat form:                         │    │
│  │        → Skip directly to session creation          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: SESSION CREATION (~50-100ms)                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 4. Widget calls session endpoint:       (~50-100ms) │    │
│  │                                                     │    │
│  │    POST /v1/public/chat/abc123.../session            │    │
│  │    Body: {                                          │    │
│  │      visitor_id: "vs_abc..." or null,               │    │
│  │      name: "Dawit",         // from form            │    │
│  │      email: "d@example.com" // from form            │    │
│  │    }                                                │    │
│  │                                                     │    │
│  │    Messaging API:                                   │    │
│  │    a. Validate public_key → lookup chat_endpoint    │    │
│  │       ├── Not found / inactive → 404                │    │
│  │       └── Found → continue                         │    │
│  │                                                     │    │
│  │    b. Resolve visitor_id:                           │    │
│  │       ├── Provided (returning visitor)              │    │
│  │       │   → validate it exists, use it              │    │
│  │       └── Null (first visit)                        │    │
│  │           → generate: "vs_" + random_urlsafe(20)    │    │
│  │                                                     │    │
│  │    c. Sign visitor JWT:                             │    │
│  │       {                                             │    │
│  │         sub: "vs_abc123",                           │    │
│  │         account_id: "uuid",                         │    │
│  │         endpoint_id: "uuid",                        │    │
│  │         type: "visitor",                            │    │
│  │         exp: now + 1 hour                           │    │
│  │       }                                             │    │
│  │       Signed with VISITOR_JWT_SECRET (HMAC-SHA256)  │    │
│  │                                                     │    │
│  │    Response:                                        │    │
│  │    {                                                │    │
│  │      visitor_token: "vt_eyJhbGc...",                │    │
│  │      visitor_id: "vs_abc123",                       │    │
│  │      conversation_id: null,                         │    │
│  │      ws_url: "wss://{api-id}.execute-api..."        │    │
│  │    }                                                │    │
│  │                                                     │    │
│  │    Widget stores visitor_id in localStorage         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: WEBSOCKET CONNECTION (~60-100ms)                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 5. Widget opens WebSocket:                          │    │
│  │    wss://{api-id}.execute-api.{region}               │    │
│  │      .amazonaws.com/{stage}                          │    │
│  │      ?token={visitor_token}&type=visitor              │    │
│  │                                                     │    │
│  │    API Gateway invokes $connect Lambda               │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 6. Lambda ws-connect (visitor path):    (~50ms)     │    │
│  │                                                     │    │
│  │    a. Detect type=visitor from query params         │    │
│  │                                                     │    │
│  │    b. Call Messaging API to validate token:         │    │
│  │       POST gt_turumba_messaging_api:8000             │    │
│  │            /internal/validate-visitor                │    │
│  │       Body: { token: "vt_eyJhbGc..." }              │    │
│  │                                                     │    │
│  │       Response:                                     │    │
│  │       {                                             │    │
│  │         valid: true,                                │    │
│  │         visitor_id: "vs_abc123",                     │    │
│  │         account_id: "uuid",                         │    │
│  │         endpoint_id: "uuid",                        │    │
│  │         chat_endpoint_name: "Support Chat"          │    │
│  │       }                                             │    │
│  │       ├── valid: false → return 401, reject conn    │    │
│  │       └── valid: true → continue                   │    │
│  │                                                     │    │
│  │    c. Store in DynamoDB ws_connections:              │    │
│  │       {                                             │    │
│  │         connection_id: "conn_xyz",                   │    │
│  │         connection_type: "visitor",                  │    │
│  │         user_id: "vs_abc123",                        │    │
│  │         account_ids: ["account-uuid"],               │    │
│  │         endpoint_id: "chat-endpoint-uuid",           │    │
│  │         connected_at: ISO timestamp,                 │    │
│  │         ttl: now + 24h                               │    │
│  │       }                                             │    │
│  │                                                     │    │
│  │    d. Auto-subscribe to room "visitor:vs_abc123":    │    │
│  │       DynamoDB ws_subscriptions PUT:                  │    │
│  │       {                                             │    │
│  │         room: "visitor:vs_abc123",                    │    │
│  │         connection_id: "conn_xyz",                   │    │
│  │         user_id: "vs_abc123",                        │    │
│  │         ttl: now + 24h                               │    │
│  │       }                                             │    │
│  │                                                     │    │
│  │    e. Return 200 → WebSocket connection established │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Widget shows: "Connected" + welcome_message                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    │  Visitor types and sends a message
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: VISITOR SENDS MESSAGE (~30-80ms)                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 7. Widget sends WebSocket frame:                    │    │
│  │    {                                                │    │
│  │      action: "visitor_message",                     │    │
│  │      content: "Hello, I need help with my order",   │    │
│  │      content_type: "text"                           │    │
│  │    }                                                │    │
│  │                                                     │    │
│  │    API Gateway routes to ws-visitor-message Lambda   │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 8. Lambda ws-visitor-message:            (~25ms)    │    │
│  │                                                     │    │
│  │    a. Lookup connection in DynamoDB ws_connections:  │    │
│  │       → get visitor_id, account_id, endpoint_id     │    │
│  │                                                     │    │
│  │    b. Call Messaging API:                           │    │
│  │       POST gt_turumba_messaging_api:8000             │    │
│  │            /internal/visitor-message                 │    │
│  │       Body: {                                       │    │
│  │         visitor_id: "vs_abc123",                     │    │
│  │         account_id: "uuid",                         │    │
│  │         endpoint_id: "uuid",                        │    │
│  │         content: "Hello, I need help...",           │    │
│  │         content_type: "text",                       │    │
│  │         email: "d@example.com" // if pre-chat form  │    │
│  │       }                                             │    │
│  │                                                     │    │
│  │    (Messaging API processes — see Phase 5 below)    │    │
│  │                                                     │    │
│  │    c. Handle response:                              │    │
│  │       ├── SUCCESS response:                         │    │
│  │       │   { message_id, conversation_id,            │    │
│  │       │     created_at, is_new_conversation }       │    │
│  │       │                                             │    │
│  │       │   If is_new_conversation = true:            │    │
│  │       │     Subscribe visitor to conv room:          │    │
│  │       │     DynamoDB ws_subscriptions PUT:            │    │
│  │       │     {                                       │    │
│  │       │       room: "conv:{conversation_id}",        │    │
│  │       │       connection_id: "conn_xyz",             │    │
│  │       │       user_id: "vs_abc123"                   │    │
│  │       │     }                                       │    │
│  │       │                                             │    │
│  │       │   Send ACK to visitor:                      │    │
│  │       │   → @connections/conn_xyz:                   │    │
│  │       │     { type: "ack", message_id,              │    │
│  │       │       conversation_id, created_at }         │    │
│  │       │                                             │    │
│  │       └── REJECTION response:                       │    │
│  │           { allowed: false,                         │    │
│  │             reason: "no_matching_config"             │    │
│  │                  or "audience_rejected" }            │    │
│  │                                                     │    │
│  │           Send error to visitor:                    │    │
│  │           → @connections/conn_xyz:                   │    │
│  │             { type: "error",                        │    │
│  │               code: "conversation_not_allowed" }    │    │
│  │           Widget shows polite rejection message     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    │  Inside the Messaging API
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 5: MESSAGING API — /internal/visitor-message          │
│  (fire-and-forget, ~30-60ms to push, ~100ms bg persist)     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 9. CONTACT LOOKUP (find only — no create)  (~10ms)  │    │
│  │                                                     │    │
│  │    ├── Email provided (from pre-chat form):         │    │
│  │    │   POST /internal/contacts/lookup               │    │
│  │    │     { account_id, email: "d@example.com" }     │    │
│  │    │   ├── Found → contact_id = result              │    │
│  │    │   └── Not found → contact_id = null            │    │
│  │    │                                                │    │
│  │    └── No email (anonymous visitor):                │    │
│  │        → contact_id = null                          │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 10. EVALUATE CONVERSATION CONFIGS    (~1-20ms)      │    │
│  │     (See 04-CONFIG-EVALUATION.md for full details)  │    │
│  │                                                     │    │
│  │     Input:                                          │    │
│  │       source_type = "chat_endpoint"                 │    │
│  │       source_id   = endpoint_id                     │    │
│  │       contact_id  = from step 9 (or null)           │    │
│  │       account_id                                    │    │
│  │                                                     │    │
│  │     FOR EACH config (priority order):               │    │
│  │       source_check: endpoint_id in                  │    │
│  │         config.enabled_chat_endpoints?              │    │
│  │       audience_check: contact passes mode?          │    │
│  │                                                     │    │
│  │     ├── MATCH → matched_config                      │    │
│  │     └── NO MATCH → return { allowed: false,         │    │
│  │         reason: "no_matching_config" }              │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                   MATCH FOUND                               │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 11. ENSURE CONTACT EXISTS              (~0-15ms)    │    │
│  │                                                     │    │
│  │     ├── contact_id exists → use it                  │    │
│  │     └── contact_id is null (audience_mode = "all"): │    │
│  │         POST /internal/contacts/create              │    │
│  │         {                                           │    │
│  │           account_id,                               │    │
│  │           name: "Dawit" or "Visitor",               │    │
│  │           email: "d@example.com" (if provided),     │    │
│  │           properties: {                             │    │
│  │             visitor_id: "vs_abc123",                 │    │
│  │             source: "webchat"                       │    │
│  │           }                                         │    │
│  │         }                                           │    │
│  │         → contact_id = result.contact_id            │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 12. FIND OR CREATE CONVERSATION        (~10-20ms)   │    │
│  │                                                     │    │
│  │     Query: SELECT * FROM conversations              │    │
│  │       WHERE account_id = ? AND contact_id = ?       │    │
│  │         AND chat_endpoint_id = ?                    │    │
│  │         AND status NOT IN ('closed')                │    │
│  │       ORDER BY updated_at DESC LIMIT 1              │    │
│  │                                                     │    │
│  │     Same CASE A/B/C/D logic as                      │    │
│  │     01-INBOUND-IM-FLOW.md step 9                    │    │
│  │                                                     │    │
│  │     NEW conversation record:                        │    │
│  │     {                                               │    │
│  │       channel_id: null,                             │    │
│  │       chat_endpoint_id: endpoint_id,                │    │
│  │       contact_id,                                   │    │
│  │       contact_identifier: "vs_abc123",              │    │
│  │       team_id: config.default_team_id,              │    │
│  │       assignee_id: config.default_assignee_id,      │    │
│  │       status: "open" or "assigned"                  │    │
│  │     }                                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 13. FIRE-AND-FORGET: PUSH (~8ms) + BG (~100ms)     │    │
│  │                                                     │    │
│  │     Generate message_id = uuid4()                   │    │
│  │                                                     │    │
│  │     IMMEDIATE (before returning response):          │    │
│  │     ├── push_to_room("conv:{conv_id}", {            │    │
│  │     │     type: "conversation:message",             │    │
│  │     │     data: { message_id, conversation_id,      │    │
│  │     │       content, sender_type: "contact",        │    │
│  │     │       is_private: false, created_at }         │    │
│  │     │   })                                          │    │
│  │     │   → Agents viewing this thread see it NOW     │    │
│  │     │                                               │    │
│  │     └── push_to_room("account:{account_id}", {      │    │
│  │           type: "conversation:updated",             │    │
│  │           data: { conversation_id,                  │    │
│  │             last_message_at }                       │    │
│  │         })                                          │    │
│  │         → Agent inbox updates                       │    │
│  │                                                     │    │
│  │     Return { message_id, conversation_id,           │    │
│  │              created_at, is_new_conversation }      │    │
│  │                                                     │    │
│  │     BACKGROUND (FastAPI BackgroundTask):             │    │
│  │     ├── INSERT message row → PostgreSQL              │    │
│  │     ├── UPDATE conversation.last_message_at          │    │
│  │     └── EMIT conversation.message.created            │    │
│  │         → outbox → RabbitMQ                          │    │
│  │         (already_pushed: true — worker skips push)  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    │  Agent sees the message and replies
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 6: AGENT REPLY → VISITOR                             │
│  (See 03-AGENT-REPLY-FLOW.md for full details)              │
│                                                             │
│  Agent opens conversation in Turumba inbox                  │
│    → subscribes to room "conv:{conversation_id}"            │
│    → sees visitor's message (pushed in Phase 5)             │
│                                                             │
│  Agent sends reply:                                         │
│    POST /v1/conversations/{id}/messages                     │
│    { content: "Hi Dawit, let me check your order..." }      │
│                                                             │
│  Messaging API:                                             │
│    → push_to_room("conv:{id}", message_event)               │
│    → Visitor's connection (subscribed to conv room)          │
│      receives the message via @connections push             │
│    → Widget renders agent's reply in chat window            │
│                                                             │
│  For webchat conversations, there is NO channel adapter     │
│  dispatch — the WebSocket push IS the delivery mechanism.   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Timing Summary

```
Visitor opens chat widget on website
    │
    ├── 0ms      widget.js loads
    ├── ~50ms    Launcher button rendered
    ├── ~150ms   GET /public/chat/{key} → widget config received
    │
    │            ── visitor clicks chat, fills pre-chat form ──
    │
    ├── ~200ms   POST /public/chat/{key}/session
    ├── ~300ms   visitor_token + ws_url received
    │
    │            ── WebSocket connection ──
    │
    ├── ~310ms   wss:// connect initiated
    ├── ~330ms   Lambda validates visitor token (calls /internal/validate-visitor)
    ├── ~345ms   DynamoDB: store connection + subscribe to visitor room
    ├── ~360ms   WebSocket established, widget shows "Connected"
    │
    │            ── visitor types and sends first message ──
    │
    ├── ~0ms     WS frame sent: { action: "visitor_message", ... }
    ├── ~5ms     Lambda looks up connection in DynamoDB
    ├── ~10ms    Lambda calls POST /internal/visitor-message
    ├── ~20ms    Messaging API: contact lookup (Account API)
    ├── ~22ms    Config evaluation (cached, fast)
    ├── ~35ms    Ensure contact exists (create if needed)
    ├── ~50ms    Find/create conversation
    ├── ~55ms    push_to_room → agents see message (fire-and-forget)
    ├── ~58ms    Return response to Lambda
    ├── ~60ms    Lambda subscribes visitor to conv room (DynamoDB)
    ├── ~65ms    Lambda sends ACK to visitor
    │            └── Visitor sees "Message sent" confirmation
    │
    │            ── background (non-blocking) ──
    │
    └── ~160ms   DB persist: INSERT message + UPDATE conversation + outbox
```

**Key latencies:**
- Widget ready to chat: ~360ms (one-time setup)
- Visitor message → agent sees it: ~55ms (fire-and-forget push)
- Agent reply → visitor sees it: ~8ms (direct push via conv room)

---

## Sequence Diagram

```
Visitor       Widget.js      KrakenD     Messaging API    Lambda        DynamoDB     Account API    Agent Browser
  │              │              │             │              │              │             │              │
  │──click───►   │              │             │              │              │             │              │
  │              │──GET config──►             │              │              │             │              │
  │              │  ◄──config───│             │              │              │             │              │
  │──fill form──►│              │             │              │              │             │              │
  │              │──POST /session────────►    │              │              │             │              │
  │              │  ◄──visitor_token──────    │              │              │             │              │
  │              │                            │              │              │             │              │
  │              │──wss://connect─────────────────────────►  │              │             │              │
  │              │                            │              │──validate──► │             │              │
  │              │                            │  ◄──valid──  │              │             │              │
  │              │                            │              │──store conn──►             │              │
  │              │                            │              │──subscribe───►             │              │
  │              │  ◄──connected──────────────────────────── │              │             │              │
  │              │                            │              │              │             │              │
  │──type msg──► │                            │              │              │             │              │
  │              │──WS: visitor_message────────────────────► │              │             │              │
  │              │                            │              │──lookup conn─►             │              │
  │              │                            │              │  ◄──context──│             │              │
  │              │                            │  ◄──POST /internal/visitor-message──      │              │
  │              │                            │──lookup contact──────────────────────►    │              │
  │              │                            │  ◄──contact────────────────────────────   │              │
  │              │                            │──eval configs─│              │             │              │
  │              │                            │──create conv──│              │             │              │
  │              │                            │──push_to_room("conv:id")────►             │──push event──►
  │              │                            │──push_to_room("account:id")──►            │──push event──►
  │              │                            │──return──►    │              │             │              │
  │              │                            │              │──subscribe conv room──►    │              │
  │              │  ◄──ACK { message_id }─────────────────── │              │             │              │
  │              │                            │              │              │             │              │
  │              │                            │              │              │  Agent sees conversation    │
  │              │                            │              │              │             │  ◄──reply──── │
  │              │                            │  ◄──POST /conv/{id}/messages              │              │
  │              │                            │──push_to_room("conv:id")────►             │              │
  │              │  ◄──conversation:message───────────────── │  (via @connections)        │              │
  │──sees reply──│              │             │              │              │             │              │
```

---

## Visitor Room Subscriptions

A connected visitor is subscribed to exactly **two rooms**:

```
On $connect:
  └── "visitor:{visitor_id}"    ← auto-joined
      Used for: system messages, token refresh notices

On first message (is_new_conversation: true):
  └── "conv:{conversation_id}" ← joined by Lambda after /internal/visitor-message
      Used for: live messages, agent replies, typing indicators, status changes
```

The `visitor:{visitor_id}` room is NOT used for message delivery. All conversation messages flow through `conv:{conversation_id}`.

---

## Token Lifecycle

```
Widget initializes
    │
    ├── POST /session → visitor_token (1h expiry)
    │
    ├── Connect WebSocket with token
    │
    │   ... chat session ongoing ...
    │
    ├── Token nearing expiry (e.g., 50 min mark)
    │   Widget detects from JWT exp claim
    │
    ├── POST /session again (same visitor_id)
    │   → new visitor_token
    │
    ├── Disconnect existing WebSocket
    │
    └── Reconnect with new token
        → Lambda re-validates
        → Re-subscribe to rooms
```

---

## Error Handling

| Error | Where | Behavior |
|-------|-------|----------|
| Chat endpoint not found / inactive | GET /public/chat/{key} | 404 — widget does not render |
| Session creation fails | POST /session | Widget shows error, retry button |
| WebSocket $connect rejected (invalid token) | Lambda ws-connect | 401 — widget shows "connection failed", retry with new session |
| /internal/visitor-message returns `allowed: false` | Lambda ws-visitor-message | Send error frame to visitor: `{ type: "error", code: "conversation_not_allowed" }`. Widget shows polite message. |
| /internal/visitor-message timeout | Lambda ws-visitor-message | Lambda retries 1x, then sends error frame to visitor |
| WebSocket disconnects unexpectedly | Widget | Auto-reconnect with exponential backoff (max 5 retries). If token expired, call /session first. |
| Account API /internal/contacts/lookup fails | Messaging API | Retry 3x. On persistent failure, treat as contact_id = null (anonymous). |

---

## What Gets Created

| Step | Record | Table | Service |
|------|--------|-------|---------|
| Session creation | Nothing persisted (token is stateless JWT) | — | Messaging API |
| WebSocket connect | Connection + subscription | DynamoDB ws_connections, ws_subscriptions | Lambda |
| First message (new conv) | Conversation + Message + outbox events | PostgreSQL conversations, messages, outbox_events | Messaging API |
| First message (existing conv) | Message + outbox events | PostgreSQL messages, outbox_events | Messaging API |
| Contact auto-create | Contact record | MongoDB contacts | Account API |
| Conv room subscription | Subscription record | DynamoDB ws_subscriptions | Lambda |
