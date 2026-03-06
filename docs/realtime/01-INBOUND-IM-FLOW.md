# Workflow 01: Inbound IM Message Flow

How messages from WhatsApp, Telegram, Messenger, SMS, SMPP, and Email enter the system, get evaluated against conversation configs, and result in conversation creation (or rejection).

**Spec reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 5.1](../TURUMBA_REALTIME_MESSAGING.md#51-inbound-flow)

---

## End-to-End Flow Diagram

```
Customer sends message on WhatsApp / Telegram / SMS / Email / ...
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: WEBHOOK RECEPTION (synchronous, ~20-50ms)         │
│                                                             │
│  Provider calls POST /v1/webhooks/{type}/{channel_id}       │
│  (routed through KrakenD → Messaging API)                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 1. Verify HMAC/signature                   (~1ms)   │    │
│  │    ├── Invalid → return 401, log, STOP              │    │
│  │    └── Valid → continue                             │    │
│  │                                                     │    │
│  │ 2. Parse webhook payload via channel adapter (~2ms) │    │
│  │    adapter = get_adapter(channel_type, provider)     │    │
│  │    inbound = adapter.parse_inbound(request)          │    │
│  │    Extracts: sender_phone/email/platform_id,        │    │
│  │              content, content_type, media_url        │    │
│  │                                                     │    │
│  │ 3. Return 200 OK immediately              (~0.1ms)  │    │
│  │    (fast ACK — providers drop webhooks after timeout)│    │
│  │                                                     │    │
│  │ 4. Publish raw inbound event → RabbitMQ   (~5ms)    │    │
│  │    Exchange: "messaging"                             │    │
│  │    Queue:    "conversation.inbound"                  │    │
│  │    Payload:  { channel_id, channel_type, account_id, │    │
│  │               sender_identifier, content,            │    │
│  │               content_type, raw_payload }            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    │ RabbitMQ
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: INBOUND MESSAGE WORKER (async, ~50-200ms total)   │
│                                                             │
│  Worker: turumba_messaging_api/src/workers/                 │
│          inbound_message_worker.py                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 5. EXTRACT SENDER IDENTIFIER              (~0.1ms)  │    │
│  │    From parsed payload:                             │    │
│  │    ├── WhatsApp → phone: "+251911..."               │    │
│  │    ├── Telegram → telegram_user_id: "123456789"     │    │
│  │    ├── Messenger → psid: "PSID_123"                 │    │
│  │    ├── SMS/SMPP → phone: "+251911..."               │    │
│  │    └── Email → email: "customer@example.com"        │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 6. CONTACT LOOKUP (find only — no create)  (~10ms)  │    │
│  │                                                     │    │
│  │    POST http://gt_turumba_account_api:8000           │    │
│  │         /internal/contacts/lookup                    │    │
│  │    Body: { account_id, phone: "+251..." }            │    │
│  │      OR: { account_id, email: "..." }                │    │
│  │                                                     │    │
│  │    ├── { found: true, contact_id, name }            │    │
│  │    │   → contact_id = result.contact_id             │    │
│  │    │   → is_known = true                            │    │
│  │    │                                                │    │
│  │    └── { found: false }                             │    │
│  │        → contact_id = null                          │    │
│  │        → is_known = false                           │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 7. EVALUATE CONVERSATION CONFIGS     (~1-20ms)      │    │
│  │    (See 04-CONFIG-EVALUATION.md for full details)   │    │
│  │                                                     │    │
│  │    Input:                                           │    │
│  │      source_type = "channel"                        │    │
│  │      source_id   = channel_id (from webhook URL)    │    │
│  │      contact_id  = from step 6 (or null)            │    │
│  │      account_id  = from channel record              │    │
│  │                                                     │    │
│  │    Load configs WHERE account_id = ? AND            │    │
│  │      is_active = true ORDER BY priority ASC         │    │
│  │                                                     │    │
│  │    FOR EACH config:                                 │    │
│  │      source_check: channel_id in                    │    │
│  │        config.enabled_channels? → No → skip         │    │
│  │      audience_check:                                │    │
│  │        config.audience_mode → check rules           │    │
│  │        (may call /internal/contacts/check-membership│    │
│  │         for "groups" and "allowlist" modes)          │    │
│  │                                                     │    │
│  │    ├── MATCH FOUND → matched_config                 │    │
│  │    │                                                │    │
│  │    └── NO MATCH                                     │    │
│  │        → Message stored for delivery tracking only  │    │
│  │        → No conversation created                    │    │
│  │        → ACK RabbitMQ message, STOP                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                   MATCH FOUND                               │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 8. ENSURE CONTACT EXISTS              (~0-15ms)     │    │
│  │                                                     │    │
│  │    ├── contact_id exists (from step 6)              │    │
│  │    │   → use it, skip creation                      │    │
│  │    │                                                │    │
│  │    └── contact_id is null                           │    │
│  │        (matched config audience_mode must be "all") │    │
│  │                                                     │    │
│  │        POST http://gt_turumba_account_api:8000       │    │
│  │             /internal/contacts/create                │    │
│  │        Body: {                                      │    │
│  │          account_id: "uuid",                        │    │
│  │          phone: "+251...",                           │    │
│  │          name: "Unknown",                           │    │
│  │          properties: { source: "whatsapp" }         │    │
│  │        }                                            │    │
│  │        → contact_id = result.contact_id             │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 9. FIND OR CREATE CONVERSATION         (~10-20ms)   │    │
│  │                                                     │    │
│  │    Query: SELECT * FROM conversations               │    │
│  │      WHERE account_id = ? AND contact_id = ?        │    │
│  │        AND channel_id = ?                           │    │
│  │        AND status NOT IN ('closed')                 │    │
│  │      ORDER BY updated_at DESC LIMIT 1               │    │
│  │                                                     │    │
│  │    ┌─────────────────────────────────────────┐      │    │
│  │    │ CASE A: Active conversation found       │      │    │
│  │    │ (status: open / assigned / pending)      │      │    │
│  │    │                                         │      │    │
│  │    │ → Append message to existing thread      │      │    │
│  │    │ → Go to step 10                         │      │    │
│  │    └─────────────────────────────────────────┘      │    │
│  │                                                     │    │
│  │    ┌─────────────────────────────────────────┐      │    │
│  │    │ CASE B: Resolved conversation found     │      │    │
│  │    │                                         │      │    │
│  │    │ Apply matched_config.reopen_policy:      │      │    │
│  │    │ ├── "reopen"                            │      │    │
│  │    │ │   → Set status back to "open"          │      │    │
│  │    │ │   → Append message                    │      │    │
│  │    │ │                                       │      │    │
│  │    │ ├── "new"                               │      │    │
│  │    │ │   → Create NEW conversation            │      │    │
│  │    │ │                                       │      │    │
│  │    │ └── "threshold"                         │      │    │
│  │    │     hours_since = now - resolved_at      │      │    │
│  │    │     ├── hours_since ≤ reopen_window     │      │    │
│  │    │     │   → Reopen existing conversation   │      │    │
│  │    │     └── hours_since > reopen_window      │      │    │
│  │    │         → Create NEW conversation        │      │    │
│  │    └─────────────────────────────────────────┘      │    │
│  │                                                     │    │
│  │    ┌─────────────────────────────────────────┐      │    │
│  │    │ CASE C: Closed conversation found       │      │    │
│  │    │ (closed is terminal)                    │      │    │
│  │    │                                         │      │    │
│  │    │ → Create NEW conversation               │      │    │
│  │    └─────────────────────────────────────────┘      │    │
│  │                                                     │    │
│  │    ┌─────────────────────────────────────────┐      │    │
│  │    │ CASE D: No conversation found           │      │    │
│  │    │                                         │      │    │
│  │    │ Apply matched_config.creation_mode:      │      │    │
│  │    │ ├── "auto"                              │      │    │
│  │    │ │   → Create NEW conversation            │      │    │
│  │    │ │   → team_id = config.default_team_id   │      │    │
│  │    │ │   → assignee_id =                     │      │    │
│  │    │ │     config.default_assignee_id         │      │    │
│  │    │ │   → status = "assigned" if assignee    │      │    │
│  │    │ │     set, else "open"                   │      │    │
│  │    │ │                                       │      │    │
│  │    │ └── "manual"                            │      │    │
│  │    │     → Store message with                │      │    │
│  │    │       conversation_id = NULL             │      │    │
│  │    │     → metadata_: { pending_thread: true }│      │    │
│  │    │     → Agent creates conversation later   │      │    │
│  │    │     → Go to step 10 (skip conv events)  │      │    │
│  │    └─────────────────────────────────────────┘      │    │
│  │                                                     │    │
│  │    NEW conversation record:                         │    │
│  │    {                                                │    │
│  │      id: uuid4(),                                   │    │
│  │      account_id,                                    │    │
│  │      channel_id,              // IM source          │    │
│  │      chat_endpoint_id: null,  // not webchat        │    │
│  │      contact_id,                                    │    │
│  │      contact_identifier: sender_phone/email/id,     │    │
│  │      team_id: config.default_team_id,               │    │
│  │      assignee_id: config.default_assignee_id,       │    │
│  │      status: "open" or "assigned",                  │    │
│  │      priority: "normal",                            │    │
│  │      last_message_at: now                           │    │
│  │    }                                                │    │
│  └─────────────────────────────────────────────────────┘    │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 10. CREATE MESSAGE + EMIT EVENTS       (~15-30ms)   │    │
│  │                                                     │    │
│  │    INSERT message:                                  │    │
│  │    {                                                │    │
│  │      id: uuid4(),                                   │    │
│  │      conversation_id,     // from step 9            │    │
│  │      channel_id,                                    │    │
│  │      chat_endpoint_id: null,                        │    │
│  │      account_id,                                    │    │
│  │      content,                                       │    │
│  │      content_type,        // text, image, etc.      │    │
│  │      direction: "inbound",                          │    │
│  │      sender_type: "contact",                        │    │
│  │      sender_id: null,     // contacts don't have    │    │
│  │                           // user_id                │    │
│  │      is_private: false                              │    │
│  │    }                                                │    │
│  │                                                     │    │
│  │    UPDATE conversation.last_message_at = now         │    │
│  │                                                     │    │
│  │    EMIT events → outbox → RabbitMQ:                  │    │
│  │    ├── conversation.message.created                  │    │
│  │    │   { message_id, conversation_id, account_id }  │    │
│  │    └── conversation.created (if new conversation)   │    │
│  │        { conversation_id, account_id, channel_id,   │    │
│  │          contact_identifier, status }               │    │
│  │                                                     │    │
│  │    All within a single DB transaction:               │    │
│  │    message INSERT + conversation UPDATE +            │    │
│  │    outbox INSERT → commit → pg_notify               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ACK RabbitMQ message                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
    │
    │ RabbitMQ (outbox_worker publishes events)
    ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: REALTIME PUSH TO AGENTS                          │
│  (See 05-REALTIME-PUSH.md for full details)                │
│                                                             │
│  realtime_push_worker consumes from "realtime.events"       │
│                                                             │
│  conversation.created event:                                │
│    → push to room "account:{account_id}"                    │
│    → all agents in the account see new conversation         │
│                                                             │
│  conversation.message.created event:                        │
│    → push to room "conv:{conversation_id}"                  │
│      (agents who have this conversation open)               │
│    → push to room "account:{account_id}"                    │
│      (inbox updates — last_message_at, unread count)        │
│                                                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │ Agent Browser                                    │       │
│  │                                                  │       │
│  │ Inbox view: sees new conversation appear          │       │
│  │ Chat view: sees new message in active thread     │       │
│  │ Both via WebSocket push from API Gateway         │       │
│  └──────────────────────────────────────────────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Timing Summary

```
Customer sends WhatsApp/Telegram message
    │
    ├── 0ms      Provider receives message
    ├── ~100ms   Provider calls webhook
    ├── ~101ms   KrakenD receives POST /v1/webhooks/{type}/{channel_id}
    ├── ~102ms   HMAC verified + payload parsed
    ├── ~103ms   Return 200 OK to provider
    ├── ~108ms   Published to RabbitMQ "conversation.inbound" queue
    │
    │            ── webhook done, inbound_message_worker picks up ──
    │
    ├── ~120ms   Worker consumes message
    ├── ~120ms   Extract sender identifier
    ├── ~130ms   Contact lookup (Account API internal)
    ├── ~132ms   Load configs (cached hit)
    ├── ~135ms   Evaluate configs (source + audience checks)
    ├── ~150ms   Ensure contact exists (create if needed)
    ├── ~165ms   Find/create conversation (DB query + possible insert)
    ├── ~185ms   Insert message + update conversation + outbox + commit
    │
    │            ── outbox_worker publishes to RabbitMQ ──
    │
    ├── ~235ms   realtime_push_worker consumes event
    ├── ~240ms   Query DynamoDB for room subscribers
    ├── ~245ms   Push to @connections (agents)
    │
    └── ~250ms   Agent sees message in inbox
```

**Total end-to-end: ~150-300ms** from provider webhook to agent seeing the message.
The bottleneck is the async worker pipeline (RabbitMQ consume → process → emit → push).

---

## Sequence Diagram

```
Customer       Provider       KrakenD      Messaging API     RabbitMQ     inbound_worker    Account API     DynamoDB      Agent Browser
   │               │             │              │               │              │                │              │               │
   │──message──►   │             │              │               │              │                │              │               │
   │               │──webhook──► │              │               │              │                │              │               │
   │               │             │──POST────►   │               │              │                │              │               │
   │               │             │              │               │              │                │              │               │
   │               │             │              │──verify sig───│              │                │              │               │
   │               │             │              │──parse────────│              │                │              │               │
   │               │             │  ◄──200 OK── │               │              │                │              │               │
   │               │  ◄──200──── │              │               │              │                │              │               │
   │               │             │              │──publish──►   │              │                │              │               │
   │               │             │              │               │──consume──►  │                │              │               │
   │               │             │              │               │              │                │              │               │
   │               │             │              │               │              │──lookup────►   │              │               │
   │               │             │              │               │              │  ◄──contact──  │              │               │
   │               │             │              │               │              │                │              │               │
   │               │             │              │               │              │──load configs──│              │               │
   │               │             │              │               │              │──evaluate──────│              │               │
   │               │             │              │               │              │                │              │               │
   │               │             │              │               │              │──create contact│(if needed)   │               │
   │               │             │              │               │              │  ◄──contact_id─│              │               │
   │               │             │              │               │              │                │              │               │
   │               │             │              │               │              │──find/create conv──           │               │
   │               │             │              │               │              │──insert message────           │               │
   │               │             │              │               │              │──emit events → │              │               │
   │               │             │              │               │              │                │              │               │
   │               │             │              │               │              │                │              │               │
   │               │             │              │  realtime_push_worker consumes event          │               │
   │               │             │              │───────────────│──────────────│────────────────│──query rooms►│               │
   │               │             │              │               │              │                │  ◄──conns──  │               │
   │               │             │              │───────────────│──────────────│────────────────│──────────────│──push event──►│
   │               │             │              │               │              │                │              │               │
```

---

## Error Handling

| Error | Where | Behavior |
|-------|-------|----------|
| HMAC signature invalid | Webhook router | Return 401, log, do not publish to RabbitMQ |
| Channel adapter parse fails | Webhook router | Return 200 (don't let provider retry), log error, publish to DLQ |
| Account API `/internal/contacts/lookup` timeout | inbound_worker | Retry 3x with backoff, then DLQ |
| Account API `/internal/contacts/create` fails | inbound_worker | Retry 3x, then DLQ. Contact creation is idempotent (phone/email unique per account) |
| No matching config found | inbound_worker | Store message for delivery tracking, log as "unqualified inbound". No conversation created. ACK message. |
| DB transaction fails (message insert) | inbound_worker | Retry 3x with backoff, then DLQ. Outbox pattern ensures atomicity. |
| realtime_push_worker push fails | push_worker | Handle `GoneException` (410) — clean up stale connection from DynamoDB. Other errors → retry. |

---

## Key Data Flows

### What Gets Created

| Condition | Records Created |
|-----------|----------------|
| Config matched, no existing conversation, creation_mode="auto" | 1 Conversation + 1 Message + outbox events |
| Config matched, active conversation exists | 1 Message + outbox events |
| Config matched, resolved conversation, reopen_policy="reopen" | 1 Message + conversation status update + outbox events |
| Config matched, creation_mode="manual" | 1 Message (conversation_id=NULL, pending_thread=true) |
| No config matched | 0 records (message logged for delivery tracking only) |

### Account API Calls (Internal)

| Step | Endpoint | When Called |
|------|----------|-------------|
| Contact lookup | `POST /internal/contacts/lookup` | Always (step 6) |
| Group membership check | `POST /internal/contacts/check-membership` | Only if config.audience_mode is "groups" or "allowlist" |
| Contact creation | `POST /internal/contacts/create` | Only if contact not found AND matched config.audience_mode is "all" |
