# Omnichannel Conversations — Architecture

> Complete architecture for real-time customer support conversations in Turumba 2.0. Agents converse with customers across WhatsApp, Telegram, Messenger, SMS, and Email — with bot-first routing, intelligent agent assignment, and real-time push via AWS API Gateway WebSocket.

---

## 1. Overview

### What This System Does

1. **Inbound**: Customer sends a message on any channel → webhook → create/resume a Conversation thread → bot evaluates rules → assign to agent → push to agent's browser in real time
2. **Outbound**: Agent replies in the inbox → create Message → dispatch via channel adapter → customer receives reply on their platform → push update to all viewing agents
3. **Automation**: Bot rules auto-reply, auto-label, auto-assign based on keywords, time-of-day, channel, and (future) AI intent classification

### Key Design Principle

Every message — whether from a customer, agent, bot, or system — is stored as a normal `Message` record in the existing `messages` table, with a `conversation_id` linking it to a thread. All existing message features (group messaging, scheduled, templates, broadcast) continue working unchanged.

### Service Ownership

| Domain | Service | Rationale |
|---|---|---|
| Conversation, ContactIdentifier, CannedResponse, BotRule | Messaging API | Conversations are messaging domain — same DB as channels, messages, templates |
| AgentPreference | Account API | Agent preferences are user profile data — sits alongside users, roles, account_users |
| WebSocket connections, push delivery | AWS (API Gateway + Lambda + DynamoDB) | Managed infrastructure — no new service to operate |
| `realtime_push_worker` | Messaging API | Python worker bridging RabbitMQ → AWS WebSocket push (same pattern as existing workers) |

---

## 2. System Diagram

```
                          ┌──────────────────────┐
                          │    Customer Device    │
                          │  (WhatsApp/Telegram/  │
                          │   Messenger/SMS/etc)  │
                          └──────────┬───────────┘
                                     │
                          Platform Provider (Meta, Telegram, Twilio...)
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        KrakenD Gateway (:8080)                         │
│                                                                        │
│  POST /v1/webhooks/{type}/{id}  ──→  Messaging API                     │
│  GET/PATCH /v1/conversations/*  ──→  Messaging API                     │
│  GET/PATCH /v1/agent-prefs/*    ──→  Account API                       │
└────────────────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────┐    ┌──────────────────┐
│ Account API │    │  Messaging API   │
│             │    │                  │
│ Users       │    │ Channels         │
│ Accounts    │    │ Conversations    │     ┌─────────────────────────┐
│ Roles       │    │ Messages         │     │  AWS WebSocket Stack    │
│ Contacts    │    │ Templates        │     │                         │
│ AgentPrefs  │    │ CannedResponses  │     │  API Gateway (WSS)     │
│             │    │ BotRules         │     │    ├ $connect → Lambda  │
│ Called by   │    │ ContactIdents    │     │    ├ $disconnect → Λ   │
│ Messaging   │    │ GroupMessages    │     │    ├ subscribe → Λ     │
│ API for:    │    │ ScheduledMsgs    │     │    ├ typing → Λ        │
│ - contacts  │    │ OutboxEvents     │     │    └ presence → Λ      │
│ - agent     │    │                  │     │                         │
│   prefs     │    │ Workers:         │     │  DynamoDB               │
│ - user info │    │  outbox_worker ──────→ RabbitMQ                  │
└─────────────┘    │  realtime_push ←─────── ║ ──→ ws_connections    │
                   │  dispatch_worker│     │       ws_subscriptions  │
                   │  group_msg_proc │     │       ws_presence       │
                   │  inbound_worker │     │                         │
                   │  schedule_trig  │     │  Push via @connections  │
                   │  status_update  │     │         │               │
                   └──────────────────┘     │         ▼               │
                              │             │  Agent Browser (WSS)    │
                    ┌─────────┘             └─────────────────────────┘
                    ▼
              ┌──────────┐
              │PostgreSQL│
              │          │
              │ channels │
              │ convos   │
              │ messages │
              │ bot_rules│
              │ canned   │
              │ contact_ │
              │  idents  │
              │ outbox   │
              └──────────┘
```

---

## 3. Data Models — Messaging API

### 3.1 `conversations`

