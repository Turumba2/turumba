# Customer Support — Omnichannel Conversation Architecture

> Refined architecture plan for enabling customer support in Turumba 2.0, where agents converse with customers across Telegram, WhatsApp, Messenger, SMS, Email — with bot-first routing and intelligent agent assignment.

## Service Ownership

| Domain | Service | Rationale |
|---|---|---|
| **Conversation, ConversationMessage, CannedResponse, BotRule, ContactIdentifier** | Messaging API | Conversations are messaging domain — same DB as channels, messages, templates |
| **AgentPreference** | Account API | Agent preferences are user profile data — sits alongside users, roles, account_users |
| **Real-Time Push** | turumba_realtime (NEW) | Separate lightweight Node.js/Socket.IO service, subscribes to RabbitMQ, pushes to connected clients |

---

## 1. Messaging API — New Models

### 1.1 `Conversation`

```
conversations
├── id                   UUID PK
├── account_id           UUID (tenant isolation, from gateway header)
├── channel_id           UUID FK → channels
├── contact_id           UUID (references Account API contact, not a local FK)
├── contact_identifier   String — platform-specific ID (phone number, telegram user id, PSID)
├── assignee_id          UUID nullable — current agent (user_id from Account API)
├── team_id              UUID nullable — assigned team
├── status               Enum: open → bot → assigned → pending → resolved → closed
├── priority             Enum: low | normal | high | urgent (default: normal)
├── subject              String nullable — auto-generated or agent-set
├── labels               JSONB [] — ["billing", "technical"]
├── first_reply_at       DateTime nullable — SLA: time of first agent reply
├── resolved_at          DateTime nullable
├── last_message_at      DateTime — drives inbox sort order
├── bot_context          JSONB nullable — context collected by bot before handoff
├── metadata_            JSONB
├── created_at / updated_at
│
├── UNIQUE(channel_id, contact_identifier, status NOT IN (closed, resolved))
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

### 1.2 `Message` Table — Extended Columns

Add to the existing `messages` model (nullable — broadcast messages continue working unchanged):

```
messages (existing table — add columns)
├── conversation_id   UUID FK → conversations (nullable)
├── is_private        Boolean default false — internal notes visible only to agents
├── sender_type       Enum: contact | agent | bot | system
├── sender_id         UUID nullable — agent user_id or bot_rule_id
```

### 1.3 `CannedResponse`

```
canned_responses
├── id           UUID PK
├── account_id   UUID
├── short_code   String — "/greeting", "/refund" (unique per account)
├── title        String
├── content      Text — supports {{contact_name}} variables
├── category     String nullable — "greetings", "billing", "closings"
├── created_by   UUID
├── created_at / updated_at
│
├── UNIQUE(account_id, short_code)
```

### 1.4 `BotRule`

```
bot_rules
├── id             UUID PK
├── account_id     UUID
├── name           String — "After Hours Routing", "Billing Keywords"
├── priority       Integer — evaluation order (lower = first)
├── is_active      Boolean default true
├── trigger_type   Enum: keyword | time_based | channel | new_conversation | fallback
├── conditions     JSONB
│     {
│       "keywords": ["refund", "return", "cancel"],
│       "match_mode": "any",                          -- any | all
│       "channels": ["whatsapp", "telegram"],         -- optional channel filter
│       "time_range": { "start": "18:00", "end": "08:00", "tz": "Africa/Addis_Ababa" },
│       "intent": "billing_inquiry",                  -- phase 2 (AI)
│       "confidence_min": 0.7                         -- phase 2 (AI)
│     }
├── actions        JSONB
│     {
│       "reply_template_id": "uuid",                  -- send template as auto-reply
│       "reply_text": "We're offline right now...",   -- OR static text
│       "assign_team_id": "uuid",                     -- route to team
│       "assign_strategy": "round_robin",             -- round_robin | least_busy | manual_queue
│       "set_labels": ["billing"],                    -- auto-label
│       "set_priority": "high",                       -- auto-priority
│       "collect_info": ["name", "order_number"]      -- phase 3: bot asks for info
│     }
├── created_at / updated_at
│
├── INDEX(account_id, is_active, priority)
```

### 1.5 `ContactIdentifier` — Cross-Platform Contact Resolution

Solves the "same customer contacts us on WhatsApp AND Telegram" problem — both map to the same `contact_id`.

```
contact_identifiers
├── id             UUID PK
├── account_id     UUID
├── contact_id     UUID — references Account API contact
├── channel_type   Enum: telegram | whatsapp | messenger | sms | email
├── identifier     String — phone number, telegram user_id, PSID, email
├── display_name   String nullable — platform display name
├── metadata_      JSONB — platform-specific profile info
├── created_at / updated_at
│
├── UNIQUE(account_id, channel_type, identifier)
├── INDEX(contact_id)
```

---

## 2. Account API — Agent Preferences

New `agent_preferences` table (one row per user, not per account):

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

**Why user-scoped not account-scoped:** An agent's working hours, language skills, and availability are personal traits that don't change per workspace. Can migrate to `account_user_preferences` later if multi-account variance is needed.

### New Endpoints

```
GET    /v1/agent-preferences/me         — get own preferences
PATCH  /v1/agent-preferences/me         — update own preferences
GET    /v1/agent-preferences            — list all (admin, for routing engine)
GET    /v1/agent-preferences/{user_id}  — get specific (admin/system)
```

---

## 3. turumba_realtime — Separate WebSocket Service

### What It Is

A standalone real-time event delivery service that bridges RabbitMQ domain events to connected browser clients via WebSocket. It does NOT handle any business logic — it is a pure event relay with auth and room management.

### Technology

**Node.js + Socket.IO** — chosen for:
- Native room/namespace support (per-account, per-conversation rooms)
- Automatic reconnection and fallback (WS → long-polling)
- Redis adapter for horizontal scaling across multiple instances
- Industry standard for real-time features

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    turumba_realtime (:3200)                    │
│                                                               │
│  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │ RabbitMQ     │────→│ Event        │────→│ Socket.IO    │   │
│  │ Consumer     │     │ Router       │     │ Server       │   │
│  │              │     │              │     │              │   │
│  │ Subscribes:  │     │ Maps events  │     │ Namespaces:  │   │
│  │ conversation.*│    │ to rooms &   │     │ /agents      │   │
│  │ message.*    │     │ namespaces   │     │ /customers   │   │
│  │ agent.*      │     │              │     │              │   │
│  └─────────────┘     └──────────────┘     │ Rooms:       │   │
│                                            │ account:{id} │   │
│  ┌─────────────┐                           │ conv:{id}    │   │
│  │ Redis        │                           │ user:{id}    │   │
│  │ (adapter)    │                           └──────────────┘   │
│  │              │                                              │
│  │ - Session    │     ┌──────────────┐                         │
│  │   store      │     │ Auth         │                         │
│  │ - Presence   │     │ Middleware   │                         │
│  │   tracking   │     │              │                         │
│  │ - Pub/Sub    │     │ Validates    │                         │
│  │   (multi-    │     │ JWT from     │                         │
│  │    instance) │     │ Cognito      │                         │
│  └─────────────┘     └──────────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| **RabbitMQ Consumer** | Subscribes to `conversation.*`, `message.*`, `agent.*` events from the `messaging` exchange |
| **Event Router** | Maps domain events to Socket.IO rooms/namespaces — determines which connected clients should receive each event |
| **Socket.IO Server** | Manages WebSocket connections, rooms, namespaces. Two namespaces: `/agents` (support dashboard) and `/customers` (embeddable widget, future) |
| **Auth Middleware** | Validates Cognito JWT on connection handshake. Extracts user_id, account_ids. Joins user to appropriate rooms |
| **Redis Adapter** | Socket.IO Redis adapter for multi-instance horizontal scaling. Also stores presence state and typing indicators |

### Redis Role

1. **Socket.IO adapter** — Multi-instance sync. Event published on instance A reaches clients on instance B via Redis Pub/Sub.
2. **Presence tracking** — `HSET agent:presence {user_id} {status}` with 60s TTL, refreshed by heartbeat.
3. **Typing indicators** — `SET typing:{conversation_id}:{user_id} 1 EX 5`

### Socket.IO Events

**Server → Client (push):**

| Event | Payload | Room |
|---|---|---|
| `conversation:new` | Conversation summary | `account:{id}` |
| `conversation:updated` | Status/assignee/label change | `account:{id}` + `conv:{id}` |
| `conversation:message` | New message content | `conv:{id}` |
| `conversation:typing` | Who is typing | `conv:{id}` |
| `agent:presence` | Agent online/offline/away | `account:{id}` |
| `notification:assignment` | Assignment details | `user:{assignee_id}` |
| `queue:update` | Queue position | `account:{id}` |

**Client → Server (actions):**

| Event | Payload | Effect |
|---|---|---|
| `conversation:join` | `{ conversation_id }` | Subscribe to conversation room |
| `conversation:leave` | `{ conversation_id }` | Unsubscribe |
| `conversation:typing:start` | `{ conversation_id }` | Broadcast typing indicator |
| `conversation:typing:stop` | `{ conversation_id }` | Stop typing indicator |
| `agent:status` | `{ status: "online" \| "away" \| "offline" }` | Set own presence |

### Docker Compose

```yaml
turumba_realtime:
  image: turumba_realtime:latest
  platform: linux/amd64
  ports:
    - "3200:3200"
  environment:
    - RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
    - REDIS_URL=redis://redis:6379
    - COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID}
    - AWS_REGION=${AWS_REGION}
    - PORT=3200
  networks:
    - gateway-network
  depends_on:
    - rabbitmq
    - redis
