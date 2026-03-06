# Workflow 03: Agent Reply Flow

How an agent sends a reply to a conversation — covering both IM channel conversations (WhatsApp, Telegram, etc.) and webchat conversations. Uses the fire-and-forget pattern: immediate WebSocket push, then background DB persistence and channel dispatch.

**Spec reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 8](../TURUMBA_REALTIME_MESSAGING.md#8-message-delivery-model--fire-and-forget-push)

---

## End-to-End Flow Diagram

```
Agent in Turumba Inbox (browser)
    │
    │  Agent is viewing a conversation and types a reply
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: AGENT SENDS MESSAGE (~2ms)                                    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 1. Frontend sends REST request:                     (~2ms)     │    │
│  │                                                                │    │
│  │    POST /v1/conversations/{conversation_id}/messages            │    │
│  │    Headers: Authorization: Bearer {cognito_jwt}                │    │
│  │    Body: {                                                     │    │
│  │      content: "Hi, let me check your order...",                │    │
│  │      content_type: "text",                                     │    │
│  │      is_private: false     // true = internal note             │    │
│  │    }                                                           │    │
│  │                                                                │    │
│  │    Frontend immediately renders optimistic message:            │    │
│  │    { tempId: uuid, content, status: "sending" }                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
    │
    │  KrakenD → Messaging API
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: MESSAGING API — FIRE-AND-FORGET                               │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 2. VALIDATE + AUTHORIZE                             (~1ms)     │    │
│  │                                                                │    │
│  │    ├── Verify JWT (from gateway context-enricher headers)      │    │
│  │    ├── Load conversation by ID                                 │    │
│  │    │   ├── Not found → 404                                     │    │
│  │    │   └── Found → check account_id matches                   │    │
│  │    └── Extract current_user_id from token                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 3. GENERATE IDs + BUILD EVENT                       (~0.1ms)   │    │
│  │                                                                │    │
│  │    message_id = uuid4()       // pre-generate, no I/O          │    │
│  │    now = datetime.now(UTC)                                     │    │
│  │                                                                │    │
│  │    ws_event = {                                                │    │
│  │      type: "conversation:message",                             │    │
│  │      data: {                                                   │    │
│  │        message_id,                                             │    │
│  │        conversation_id,                                        │    │
│  │        content: "Hi, let me check your order...",              │    │
│  │        sender_type: "agent",                                   │    │
│  │        sender_id: current_user_id,                             │    │
│  │        is_private: false,                                      │    │
│  │        created_at: now.isoformat()                             │    │
│  │      }                                                         │    │
│  │    }                                                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 4. IMMEDIATE PATH — DIRECT WEBSOCKET PUSH           (~5-15ms) │    │
│  │    (See 05-REALTIME-PUSH.md for push_to_room details)          │    │
│  │                                                                │    │
│  │    a. Push to conversation room:                    (~5ms)     │    │
│  │       push_to_room("conv:{conversation_id}", ws_event,         │    │
│  │                     skip_visitors=is_private)                   │    │
│  │                                                                │    │
│  │       ├── Query DynamoDB ws_subscriptions              (2ms)   │    │
│  │       │   room = "conv:{conversation_id}"                      │    │
│  │       │   → returns list of connection_ids                     │    │
│  │       │                                                        │    │
│  │       ├── For each connection:                                 │    │
│  │       │   ├── If is_private AND connection_type="visitor"      │    │
│  │       │   │   → SKIP (private notes not sent to visitors)     │    │
│  │       │   │                                                    │    │
│  │       │   └── POST @connections/{connection_id}        (2ms)   │    │
│  │       │       Body: JSON(ws_event)                             │    │
│  │       │       ├── 200 → delivered                              │    │
│  │       │       └── 410 GoneException → stale, cleanup          │    │
│  │       │                                                        │    │
│  │       Recipients:                                              │    │
│  │       ├── Other agents viewing this conversation               │    │
│  │       └── Visitor (if webchat conv AND not private)            │    │
│  │                                                                │    │
│  │    b. Push inbox update to account room:            (~3ms)     │    │
│  │       push_to_room("account:{account_id}", {                   │    │
│  │         type: "conversation:updated",                          │    │
│  │         data: { conversation_id, last_message_at }             │    │
│  │       })                                                       │    │
│  │       → All agents in the account get inbox refresh            │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 5. RETURN 202 IMMEDIATELY                           (~0.1ms)   │    │
│  │                                                                │    │
│  │    HTTP 202 Accepted                                           │    │
│  │    {                                                           │    │
│  │      success: true,                                            │    │
│  │      data: {                                                   │    │
│  │        message_id: "uuid",                                     │    │
│  │        created_at: "2026-03-06T10:30:00Z",                     │    │
│  │        status: "queued"                                        │    │
│  │      }                                                         │    │
│  │    }                                                           │    │
│  │                                                                │    │
│  │    Total time from request to response: ~8-20ms                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                          │                                              │
│  ════════════════════════╪══════════════════════════════════════════    │
│  Response returned ↑     │ BackgroundTask starts ↓                     │
│  ════════════════════════╪══════════════════════════════════════════    │
│                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 6. BACKGROUND PATH — DB PERSISTENCE                (~50-200ms) │    │
│  │    (FastAPI BackgroundTask, non-blocking)                       │    │
│  │                                                                │    │
│  │    Retry loop (max 3 attempts, exponential backoff):            │    │
│  │                                                                │    │
│  │    a. INSERT message:                               (~10ms)    │    │
│  │       Message(                                                 │    │
│  │         id=message_id,        // same ID sent in ACK           │    │
│  │         conversation_id,                                       │    │
│  │         content,                                               │    │
│  │         direction="outbound",                                  │    │
│  │         sender_type="agent",                                   │    │
│  │         sender_id=current_user_id,                             │    │
│  │         is_private,                                            │    │
│  │         channel_id=conversation.channel_id,                    │    │
│  │         chat_endpoint_id=conversation.chat_endpoint_id,        │    │
│  │         account_id=conversation.account_id,                    │    │
│  │         created_at=now                                         │    │
│  │       )                                                        │    │
│  │                                                                │    │
│  │    b. UPDATE conversation:                          (~5ms)     │    │
│  │       conversation.last_message_at = now                       │    │
│  │       if not conversation.first_reply_at:                      │    │
│  │         conversation.first_reply_at = now  // SLA tracking     │    │
│  │                                                                │    │
│  │    c. EMIT event → outbox:                          (~5ms)     │    │
│  │       event_bus.emit(                                          │    │
│  │         CONVERSATION_MESSAGE_SENT,                             │    │
│  │         { message_id, already_pushed: true }                   │    │
│  │       )                                                        │    │
│  │       OutboxMiddleware.flush(db)                                │    │
│  │                                                                │    │
│  │    d. COMMIT transaction                            (~10ms)    │    │
│  │       db.commit()                                              │    │
│  │       → pg_notify wakes outbox_worker                          │    │
│  │                                                                │    │
│  │    On failure (all 3 retries):                                 │    │
│  │    ├── push_message_failed(sender_id, message_id)              │    │
│  │    │   → WS push to agent: { type: "message:failed" }         │    │
│  │    └── enqueue_dead_letter("message_persistence_dlq",          │    │
│  │          { message_id, conversation_id, content, error })      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
    │
    │  For IM conversations only (WhatsApp, Telegram, etc.)
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: IM CHANNEL DISPATCH (async, only for IM conversations)        │
│  (~200ms-2s depending on provider)                                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 7. outbox_worker publishes event to RabbitMQ        (~50ms)    │    │
│  │    → "messaging" exchange, routing key                         │    │
│  │      "conversation.message.sent"                               │    │
│  │                                                                │    │
│  │ 8. dispatch_worker consumes event                   (~100ms+)  │    │
│  │    ├── Load message from DB                                    │    │
│  │    ├── Load channel + credentials                              │    │
│  │    ├── Resolve adapter:                                        │    │
│  │    │   adapter = get_adapter(channel.channel_type,             │    │
│  │    │                         channel.provider)                 │    │
│  │    │                                                           │    │
│  │    ├── Build DispatchPayload:                                  │    │
│  │    │   {                                                       │    │
│  │    │     to: contact_identifier,  // phone, telegram_id, etc.  │    │
│  │    │     content, content_type,                                │    │
│  │    │     credentials: channel.credentials                      │    │
│  │    │   }                                                       │    │
│  │    │                                                           │    │
│  │    ├── adapter.send(payload)                        (~200ms+)  │    │
│  │    │   ├── Success → DispatchResult(success=true,              │    │
│  │    │   │     external_id="provider_msg_id")                    │    │
│  │    │   │   → UPDATE message.status = "sent"                    │    │
│  │    │   │   → UPDATE message.external_id                        │    │
│  │    │   │                                                       │    │
│  │    │   └── Failure → retry or DLQ                              │    │
│  │    │                                                           │    │
│  │    └── NOTE: is_private messages are NOT dispatched            │    │
│  │        (internal notes stay in Turumba only)                   │    │
│  │                                                                │    │
│  │ 9. realtime_push_worker consumes same event                    │    │
│  │    ├── Check already_pushed: true → SKIP WS push              │    │
│  │    └── (already delivered in step 4)                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  For WEBCHAT conversations: no dispatch_worker involved.                │
│  The WebSocket push in step 4 IS the delivery mechanism.                │
│  The visitor receives the reply via their conv room subscription.       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: CLIENT-SIDE RECONCILIATION                                    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ 10. SENDER (agent who sent the reply):                          │    │
│  │                                                                │    │
│  │     On POST response (202):                                    │    │
│  │       Update optimistic message:                               │    │
│  │       { tempId → message_id, status: "sending" → "sent" }     │    │
│  │                                                                │    │
│  │     On WS push (their own message echoed back):                │    │
│  │       Deduplicate by message_id → already rendered, skip       │    │
│  │                                                                │    │
│  │     On "message:failed" WS event:                              │    │
│  │       { tempId, status: "failed" } → show retry button         │    │
│  │                                                                │    │
│  │ 11. OTHER AGENTS (viewing same conversation):                  │    │
│  │                                                                │    │
│  │     Receive conversation:message WS event                      │    │
│  │       → Append message to chat view                            │    │
│  │       → Deduplicate by message_id (in case of double push)     │    │
│  │                                                                │    │
│  │ 12. VISITOR (webchat conversations only):                      │    │
│  │                                                                │    │
│  │     Receive conversation:message WS event via conv room        │    │
│  │       → Widget renders agent's reply bubble                    │    │
│  │       → Private notes (is_private: true) are NEVER received    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Timing Summary

```
Agent clicks "Send"
    │
    ├── 0ms    Request leaves browser
    ├── 2ms    Hits KrakenD gateway
    ├── 3ms    Messaging API validates + loads conversation
    ├── 3ms    Generate message_id + build event
    ├── 8ms    push_to_room completes (DynamoDB query + @connections)
    │          ├── Other agents see message
    │          └── Visitor sees message (webchat)
    ├── 8ms    Return HTTP 202 to sender
    │          └── Sender updates optimistic message → "sent"
    │
    │          ── response returned, background starts ──
    │
    ├── 30ms   INSERT message → PostgreSQL
    ├── 40ms   UPDATE conversation + outbox flush + commit
    ├── 90ms   outbox_worker publishes to RabbitMQ
    ├── 100ms  realtime_push_worker skips (already_pushed)
    └── 300ms+ dispatch_worker sends to WhatsApp/Telegram (IM only)
              └── Customer sees reply on their device
```

---

## IM vs Webchat — Key Differences

| Aspect | IM Conversation | Webchat Conversation |
|--------|----------------|---------------------|
| Conversation has | `channel_id` set | `chat_endpoint_id` set |
| Message has | `channel_id` set | `chat_endpoint_id` set |
| Immediate push recipients | Other agents in conv room | Other agents + visitor in conv room |
| External dispatch needed? | Yes — channel adapter sends to WhatsApp/Telegram/etc. | No — WebSocket push IS the delivery |
| Customer sees reply via | Platform app (WhatsApp, Telegram, etc.) | Chat widget in their browser |
| Private notes | Not dispatched (internal only) | Not pushed to visitor connection |

---

## Failure Modes

| Scenario | Timing | Outcome |
|----------|--------|---------|
| WebSocket push succeeds, DB succeeds | Normal | Message delivered and persisted |
| WebSocket push succeeds, DB fails (3 retries) | ~500ms | Message seen by recipient but not in history. Dead-lettered. Sender sees error. |
| WebSocket push fails (stale conn), DB succeeds | Normal | Recipient misses real-time push. Sees message on next page load. |
| Both fail | Immediate | Message lost. Sender sees error. Must retry manually. |
| Channel dispatch fails (IM only) | ~2s | Message persisted in Turumba. Customer doesn't receive on platform. DLQ for retry. |