```
conversations
├── id                   UUID PK (from PostgresBaseModel)
├── account_id           UUID NOT NULL (tenant isolation, from gateway header)
├── channel_id           UUID NOT NULL (FK → channels)
├── contact_id           UUID NOT NULL (references Account API contact, not a local FK)
├── contact_identifier   String(255) NOT NULL — platform-specific ID (phone, telegram user id, PSID)
├── assignee_id          UUID nullable — current agent (user_id from Account API)
├── team_id              UUID nullable — assigned team
├── status               String(20) NOT NULL default "open"
│                        CHECK IN ('open', 'bot', 'assigned', 'pending', 'resolved', 'closed')
├── priority             String(10) NOT NULL default "normal"
│                        CHECK IN ('low', 'normal', 'high', 'urgent')
├── subject              String(255) nullable — auto-generated or agent-set
├── labels               JSONB default [] — ["billing", "technical"]
├── first_reply_at       DateTime(tz) nullable — SLA: time of first agent reply
├── resolved_at          DateTime(tz) nullable
├── last_message_at      DateTime(tz) nullable — drives inbox sort order
├── bot_context          JSONB nullable — context collected by bot before handoff
├── metadata_            JSONB default {}
├── created_at / updated_at (from PostgresBaseModel)
│
├── INDEX(account_id, status, assignee_id) — inbox queries
├── INDEX(account_id, last_message_at DESC) — sorted inbox
```

#### Status Lifecycle

```
open ──→ bot ──→ assigned ──→ pending ──→ resolved ──→ closed
  │              ↑    │         │           │
  │              │    └─────────┘           │
  └──────────────┘    (agent sets pending   │
  (if no bot rules    while waiting for     │
   or direct assign)  customer reply)       │
                                            │
  Customer sends new message after resolved ─┘──→ reopens as "open"
```

Valid transitions:
- `open` → `bot`, `assigned`, `closed`
- `bot` → `assigned`, `closed`
- `assigned` → `pending`, `resolved`, `closed`
- `pending` → `assigned`, `resolved`, `closed`
- `resolved` → `open` (reopen), `closed`
- `closed` → terminal (no transitions)

### 3.2 `messages` — Extended Columns

Add to the existing `messages` model (all nullable — broadcast messages continue working unchanged):

```
messages (existing table — add columns)
├── conversation_id   UUID nullable (FK → conversations, indexed)
├── is_private        Boolean NOT NULL default false — internal notes visible only to agents
├── sender_type       String(20) nullable — "contact", "agent", "bot", "system"
│                     CHECK (sender_type IS NULL OR sender_type IN ('contact', 'agent', 'bot', 'system'))
├── sender_id         UUID nullable — agent user_id or bot_rule_id
```

### 3.3 `contact_identifiers`

Solves the "same customer contacts us on WhatsApp AND Telegram" problem — both map to the same `contact_id`.

```
contact_identifiers
├── id             UUID PK
├── account_id     UUID NOT NULL
├── contact_id     UUID NOT NULL — references Account API contact
├── channel_type   String(20) NOT NULL
│                  CHECK IN ('telegram', 'whatsapp', 'messenger', 'sms', 'smpp', 'email')
├── identifier     String(255) NOT NULL — phone number, telegram user_id, PSID, email
├── display_name   String(255) nullable — platform display name
├── metadata_      JSONB default {}
├── created_at / updated_at
│
├── UNIQUE(account_id, channel_type, identifier)
├── INDEX(contact_id)
```

### 3.4 `canned_responses`

Pre-saved reply snippets for agent quick replies.

```
canned_responses
├── id           UUID PK
├── account_id   UUID NOT NULL
├── short_code   String(50) NOT NULL — "/greeting", "/refund"
├── title        String(255) NOT NULL
├── content      Text NOT NULL — supports {{contact_name}} variables
├── category     String(100) nullable — "greetings", "billing", "closings"
├── created_by   UUID nullable
├── metadata_    JSONB default {}
├── created_at / updated_at
│
├── UNIQUE(account_id, short_code)
```

### 3.5 `bot_rules`

Configurable auto-routing rules evaluated in priority order against inbound messages.