```

---

## 4. Complete System Flow

### System Diagram

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
│  WS /ws                        ──→  turumba_realtime (or direct)       │
└────────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Account API │    │  Messaging API   │    │ turumba_realtime│
│             │    │                  │    │                 │
│ Users       │    │ Channels         │    │ Socket.IO       │
│ Accounts    │    │ Conversations    │    │ RabbitMQ sub    │
│ Roles       │    │ Messages         │    │ Redis presence  │
│ Contacts    │    │ Templates        │    │ JWT auth        │
│ AgentPrefs  │    │ CannedResponses  │    │                 │
│             │    │ BotRules         │    │ Pushes to:      │
│ Called by   │    │ ContactIdents    │    │  - Agent inbox  │
│ Messaging   │    │ GroupMessages    │    │  - Chat thread  │
│ API for:    │    │ ScheduledMsgs    │    │  - Notifications│
│ - contacts  │    │ OutboxEvents     │    │                 │
│ - agent     │    │                  │    │                 │
│   prefs     │    │ OutboxWorker ──────────→ RabbitMQ       │
│ - user info │    │                  │    │      │          │
└─────────────┘    └──────────────────┘    │      ▼          │
                                           │  Consumes       │
                                           │  conversation.* │
                                           └─────────────────┘
                              │
                    ┌─────────┴──────────┐
                    ▼                    ▼
              ┌──────────┐        ┌──────────┐
              │PostgreSQL│        │ Redis    │
              │          │        │          │
              │ channels │        │ presence │
              │ convos   │        │ typing   │
              │ messages │        │ sessions │
              │ bot_rules│        │ rate lim │
              │ canned   │        │ cache    │
              │ contacts │        │          │
              │ outbox   │        │          │
              └──────────┘        └──────────┘
```