```
bot_rules
├── id             UUID PK
├── account_id     UUID NOT NULL
├── name           String — "After Hours Routing", "Billing Keywords"
├── priority       Integer — evaluation order (lower = first)
├── is_active      Boolean default true
├── trigger_type   String NOT NULL
│                  CHECK IN ('keyword', 'time_based', 'channel', 'new_conversation', 'fallback')
├── conditions     JSONB
│     {
│       "keywords": ["refund", "return", "cancel"],
│       "match_mode": "any",                          -- any | all
│       "channels": ["whatsapp", "telegram"],         -- optional channel filter
│       "time_range": { "start": "18:00", "end": "08:00", "tz": "Africa/Addis_Ababa" }
│     }
├── actions        JSONB
│     {
│       "reply_template_id": "uuid",                  -- send template as auto-reply
│       "reply_text": "We're offline right now...",   -- OR static text
│       "assign_team_id": "uuid",                     -- route to team
│       "assign_strategy": "round_robin",             -- round_robin | least_busy | manual_queue
│       "set_labels": ["billing"],                    -- auto-label
│       "set_priority": "high"                        -- auto-priority
│     }
├── created_at / updated_at
│
├── INDEX(account_id, is_active, priority)
```

---

## 4. Data Models — Account API

### 4.1 `agent_preferences`

One row per user (user-scoped, not account-scoped). An agent's working hours, language skills, and availability are personal traits that don't change per workspace.

```
agent_preferences
├── id                            UUID PK
├── user_id                       UUID FK → users.id (UNIQUE — one-to-one)
├── available_channels            JSONB [] — ["whatsapp", "telegram", "sms"]
├── available_topics              JSONB [] — ["billing", "technical", "general"]
├── available_hours               JSONB
│     {
│       "schedule": [
│         { "days": ["mon","tue","wed","thu","fri"], "start": "09:00", "end": "17:00" },
│         { "days": ["sat"], "start": "09:00", "end": "13:00" }
│       ],
│       "timezone": "Africa/Addis_Ababa"
│     }
├── languages                     JSONB [] — ["en", "am"]
├── max_concurrent_conversations  Integer default 5
├── is_available                  Boolean default true — manual online/offline toggle
├── auto_accept                   Boolean default false — auto-accept assigned conversations
├── notification_preferences      JSONB
│     {
│       "sound": true,
│       "desktop": true,
│       "email_on_assignment": false
│     }
├── created_at / updated_at
```

---

## 5. Real-Time Infrastructure — AWS API Gateway WebSocket

### 5.1 Why AWS WebSocket (Not Socket.IO)

| Dimension | Socket.IO + Redis (original plan) | AWS API Gateway WebSocket |
|-----------|-----------------------------------|---------------------------|
| New services to operate | Node.js app + Redis | None (managed) |
| Languages in stack | Adds Node.js/TypeScript | Stays Python-only |
| Scaling | Manual (instances + Redis adapter) | Automatic (AWS-managed) |
| Cost (100 agents) | ~$15-45/mo (containers always on) | ~$2/mo (pay per use) |
| Cost (1000 agents) | ~$50-100/mo | ~$20/mo |
| Local dev | Easy (run Node.js locally) | Needs local WS server shim |
| Client library | socket.io-client (47KB) | Native WebSocket API (0KB) |
| Rooms/namespaces | Built-in | DIY via DynamoDB subscriptions |
| Reconnection | Built-in with polling fallback | Client-side reconnect logic |

### 5.2 Architecture

```
Agent Browser (Next.js)
    │ wss://
    ▼
AWS API Gateway (WebSocket API)
    │ Routes:
    │   $connect    → Lambda: validate JWT, store connection in DynamoDB
    │   $disconnect → Lambda: cleanup connection + subscriptions, update presence
    │   subscribe   → Lambda: validate room access, add to ws_subscriptions
    │   typing      → Lambda: query room connections, relay typing indicator
    │   presence    → Lambda: update presence, broadcast to account rooms
    │
    │                              ┌──────────────────────┐
    │  Lambdas read/write ────────→│  DynamoDB Tables      │
    │                              │  ws_connections       │
    │                              │  ws_subscriptions     │
    │                              │  ws_presence          │
    │                              └───────────┬──────────┘
    │                                          │
    │  ┌───────────────────────────────────────┤
    │  │  realtime_push_worker (Python)         │ reads subscriptions
    │  │  (same pattern as existing workers)    │
    │  │                                        │
    │  │  RabbitMQ ──consume──→ Route event     │
    │  │                        │               │
    │  │                        ▼               │
    │  │              Query DynamoDB for room   │
    │  │                        │               │
    │  │                        ▼               │
    │  │              POST @connections/{id} ───┘
    │  │              (API Gateway Management API)
    │  └────────────────────────────────────────┘
```

### 5.3 DynamoDB Tables

**`ws_connections`** — Connection registry

| Attribute | Type | Notes |
|-----------|------|-------|
| `connection_id` (PK) | String | API Gateway connection ID |
| `user_id` | String | Cognito user sub |
| `email` | String | |
| `account_ids` | StringSet | From JWT claims |
| `connected_at` | String (ISO) | |
| `ttl` | Number | 24h epoch — auto-cleanup |

GSI: `user_id-index` (PK: `user_id`) — find all connections for a user.

**`ws_subscriptions`** — Room membership (replaces Socket.IO rooms)

| Attribute | Type | Notes |
|-----------|------|-------|
| `room` (PK) | String | `"account:{uuid}"`, `"conv:{uuid}"`, `"user:{uuid}"` |
| `connection_id` (SK) | String | |
| `user_id` | String | |
| `subscribed_at` | String (ISO) | |
| `ttl` | Number | 24h epoch |

GSI: `connection_id-index` (PK: `connection_id`) — cleanup all subscriptions on disconnect.

**`ws_presence`** — Agent presence (replaces Redis)

| Attribute | Type | Notes |
|-----------|------|-------|
| `account_id` (PK) | String | |
| `user_id` (SK) | String | |
| `status` | String | `online`, `away`, `offline` |
| `last_seen` | String (ISO) | |
| `connection_count` | Number | Active connections for this user |
| `ttl` | Number | 5min epoch — heartbeat refresh |

### 5.4 Lambda Functions

All Python 3.12. Connection lifecycle only — no business logic.

| Lambda | Route | What It Does |
|--------|-------|-------------|
| `ws-connect` | `$connect` | Parse `?token=<JWT>` query param, validate Cognito JWT (RS256), extract user_id + account_ids, store in `ws_connections`, auto-subscribe to `user:{user_id}` room |
| `ws-disconnect` | `$disconnect` | Query `connection_id-index` on `ws_subscriptions` → batch delete all subscriptions. Delete from `ws_connections`. Decrement presence `connection_count`, set `offline` if zero |
| `ws-subscribe` | `subscribe` | Payload: `{ room: "account:uuid" }` or `{ room: "conv:uuid" }`. Validate user has access to the room (account_ids check). Put item in `ws_subscriptions` |
| `ws-typing` | `typing` | Payload: `{ conversation_id, typing: bool }`. Query `ws_subscriptions` for room `conv:{id}` → POST `@connections/{conn_id}` for each (skip sender) |
| `ws-presence` | `presence` | Payload: `{ status: "online"/"away"/"offline" }`. Update `ws_presence` table. Query `ws_subscriptions` for all `account:*` rooms the user belongs to → broadcast presence to those connections |

### 5.5 `realtime_push_worker`

New Python worker in the Messaging API. Follows the exact same pattern as `dispatch_worker`, `inbound_message_worker`, etc.

**File:** `turumba_messaging_api/src/workers/realtime_push_worker.py`

```
Consumes from: "realtime.events" queue (on "messaging" exchange)
Bindings:
  - conversation.created
  - conversation.assigned
  - conversation.status_changed
  - conversation.resolved
  - conversation.message.created
  - conversation.message.sent

For each event:
  1. Parse event payload → extract account_id, conversation_id, etc.
  2. Determine target rooms:
     - conversation.created        → ["account:{account_id}"]
     - conversation.message.*      → ["conv:{conversation_id}", "account:{account_id}"]
     - conversation.assigned       → ["user:{assignee_id}", "account:{account_id}"]
     - conversation.status_changed → ["account:{account_id}"]
     - conversation.resolved       → ["account:{account_id}"]
  3. For each room: query DynamoDB ws_subscriptions (PK = room)
  4. For each connection_id: POST @connections/{id} via API Gateway Management API
     - Payload: JSON event (same shape as the original Socket.IO payloads)
  5. Handle GoneException (410) → connection is stale, delete from ws_connections + ws_subscriptions
  6. ACK the RabbitMQ message
```

Uses `boto3` for DynamoDB and API Gateway Management API calls. Requires `WS_API_ENDPOINT` (the API Gateway callback URL) and `WS_CONNECTIONS_TABLE`, `WS_SUBSCRIPTIONS_TABLE` in config.

### 5.6 WebSocket Events

**Server → Client (push via realtime_push_worker):**