### Inbound Conversation Flow (End-to-End)

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
4. Inbound Worker (RabbitMQ consumer, Messaging API)
   ├── Lookup ContactIdentifier by (whatsapp, phone_number)
   │   ├── Found → get contact_id
   │   └── Not found → call Account API to create contact → create ContactIdentifier
   ├── Find open Conversation for this contact + channel
   │   ├── Found → append message to existing conversation
   │   └── Not found → create new Conversation (status: open)
   ├── Create Message (direction: inbound, sender_type: contact)
   ├── Update conversation.last_message_at
   └── Emit: conversation.message.received → RabbitMQ
                    │
5. Bot Router (RabbitMQ consumer, Messaging API)
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
   │   │
   ├── Execute actions:
   │   ├── Create Message (direction: outbound, sender_type: bot, content: template)
   │   ├── Dispatch reply via WhatsAppAdapter
   │   ├── Fetch eligible agents from Account API:
   │   │   GET /v1/agent-preferences?available_topics=billing&is_available=true
   │   │   Filter by: available_hours (current time), available_channels (whatsapp)
   │   │   Sort by: least active conversations, then longest idle
   │   ├── Assign to best agent → conversation.assignee_id = agent_id
   │   ├── Update conversation.status = "assigned"
   │   ├── Create ConversationAssignment record
   │   └── Emit: conversation.assigned → RabbitMQ
                    │
6. turumba_realtime (consumes conversation.*)
   ├── conversation.message.received →
   │   emit to room "account:{id}" (inbox list update)
   ├── conversation.assigned →
   │   emit to room "user:{assignee_id}" (assignment notification)
   └── Agent's browser receives real-time push
                    │