| Event Type | Target Room | Payload |
|---|---|---|
| `conversation:new` | `account:{id}` | `{ conversation_id, channel_id, contact_identifier, status, created_at }` |
| `conversation:updated` | `account:{id}` + `conv:{id}` | `{ conversation_id, status?, assignee_id?, labels?, priority?, last_message_at? }` |
| `conversation:message` | `conv:{id}` | `{ conversation_id, message_id, sender_type, message_body, is_private, created_at }` |
| `conversation:typing` | `conv:{id}` | `{ user_id, typing: bool }` |
| `agent:presence` | `account:{id}` | `{ user_id, status: "online"/"away"/"offline" }` |
| `notification:assignment` | `user:{assignee_id}` | `{ conversation_id, assigned_by, rule_name? }` |

**Client → Server (via WebSocket frames to API Gateway routes):**

| Action | Payload | Effect |
|---|---|---|
| `subscribe` | `{ room: "account:{id}" }` | Join account room for inbox updates |
| `subscribe` | `{ room: "conv:{id}" }` | Join conversation room for live messages |
| `unsubscribe` | `{ room: "conv:{id}" }` | Leave conversation room |
| `typing` | `{ conversation_id, typing: bool }` | Relay typing indicator to others in room |
| `presence` | `{ status: "online"/"away"/"offline" }` | Set own presence |

### 5.7 Authentication

- On `$connect`, the client passes the Cognito JWT as `?token=<JWT>` query parameter
- The `ws-connect` Lambda validates the token against the Cognito JWKS endpoint (RS256)
- Extracts `sub` (user_id), `email`, and `custom:account_ids` from token claims
- Stores these in the `ws_connections` DynamoDB table
- On token refresh (near expiry), the frontend gracefully disconnects and reconnects with the new token

### 5.8 Local Development

**`turumba_messaging_api/src/dev/local_ws_server.py`** — A lightweight FastAPI WebSocket endpoint that mimics the AWS API Gateway behavior with in-memory dictionaries for connections, subscriptions, and presence. Runs alongside the Messaging API during development.

The `realtime_push_worker` config supports a `LOCAL_WS_MODE=true` flag that sends messages to the local WebSocket server instead of calling AWS APIs.

### 5.9 Deployment

Manual AWS Console setup first to validate the approach:
1. Create API Gateway WebSocket API
2. Create DynamoDB tables with GSIs
3. Create Lambda functions with IAM roles
4. Configure routes ($connect, $disconnect, subscribe, typing, presence)
5. Deploy and test with a simple WebSocket client

Codify later with CloudFormation, CDK, SAM, or Terraform once validated.

---

## 6. Bot-First Routing System

The bot acts as a first responder — every inbound message hits the bot engine before reaching a human agent.

### 6.1 Phase 1: Rule-Based Router (MVP — No AI Required)

```
BotRules evaluated in priority order:

Rule 1: Time-based routing
  IF time is outside business hours (18:00–08:00 EAT)
  THEN reply with "We're offline" template + queue for morning

Rule 2: Channel + keyword routing
  IF channel == "whatsapp" AND keywords contain ["order", "delivery"]
  THEN assign to team: "logistics"

Rule 3: Keyword matching
  IF message contains ["refund", "return", "cancel"]
  THEN reply with refund policy template + assign to team: "billing"

Rule 4: Fallback
  THEN reply with "An agent will be with you shortly" + assign round-robin
```

### 6.2 Agent Routing Algorithm

```
1. Filter eligible agents by:
   - is_available == true
   - current time within available_hours (respect timezone)
   - channel matches available_channels
   - topic matches available_topics (from bot classification or labels)
   - active_conversations < max_concurrent_conversations
   - language matches (if detected)

2. Sort by:
   - Least active conversations (load balance)
   - Longest idle time (fairness)

3. Assign to top candidate
   - If no candidate → queue with position indicator
   - If high priority → notify team lead
```

### 6.3 Phase 2: AI-Powered Intent Classification (Future)

```
[Inbound Message] → [Intent Classifier Service]
   - LLM or fine-tuned model classifies intent
   - Returns: { intent: "billing_inquiry", confidence: 0.85, entities: {...} }
   - BotRules can match on intent + confidence threshold
```

### 6.4 Phase 3: Conversational Bot (Future)

Multi-turn bot conversations, knowledge base FAQ lookup, handoff criteria (customer asks for human, confidence drops, sensitive topic, 3+ turns without resolution).

---

## 7. End-to-End Flows

### 7.1 Inbound Customer Message