7. Agent opens conversation in inbox
   ├── GET /v1/conversations/{id} → conversation detail + recent messages
   ├── Joins Socket.IO room "conv:{id}"
   ├── Sees: customer message "I want a refund"
   ├── Sees: bot reply with refund policy template
   ├── Sees: labels ["billing", "refund"], priority: high
   ├── Sees: bot_context (if bot collected any info)
   │
   ├── Agent replies: POST /v1/conversations/{id}/messages
   │   { content: "Hi! I can help with your refund. What's your order number?" }
   │   ├── Message created (direction: outbound, sender_type: agent)
   │   ├── Dispatched via WhatsAppAdapter to customer
   │   ├── conversation.first_reply_at = now() (SLA metric)
   │   └── Emit: conversation.message.sent → RabbitMQ → turumba_realtime
   │
   ├── Customer replies with order number
   │   (flows back through steps 2-6, bot skipped because status = "assigned")
   │
   ├── Agent resolves: PATCH /v1/conversations/{id} { status: "resolved" }
   │   └── conversation.resolved_at = now()
   │
   └── If customer sends another message later → conversation reopens as "open"
```

### Agent Inbox Flow

```
GET /v1/conversations?status=open&assignee_id=me               — my open conversations
GET /v1/conversations?status=assigned&team_id=billing           — team view
GET /v1/conversations?status=bot                                — bot-handled, may need takeover
GET /v1/conversations?sort=last_message_at:desc                 — sorted by latest activity

Agent picks up unassigned conversation:
  PATCH /v1/conversations/{id} { assignee_id: agent_id }
  → status changes to "assigned"
  → ConversationAssignment record created
  → Event: conversation.assigned → RabbitMQ → turumba_realtime

Agent replies:
  POST /v1/conversations/{id}/messages { content: "..." }
  → Message created (direction: outbound, sender_type: agent)
  → Dispatched via channel adapter to customer's platform
  → first_reply_at set if first agent reply (SLA metric)
  → Event: conversation.message.sent → RabbitMQ → turumba_realtime

Agent adds internal note:
  POST /v1/conversations/{id}/messages { content: "...", is_private: true }
  → Message created (direction: outbound, is_private: true)
  → NOT sent to customer, visible only in agent inbox
  → Event pushed only to agents in conv:{id} room

Agent resolves:
  PATCH /v1/conversations/{id} { status: "resolved" }
  → resolved_at timestamp set
  → Event: conversation.resolved → RabbitMQ → turumba_realtime
```

---

## 5. Bot-First Routing System

The bot acts as a first responder with three escalation strategies across implementation phases.

### Phase 1: Rule-Based Router (MVP — No AI Required)

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

Rule 4: Language detection
  IF message language == "am" (Amharic)
  THEN assign to team: "amharic_support"

Rule 5: Fallback
  THEN reply with "An agent will be with you shortly" + assign round-robin
```

### Phase 2: AI-Powered Intent Classification

```
[Inbound Message] → [Intent Classifier Service]
   - LLM or fine-tuned model classifies intent
   - Returns: { intent: "billing_inquiry", confidence: 0.85, entities: {...} }
   - BotRules can match on intent + confidence threshold
   - Higher accuracy routing than keyword matching
```

### Phase 3: Conversational Bot

```
[Inbound Message] → [Bot Conversation Engine]
   - Multi-turn conversation with customer
   - Collects info: name, issue type, order number, etc.
   - Knowledge base lookup for FAQ answers
   - Handoff criteria:
       • Customer explicitly asks for human
       • Bot confidence drops below threshold
       • Sensitive topic detected (complaints, legal)
       • 3+ turns without resolution
   - On handoff: conversation.status → "assigned"
     with full bot context in metadata for agent
```

### Agent Routing Algorithm

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

---

## 6. Service-to-Service Communication

The Messaging API needs data from the Account API during routing.

### Phase 1: Synchronous HTTP (MVP)

```
Messaging API ──HTTP──→ Account API (internal, not through gateway)
  GET http://gt_turumba_account_api:8000/v1/agent-preferences?is_available=true
  GET http://gt_turumba_account_api:8000/v1/contacts?phone=+251...
```

Uses Docker network DNS. Add a lightweight HTTP client in the Messaging API with retry and circuit breaker.

### Phase 2: Cache + Event Sync (Scale)

```
Account API ──→ RabbitMQ (agent.preference.updated, contact.created)
Messaging API ──→ consumes events, caches in Redis
Routing engine queries Redis instead of HTTP
```

---

## 7. API Surface

### New Messaging API Endpoints