```
1. Customer sends "I want a refund" on WhatsApp
                    │
2. Meta webhook ──→ POST /v1/webhooks/whatsapp/{channel_id}
                    │
3. Webhook Receiver (Messaging API)
   ├── Verify HMAC signature
   ├── Parse payload via WhatsAppAdapter
   ├── Return 200 immediately
   └── Enqueue: conversation.inbound → RabbitMQ
                    │
4. Inbound Worker (RabbitMQ consumer)
   ├── Lookup ContactIdentifier by (whatsapp, phone_number)
   │   ├── Found → get contact_id
   │   └── Not found → call Account API to create contact → create ContactIdentifier
   ├── Find open Conversation for this contact + channel
   │   ├── Found → append message to existing conversation
   │   └── Not found → create new Conversation (status: open)
   ├── Create Message (direction: inbound, sender_type: contact, conversation_id: X)
   ├── Update conversation.last_message_at
   └── Emit: conversation.message.created → outbox → RabbitMQ
                    │
5. Bot Router (RabbitMQ consumer)
   ├── Load BotRules for account (ordered by priority)
   ├── Evaluate rules against message:
   │   ├── Rule "Billing Keywords" (priority 1):
   │   │   conditions: { keywords: ["refund", "return"], match_mode: "any" }
   │   │   ✅ MATCH — "refund" found
   │   │   actions:
   │   │     reply_template_id: "refund_policy_template"
   │   │     assign_team_id: "billing_team_id"
   │   │     set_labels: ["billing", "refund"]
   │   │     set_priority: "high"
   ├── Execute actions:
   │   ├── Create Message (direction: outbound, sender_type: bot, content: template)
   │   ├── Dispatch reply via WhatsAppAdapter
   │   ├── Fetch eligible agents from Account API:
   │   │   GET /v1/agent-preferences?available_topics=billing&is_available=true
   │   ├── Assign to best agent → conversation.assignee_id = agent_id
   │   ├── Update conversation.status = "assigned"
   │   └── Emit: conversation.assigned → outbox → RabbitMQ
                    │
6. realtime_push_worker (consumes conversation.*)
   ├── conversation.message.created →
   │   query DynamoDB for room "conv:{X}" → push to agents viewing this thread
   │   query DynamoDB for room "account:{id}" → push inbox update to all agents
   ├── conversation.assigned →
   │   query DynamoDB for room "user:{assignee_id}" → push assignment notification
   └── Agent's browser receives WebSocket frame → UI updates
                    │
7. Agent opens conversation in inbox
   ├── GET /v1/conversations/{id} → conversation detail
   ├── GET /v1/conversations/{id}/messages → message history
   ├── WebSocket: subscribe to room "conv:{id}"
   ├── Sees: customer message "I want a refund"
   ├── Sees: bot reply with refund policy template
   └── Sees: labels ["billing", "refund"], priority: high
```

### 7.2 Agent Reply

```
1. Agent types reply → WebSocket frame { action: "typing", conversation_id: X }
   → ws-typing Lambda relays to other agents in conv room

2. Agent sends → POST /v1/conversations/{id}/messages { content: "..." }
   ├── Message created (direction: outbound, sender_type: agent)
   ├── conversation.first_reply_at set if first agent reply (SLA metric)
   ├── conversation.last_message_at updated
   ├── Dispatched via WhatsAppAdapter to customer's phone
   └── Emit: conversation.message.sent → outbox → RabbitMQ

3. realtime_push_worker → pushes to room "conv:{X}" + "account:{id}"

4. Customer receives reply on WhatsApp
```

### 7.3 Internal Notes

```
Agent sends → POST /v1/conversations/{id}/messages { content: "...", is_private: true }
├── Message created (is_private: true)
├── NOT dispatched to customer (internal note)
├── Emit: conversation.message.created (with is_private: true)
└── realtime_push_worker pushes to agents in conv room only
```

### 7.4 Conversation Lifecycle

```
Agent inbox queries:
  GET /v1/conversations?status=open&assignee_id=me               — my open conversations
  GET /v1/conversations?status=assigned&team_id=billing           — team view
  GET /v1/conversations?status=bot                                — bot-handled, may need takeover
  GET /v1/conversations?sort=last_message_at:desc                 — sorted by latest activity

Agent picks up unassigned:
  PATCH /v1/conversations/{id} { assignee_id: agent_id }
  → status changes to "assigned"
  → Event: conversation.assigned → realtime push

Agent sets pending (waiting for customer):
  PATCH /v1/conversations/{id} { status: "pending" }

Agent resolves:
  PATCH /v1/conversations/{id} { status: "resolved" }
  → resolved_at timestamp set

Customer sends new message after resolved → conversation reopens as "open"
```

---

## 8. API Surface

### 8.1 New Messaging API Endpoints

```
# Conversations
POST   /v1/conversations/                      # Create (usually done by inbound worker)
GET    /v1/conversations/                       # List with filters (inbox view)
GET    /v1/conversations/{id}                   # Detail
PATCH  /v1/conversations/{id}                   # Update status, assignee, labels, priority
DELETE /v1/conversations/{id}                   # Soft-close (set status to closed)

# Conversation Messages (nested)
POST   /v1/conversations/{id}/messages          # Agent reply / internal note
GET    /v1/conversations/{id}/messages          # Message history (paginated, chronological)

# Canned Responses
POST   /v1/canned-responses/
GET    /v1/canned-responses/
GET    /v1/canned-responses/{id}
PATCH  /v1/canned-responses/{id}
DELETE /v1/canned-responses/{id}

# Bot Rules
POST   /v1/bot-rules/
GET    /v1/bot-rules/
GET    /v1/bot-rules/{id}
PATCH  /v1/bot-rules/{id}
DELETE /v1/bot-rules/{id}

# Contact Identifiers
POST   /v1/contact-identifiers/
GET    /v1/contact-identifiers/
GET    /v1/contact-identifiers/{id}
PATCH  /v1/contact-identifiers/{id}
DELETE /v1/contact-identifiers/{id}
```

### 8.2 New Account API Endpoints

```
GET    /v1/agent-preferences/me         — get own preferences
PATCH  /v1/agent-preferences/me         — update own preferences
GET    /v1/agent-preferences/           — list all (admin, for routing engine)
GET    /v1/agent-preferences/{user_id}  — get specific (admin/system)
```

### 8.3 New Gateway Routes

All endpoints above need KrakenD endpoint definitions in `config/partials/endpoints/`:
- `conversations.json` — targets Messaging API
- `canned-responses.json` — targets Messaging API
- `bot-rules.json` — targets Messaging API
- `contact-identifiers.json` — targets Messaging API
- `agent-preferences.json` — targets Account API

All routes use `no-op` encoding, require authentication, and have context enrichment enabled.

---

## 9. Event Types

Add to `src/events/event_types.py` in the Messaging API:

```
# Conversation events (flow through existing outbox → RabbitMQ pipeline)
CONVERSATION_CREATED         = "conversation.created"
CONVERSATION_ASSIGNED        = "conversation.assigned"
CONVERSATION_STATUS_CHANGED  = "conversation.status_changed"
CONVERSATION_RESOLVED        = "conversation.resolved"
CONVERSATION_MESSAGE_CREATED = "conversation.message.created"
CONVERSATION_MESSAGE_SENT    = "conversation.message.sent"
```

RabbitMQ topology addition:
- New queue: `realtime.events` (durable) on the `messaging` exchange
- Bindings: all `conversation.*` patterns listed above

---

## 10. Service-to-Service Communication

The Messaging API needs data from the Account API during bot routing (agent preferences, contact lookup).

### Phase 1: Synchronous HTTP (MVP)

```
Messaging API ──HTTP──→ Account API (internal, not through gateway)
  GET http://gt_turumba_account_api:8000/v1/agent-preferences?is_available=true
  GET http://gt_turumba_account_api:8000/v1/contacts?phone=+251...
```

Uses Docker network DNS. Lightweight HTTP client with retry and circuit breaker.

### Phase 2: Cache + Event Sync (Scale)

```
Account API ──→ RabbitMQ (agent.preference.updated, contact.created)
Messaging API ──→ consumes events, caches in Redis/local
Routing engine queries cache instead of HTTP
```

---

## 11. Frontend Integration

### 11.1 WebSocket Manager

`turumba_web_core/apps/turumba/lib/realtime/websocket-manager.ts`

Singleton wrapper around the native `WebSocket` API:
- Connect with Cognito JWT as query param
- Auto-reconnect with exponential backoff
- Room subscription management (subscribe/unsubscribe)
- Event dispatch to registered listeners
- Heartbeat/keepalive
- Graceful disconnect on token refresh

### 11.2 React Hook