```
# Conversations
POST   /v1/conversations                      # Manual creation (internal)
GET    /v1/conversations                       # List with filters (inbox view)
GET    /v1/conversations/{id}                  # Detail with recent messages
PATCH  /v1/conversations/{id}                  # Update status, assignee, labels
DELETE /v1/conversations/{id}                  # Soft-close

# Conversation Messages
POST   /v1/conversations/{id}/messages         # Agent reply / internal note
GET    /v1/conversations/{id}/messages         # Message history (paginated)

# Conversation Assignment
POST   /v1/conversations/{id}/assign           # Assign to agent/team
GET    /v1/conversations/{id}/assignments      # Assignment history

# Canned Responses
POST   /v1/canned-responses
GET    /v1/canned-responses
GET    /v1/canned-responses/{id}
PATCH  /v1/canned-responses/{id}
DELETE /v1/canned-responses/{id}

# Bot Rules
POST   /v1/bot-rules
GET    /v1/bot-rules
GET    /v1/bot-rules/{id}
PATCH  /v1/bot-rules/{id}
DELETE /v1/bot-rules/{id}

# Contact Identifiers
POST   /v1/contact-identifiers
GET    /v1/contact-identifiers
GET    /v1/contact-identifiers/{id}
PATCH  /v1/contact-identifiers/{id}
DELETE /v1/contact-identifiers/{id}

# Webhooks (inbound from channels — from HSM-003)
POST   /v1/webhooks/{channel_type}/{channel_id}
```

### New Account API Endpoints

```
GET    /v1/agent-preferences/me
PATCH  /v1/agent-preferences/me
GET    /v1/agent-preferences
GET    /v1/agent-preferences/{user_id}
```

### New Gateway Routes

All above endpoints need KrakenD endpoint definitions in `config/partials/endpoints/`.

---

## 8. Implementation Phases

### Phase 1: Conversation Foundation
**Prerequisites:** HSM-001 (Channel Adapters), HSM-003 (Webhook Receivers)

1. `Conversation` model + CRUD + status lifecycle in Messaging API
2. Extend `Message` model with `conversation_id`, `is_private`, `sender_type`, `sender_id`
3. `ConversationMessage` nested endpoint (messages within conversations)
4. `ContactIdentifier` model + CRUD
5. Inbound message → conversation creation logic (in webhook consumer)
6. Agent assignment (manual) + assignment history
7. `CannedResponse` model + CRUD
8. `AgentPreference` model + CRUD in Account API
9. Basic inbox API with filters (status, assignee, channel, contact)
10. Gateway route configuration for all new endpoints

### Phase 2: Bot Router + Agent Routing

1. `BotRule` model + CRUD + rule evaluation engine
2. Keyword-based auto-routing
3. Time-based routing (business hours awareness)
4. Channel/topic-based routing
5. Round-robin assignment with preference matching
6. Service-to-service HTTP client (Messaging API → Account API)
7. Queue management (when no agent available)

### Phase 3: Real-Time + Frontend

1. `turumba_realtime` service (Socket.IO + RabbitMQ consumer + Redis + JWT auth)
2. Docker Compose integration
3. Agent inbox UI (conversation list + message thread)
4. Typing indicators + presence
5. Canned response picker in compose area
6. Internal notes UI
7. Conversation labels/filters UI

### Phase 4: AI Bot + Advanced Features

1. Intent classification integration (LLM-based)
2. Multi-turn bot conversations
3. Knowledge base for bot FAQ answers
4. Bot → human handoff with context transfer
5. CSAT survey after resolution
6. SLA tracking + alerts
7. Agent performance analytics

---

## 9. Summary of Changes Per Service

| Service | New Models | New Endpoints | Other Changes |
|---|---|---|---|
| **Messaging API** | `Conversation`, `CannedResponse`, `BotRule`, `ContactIdentifier` + extend `Message` | Conversations CRUD, Conv Messages, Canned Responses CRUD, Bot Rules CRUD, Contact Identifiers CRUD | Bot router worker, agent routing logic, HTTP client to Account API |
| **Account API** | `AgentPreference` | `/v1/agent-preferences` CRUD + `/me` shortcut | New model, schemas, controller, router |
| **turumba_realtime** (NEW) | — | WebSocket only (no REST) | Entire new service: Socket.IO + RabbitMQ consumer + Redis + JWT auth |
| **Gateway** | — | — | Add routes for all new endpoints, optional WS proxy |
| **Web Core** | — | — | Agent inbox UI, conversation thread UI, Socket.IO client |