`turumba_web_core/apps/turumba/lib/realtime/use-realtime.ts`

```typescript
// Subscribe to events for a specific conversation
const { messages, typing } = useConversationRealtime(conversationId);

// Subscribe to inbox updates
const { newConversations, updatedConversations } = useInboxRealtime(accountId);

// Subscribe to agent presence
const { presenceMap } = usePresenceRealtime(accountId);
```

### 11.3 Existing Frontend Components

The ConversationTab, ConversationSidebar, ConversationChatView, and ContactInfoPanel components are already built with mock data. They need to be wired to:
- Real REST API calls (conversations, messages)
- WebSocket events (new messages, typing, presence)
- React Query for server state management

---

## 12. Implementation Phases

### Phase 1: Conversation Foundation — P0

**Goal:** Core data layer — conversations exist, messages link to them, agents have preferences.

| # | Task | Service |
|---|------|---------|
| 1 | Conversation model + full CRUD + status lifecycle | Messaging API |
| 2 | Extend Message model with conversation_id, is_private, sender_type, sender_id | Messaging API |
| 3 | Nested endpoint: POST/GET /v1/conversations/{id}/messages | Messaging API |
| 4 | ContactIdentifier model + full CRUD | Messaging API |
| 5 | CannedResponse model + full CRUD | Messaging API |
| 6 | Conversation event types + outbox wiring | Messaging API |
| 7 | AgentPreference model + CRUD + /me endpoint | Account API |
| 8 | Gateway route configuration for all new endpoints | Gateway |

### Phase 2: Bot Router + Agent Routing — P1

**Goal:** Inbound messages auto-create conversations, bot responds, agents get assigned.

| # | Task | Service |
|---|------|---------|
| 1 | BotRule model + CRUD + rule evaluation engine | Messaging API |
| 2 | Modify inbound_message_worker for conversation creation | Messaging API |
| 3 | Bot router worker (RabbitMQ consumer) | Messaging API |
| 4 | Agent routing algorithm with preference matching | Messaging API |
| 5 | Service-to-service HTTP client (Messaging → Account API) | Messaging API |
| 6 | Gateway routes for bot-rules endpoints | Gateway |

### Phase 3: Real-Time Infrastructure — P1

**Goal:** Live push notifications, typing indicators, agent presence.

| # | Task | Service |
|---|------|---------|
| 1 | AWS API Gateway WebSocket API + DynamoDB tables | AWS |
| 2 | Lambda functions (connect, disconnect, subscribe, typing, presence) | AWS |
| 3 | realtime_push_worker (RabbitMQ → DynamoDB → API Gateway push) | Messaging API |
| 4 | RabbitMQ topology: realtime.events queue + bindings | Messaging API |
| 5 | Local dev WebSocket server shim | Messaging API |

### Phase 4: Frontend Integration — P1

**Goal:** Wire existing mock UI to real APIs + WebSocket.

| # | Task | Service |
|---|------|---------|
| 1 | WebSocket manager + React hooks | Web Core |
| 2 | Conversation inbox (list, filters, real-time updates) | Web Core |
| 3 | Conversation chat view (messages, reply, internal notes) | Web Core |
| 4 | Typing indicators + agent presence | Web Core |
| 5 | Canned response picker in compose area | Web Core |
| 6 | Assignment notifications | Web Core |

### Phase 5: AI + Advanced Features — Future

- Intent classification integration (LLM-based)
- Multi-turn bot conversations
- Knowledge base for bot FAQ answers
- Bot → human handoff with context transfer
- CSAT survey after resolution
- SLA tracking + alerts
- Agent performance analytics

---

## 13. Summary of Changes Per Service

| Service | New Models | New Endpoints | Other Changes |
|---|---|---|---|
| **Messaging API** | Conversation, CannedResponse, BotRule, ContactIdentifier + extend Message | Conversations CRUD, Conv Messages, Canned Responses, Bot Rules, Contact Identifiers | Bot router worker, realtime_push_worker, agent routing logic, HTTP client to Account API |
| **Account API** | AgentPreference | `/v1/agent-preferences` CRUD + `/me` shortcut | New model, schemas, controller, router |
| **AWS** | — | WebSocket API (wss://) | API Gateway + 5 Lambdas + 3 DynamoDB tables |
| **Gateway** | — | — | Add routes for all new endpoints |
| **Web Core** | — | — | WebSocket manager, React hooks, wire conversation UI to real APIs |
