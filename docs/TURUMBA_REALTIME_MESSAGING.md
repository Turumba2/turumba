# Turumba Realtime Messaging

> Specification for the realtime messaging system in Turumba 2.0. Covers two complementary capabilities: **omnichannel support conversations** (IM platforms: WhatsApp, Telegram, Messenger, SMS, Email) and **live chat widgets** (embeddable chat points for account users' own websites). Both agents and visitors connect through a **unified AWS API Gateway WebSocket**.

---

## 1. Overview

Turumba Realtime Messaging enables account teams to hold live, two-way conversations with their end-users. Every conversation — regardless of where it originates — is unified in a single inbox. Agents pick up conversations, reply, assign to teammates, and see live updates without refreshing.

### Two Entry Points, One Inbox

```
Customer on WhatsApp ──→ Webhook ──→ Inbound Worker ──→ Conversation ──→ Agent Inbox
Customer on Telegram ──→ Webhook ──→ Inbound Worker ──┘
Customer on website  ──→ Chat Widget ──→ AWS WebSocket ──→ Lambda ──→ Messaging API ──→ Conversation ──┘
```

Both paths create a `Conversation` record in the same table. Agents work the same inbox regardless of how the customer reached out.

### Capabilities

| Feature | Description |
|---|---|
| Omnichannel inbox | Conversations from WhatsApp, Telegram, Messenger, SMS, SMPP, Email |
| Live chat widget | Embeddable webchat for account users' websites |
| Unified WebSocket | Single AWS API Gateway WebSocket for both agents and visitors |
| Real-time push | Live message delivery, typing indicators, presence |
| Internal notes | Private agent-to-agent notes inside a conversation |
| Conversation lifecycle | open → assigned → pending → resolved → closed |

---

## 2. Architecture

### 2.1 System Diagram

```
                    ┌──────────────────────────────────────────┐
                    │     External Platforms & Websites        │
                    │                                          │
                    │  WhatsApp  Telegram  Messenger  SMS  ... │
                    │     │          │         │        │      │
                    │   Webhook   Webhook   Webhook  Webhook   │
                    │     │          │         │        │      │
                    │  Account User's Website (Live Chat)      │
                    │          │   (Visitor WebSocket)         │
                    └──────────┼──────────────────────────────-┘
                               │
            ┌──────────────────┼───────────────────────────────┐
            │                  │                               │
            ▼                  ▼                               │
  ┌─────────────────────┐   ┌──────────────────────────────┐   │
  │ KrakenD Gateway     │   │  AWS API Gateway WebSocket   │   │
  │ (:8080)             │   │  (wss://)                    │   │
  │                     │   │                              │   │
  │ POST /v1/webhooks/* │   │  Agent connects:             │   │
  │ GET/PATCH /convos/* │   │    ?token={cognito_jwt}      │   │
  │ POST /v1/chat-eps/* │   │    &type=agent               │   │
  └────────┬────────────┘   │                              │   │
           │                │  Visitor connects:           │   │
  ┌────────┴────────────┐   │    ?token={visitor_token}    │   │
  │                     │   │    &type=visitor             │   │
  ▼                     ▼   │                              │   │
 ┌──────────────────┐  ┌────┤  Lambdas call back to        │   │
 │   Messaging API  │  │    │  Messaging API for visitor   │   │
 │                  │  │    │  validation + message create │   │
 │ Channels         │  │    └───────────────┬──────────────┘   │
 │ Conversations    │  │                   │                   │
 │ Messages         │  │    ┌──────────────┼──────────┐        │
 │ ChatEndpoints    │  │    │   DynamoDB   │          │        │
 │ ConvConfigs      │  │    │              │          │        │
 │                  │  │    │ ws_connections (agents  │        │
 │ Templates        │  │    │   + visitors)           │        │
 │ OutboxEvents     │  │    │ ws_subscriptions        │        │
 │                  │  │    │ ws_presence             │        │
 │ Workers:         │  │    └─────────────────────────┘        │
 │  outbox ─────────┼──┼──→ RabbitMQ                          │
 │  inbound ────────┤  │    realtime.events queue              │
 │  dispatch ───────┤  │         │                             │
 │  realtime_push ──┼──┼──→ DynamoDB → @connections push      │
 │                  │  │         │                             │
 └──────────────────┘  │         ▼                             │
          │            │  ┌──────────────────┐                 │
          ▼            │  │ Agent Browser    │◄────────────────┘
    ┌──────────┐       │  │ (Next.js)       │
    │PostgreSQL│       │  │ Inbox + Chat UI │
    │          │       │  └──────────────────┘
    │ channels │       │
    │ convos   │       │  ┌──────────────────┐
    │ messages │       │  │ Visitor Browser  │◄────────────────┘
    │ chat_eps │       │  │ (Chat Widget)   │
    │ configs  │       │  │ wss:// to same  │
    │ outbox   │       │  │ API Gateway     │
    └──────────┘       │  └──────────────────┘
                       │
                  ┌────┴────────────┐
                  │  Account API    │
                  │ Users, Contacts │
                  │ Accounts, Roles │
                  │ Teams           │
                  └─────────────────┘
```

### 2.2 Service Ownership

| Domain | Service | Rationale |
|---|---|---|
| Conversations, Messages, ChatEndpoints, ConversationConfig | Messaging API | Messaging domain — same DB as channels and templates |
| WebSocket connections (agents + visitors), push delivery | AWS API Gateway + Lambda + DynamoDB | Managed, scales automatically, single infrastructure for both connection types |
| `realtime_push_worker` | Messaging API | Python worker bridging RabbitMQ → AWS WebSocket push |
| Users, Contacts, Accounts, Teams | Account API | Teams are agent organizational units — belongs with users and roles |

### 2.3 Unified WebSocket — Key Design Decision

Both agents and visitors connect to the **same AWS API Gateway WebSocket API**. The `$connect` Lambda distinguishes connection type via the `type` query parameter and validates accordingly:

| Connection Type | Auth Mechanism | What Lambda Does on `$connect` |
|---|---|---|
| `agent` | Cognito JWT (`?token={jwt}&type=agent`) | Validate JWT against Cognito JWKS, extract `user_id` + `account_ids` |
| `visitor` | Visitor token (`?token={visitor_token}&type=visitor`) | Call Messaging API `POST /internal/validate-visitor` to validate token, get `visitor_id`, `account_id`, `endpoint_id` |

**Why unified?**
- Single infrastructure to operate and monitor
- `realtime_push_worker` pushes to rooms — doesn't need to know if subscriber is agent or visitor
- Visitors get the same reliable push delivery as agents (API Gateway managed WebSocket)
- No FastAPI WebSocket endpoint to maintain or scale separately
- Room-based subscriptions work identically for both types

**How the callback works:**

When a visitor connects or sends a message, the Lambda functions call back to the Messaging API's **internal endpoints** (not exposed through the gateway, only accessible on the Docker network):

```
Lambda ──HTTP──→ gt_turumba_messaging_api:8000/internal/validate-visitor
Lambda ──HTTP──→ gt_turumba_messaging_api:8000/internal/visitor-message
```

The Messaging API validates the visitor token, creates/resumes conversations, creates messages, and emits events — all server-side. The Lambda is just a thin proxy that bridges the WebSocket frame to an HTTP call.

---

## 3. Data Models

### 3.1 `conversations` — Messaging API

Central record for every support thread, regardless of channel origin.

```
conversations
├── id                   UUID PK
├── account_id           UUID NOT NULL (tenant isolation from gateway header)
├── channel_id           UUID nullable (FK → channels — IM conversations: WhatsApp, Telegram, etc.)
├── chat_endpoint_id     UUID nullable (FK → chat_endpoints — webchat conversations)
│                        CHECK: exactly one of channel_id or chat_endpoint_id must be NOT NULL
├── contact_id           UUID NOT NULL (Account API contact reference)
├── contact_identifier   String(255) NOT NULL — platform-specific ID:
│                        phone number, telegram user_id, PSID, email, visitor_id
├── assignee_id          UUID nullable — current agent (user_id from Account API)
├── team_id              UUID nullable — assigned team
├── status               String(20) NOT NULL default "open"
│                        CHECK IN ('open', 'assigned', 'pending', 'resolved', 'closed')
├── priority             String(10) NOT NULL default "normal"
│                        CHECK IN ('low', 'normal', 'high', 'urgent')
├── subject              String(255) nullable
├── labels               JSONB default []
├── first_reply_at       DateTime(tz) nullable — SLA: first agent reply timestamp
├── resolved_at          DateTime(tz) nullable
├── last_message_at      DateTime(tz) nullable — drives inbox sort order
├── metadata_            JSONB default {}
├── created_at / updated_at
│
├── CHECK ((channel_id IS NOT NULL AND chat_endpoint_id IS NULL) OR
│          (channel_id IS NULL AND chat_endpoint_id IS NOT NULL))
├── INDEX(account_id, status, assignee_id) — inbox queries
├── INDEX(account_id, last_message_at DESC) — sorted inbox
├── INDEX(account_id, contact_id, channel_id) — find existing IM conversation
└── INDEX(account_id, contact_id, chat_endpoint_id) — find existing webchat conversation
```

**Source distinction:** IM conversations set `channel_id`; webchat conversations set `chat_endpoint_id`. The existing conversation lookup (Step 6 in Section 4.1) uses the appropriate field based on source type:
- IM: `WHERE contact_id = ? AND channel_id = ? AND status NOT IN ('closed')`
- Webchat: `WHERE contact_id = ? AND chat_endpoint_id = ? AND status NOT IN ('closed')`

**Status lifecycle:**

```
open ──→ assigned ──→ pending ──→ resolved ──→ closed
  │       ↑    │         │           │
  └───────┘    └─────────┘           │
  (manual      (agent sets pending   │
   assign)      waiting for reply)   │
                                     │
  Customer sends new message after resolved ─┘──→ reopens as "open"
```

Valid transitions:
- `open` → `assigned`, `closed`
- `assigned` → `pending`, `resolved`, `closed`
- `pending` → `assigned`, `resolved`, `closed`
- `resolved` → `open` (reopen), `closed`
- `closed` → terminal

### 3.2 `messages` — Extended Columns

Existing table. Add nullable columns — all existing broadcast/group/scheduled messages continue working unchanged.

```
messages (add to existing table)
├── conversation_id    UUID nullable (FK → conversations, indexed)
├── chat_endpoint_id   UUID nullable (FK → chat_endpoints) — set for webchat messages
│                      (existing channel_id remains for IM messages; webchat messages set channel_id = NULL)
├── is_private         Boolean NOT NULL default false — internal notes, not sent to customer
├── sender_type        String(20) nullable
│                      CHECK (sender_type IS NULL OR sender_type IN ('contact', 'agent', 'system'))
└── sender_id          UUID nullable — agent user_id
```

Note: The existing `channel_id` column on `messages` must be made **nullable** to support webchat messages that come through `chat_endpoints` rather than `channels`. Existing messages (broadcast, group, scheduled) always have `channel_id` set.

### 3.3 `contact_identifiers` — Messaging API (Deferred)

> **Note:** ContactIdentifiers will be implemented in a future session. This model maps platform-specific IDs (phone numbers, Telegram user IDs, visitor IDs) to Account API contacts, enabling cross-channel identity unification. The conversation creation flow and inbound worker will initially use `contact_id` directly; the ContactIdentifier lookup layer will be added later.

### 3.4 `chat_endpoints` — Messaging API (Live Chat Widget)

One row per embeddable chat point created by an account user. Each represents a specific chat widget that can be embedded on a website page.

```
chat_endpoints
├── id               UUID PK
├── account_id       UUID NOT NULL
├── name             String(255) NOT NULL — "Support Chat", "Sales Inquiry"
├── public_key       String(64) NOT NULL UNIQUE — embed token (random, URL-safe)
├── is_active        Boolean NOT NULL default true
├── welcome_message  Text nullable — first message shown to visitors
├── offline_message  Text nullable — shown when no agents online
├── pre_chat_form    JSONB nullable
│     {
│       "enabled": true,
│       "fields": [
│         { "name": "name", "label": "Your Name", "required": true },
│         { "name": "email", "label": "Email", "required": false }
│       ]
│     }
├── widget_config    JSONB default {}
│     {
│       "color": "#4F46E5",
│       "position": "bottom-right",
│       "launcher_text": "Chat with us"
│     }
├── allowed_origins  JSONB default [] — CORS: ["https://example.com"]
│                    Empty list = all origins allowed
├── metadata_        JSONB default {}
├── created_at / updated_at
│
└── INDEX(account_id, is_active)
```

`public_key` is the only publicly visible identifier. It is safe to embed in client-side JavaScript. The UUID `id` is never exposed publicly.

**Note:** Chat endpoints define **widget UI/UX** (appearance, pre-chat forms, CORS). Conversation **routing** (team assignment, agent assignment, creation mode) is controlled by `conversation_configs` (Section 3.5). This separation ensures a single source of truth for routing decisions — a chat endpoint's UUID is referenced in a config's `enabled_chat_endpoints` list.

### 3.5 `conversation_configs` — Messaging API

Configurable rules that control **when, how, on which sources, and for whom** conversations can be created. An account can have **multiple configs**, each targeting different sources and audiences. When an inbound message arrives, configs are evaluated in `priority` order — the **first match wins**.

```
conversation_configs
├── id                      UUID PK
├── account_id              UUID NOT NULL
├── name                    String(255) NOT NULL — "VIP WhatsApp Support", "Public Webchat"
├── priority                Integer NOT NULL — evaluation order (lower = first)
├── is_active               Boolean NOT NULL default true
│
│  ── SOURCE TARGETING (which channels / chat endpoints this config applies to) ──
├── enabled_channels        JSONB [] default [] — specific channel UUIDs (from channels table)
├── enabled_chat_endpoints  JSONB [] default [] — specific chat_endpoint UUIDs
│     A config matches if the inbound source_id is in either list.
│     A source should appear in at most ONE active config to avoid ambiguity.
│
│  ── AUDIENCE (who is allowed) ──
├── audience_mode           String(20) NOT NULL default "all"
│     "all"         — anyone who messages can create a conversation
│     "known_only"  — only existing contacts in the account
│     "groups"      — only contacts belonging to specified groups
│     "allowlist"   — only explicitly listed contacts and/or groups
│
├── allowed_groups          JSONB [] default [] — group UUIDs (Account API groups)
│     Used when audience_mode is "groups" or "allowlist"
│
├── allowed_contacts        JSONB [] default [] — contact UUIDs (Account API contacts)
│     Used when audience_mode is "allowlist"
│
│  ── CONVERSATION BEHAVIOR ──
├── creation_mode           String(20) NOT NULL default "auto"
│     "auto"   — conversation created automatically on first inbound message
│     "manual" — agent must manually create conversation from unthreaded messages
│
├── reopen_policy           String(20) NOT NULL default "reopen"
│     "reopen"    — customer message after resolved reopens the same conversation
│     "new"       — always create a new conversation after resolved
│     "threshold" — reopen if within reopen_window, otherwise new
│
├── reopen_window           Integer nullable — hours (used when reopen_policy = "threshold")
│
├── default_team_id         UUID nullable — auto-assign new conversations to this team
├── default_assignee_id     UUID nullable — auto-assign to this specific agent
│
├── metadata_               JSONB default {}
├── created_at / updated_at
│
├── UNIQUE(account_id, name)
├── INDEX(account_id, is_active, priority)
```

**No configs exist?** No conversations are created. Admin must explicitly create at least one config.

**A source appears in no config?** Inbound messages on that source are processed normally (delivery tracking) but no conversation is created.

**Configuration examples:**

*Config 1: "VIP Telegram — priority 1" (evaluated first)*
```json
{
  "name": "VIP Telegram Support",
  "priority": 1,
  "enabled_channels": ["telegram-channel-uuid"],
  "enabled_chat_endpoints": [],
  "audience_mode": "groups",
  "allowed_groups": ["vip-customers-uuid"],
  "creation_mode": "auto",
  "reopen_policy": "threshold",
  "reopen_window": 48,
  "default_team_id": "vip-support-team-uuid"
}
```

*Config 2: "WhatsApp for everyone — priority 2"*
```json
{
  "name": "WhatsApp General",
  "priority": 2,
  "enabled_channels": ["whatsapp-channel-uuid"],
  "enabled_chat_endpoints": [],
  "audience_mode": "all",
  "creation_mode": "auto",
  "reopen_policy": "reopen"
}
```

*Config 3: "Public webchat — priority 3"*
```json
{
  "name": "Website Support Chat",
  "priority": 3,
  "enabled_channels": [],
  "enabled_chat_endpoints": ["support-chat-uuid"],
  "audience_mode": "all",
  "creation_mode": "auto",
  "reopen_policy": "new",
  "default_team_id": "general-support-team-uuid"
}
```

*Config 4: "VIP-only private chat — priority 4"*
```json
{
  "name": "VIP Website Chat",
  "priority": 4,
  "enabled_channels": [],
  "enabled_chat_endpoints": ["vip-chat-uuid"],
  "audience_mode": "known_only",
  "creation_mode": "auto",
  "reopen_policy": "threshold",
  "reopen_window": 24
}
```

### 3.6 `teams` + `team_members` — Account API

Teams organize agents into functional groups for conversation routing. A conversation can be assigned to a team (all team members see it) before being picked up by an individual agent.

```
teams
├── id              UUID PK
├── account_id      UUID NOT NULL (FK → accounts, tenant isolation)
├── name            String(255) NOT NULL — "Billing Support", "Technical", "Sales"
├── description     Text nullable
├── lead_id         UUID nullable (FK → users — team lead/manager)
├── is_active       Boolean NOT NULL default true
├── metadata_       JSONB default {}
├── created_at / updated_at
│
├── UNIQUE(account_id, name)
└── INDEX(account_id, is_active)
```

```
team_members (M:N junction — same pattern as account_users)
├── id              UUID PK
├── team_id         UUID NOT NULL (FK → teams, ON DELETE CASCADE)
├── user_id         UUID NOT NULL (FK → users)
├── role            String(20) NOT NULL default "member"
│                   CHECK IN ('member', 'lead')
├── created_at
│
├── UNIQUE(team_id, user_id)
└── INDEX(user_id)
```

A user can belong to **multiple teams** within the same account (e.g., an agent handles both "billing" and "general" queues).

**How teams connect to conversations:**

The `team_id` on the `conversations` model (Section 3.1) references a team in the Account API. This is a cross-service reference (not a local FK) — same pattern as `contact_id` and `assignee_id`.

```
Conversation lifecycle with teams:
  1. Conversation created (inbound message) → team_id = null, assignee_id = null, status = "open"
     (visible to all agents in the inbox)

  2. Conversation assigned to a team → team_id = "billing-uuid", assignee_id = null
     (visible to all members of that team)

  3. Agent from team picks it up → assignee_id = "agent-uuid", status = "assigned"
     (owned by individual agent, team still recorded for reporting)
```

**Inbox filtering by team:**
```
GET /v1/conversations?team_id={team_id}&status=open       — unassigned team conversations
GET /v1/conversations?team_id={team_id}&assignee_id=me    — my conversations in this team
```

**Cross-service enrichment:** The Messaging API fetches team data from the Account API via HTTP (same pattern as contact/user enrichment). List endpoints batch-fetch unique team_ids.

---

## 4. Conversation Creation Flow

Every inbound message — whether from a webhook (WhatsApp, Telegram, etc.) or a visitor WebSocket (webchat) — passes through the same conversation creation logic. Multiple `conversation_configs` are evaluated in priority order. The **first config that matches** (source + audience) is used.

### 4.1 Full Decision Flow

```
Inbound message arrives (webhook or visitor WebSocket)
    │
    ├── 1. IDENTIFY SOURCE
    │      IM channel  → source_id = channel_id, source_type = "channel"
    │      Webchat     → source_id = chat_endpoint_id, source_type = "chat_endpoint"
    │
    ├── 2. LOOKUP CONTACT (find only — do NOT create yet)
    │      IM channels:
    │        Extract sender identifier from webhook payload (phone, telegram user_id, etc.)
    │        Call Account API internal endpoint (see Section 4.2):
    │          POST /internal/contacts/lookup { account_id, phone } or { account_id, email }
    │        ├── Found → known contact, have contact_id
    │        └── Not found → contact_id = null (unknown sender)
    │      Webchat:
    │        If pre-chat form provided email:
    │          POST /internal/contacts/lookup { account_id, email }
    │          ├── Found → known contact, have contact_id
    │          └── Not found → contact_id = null
    │        If no email → contact_id = null (anonymous visitor)
    │
    ├── 3. LOAD CONFIGS
    │      Load all conversation_configs for account_id
    │      WHERE is_active = true, ORDER BY priority ASC (cached in memory)
    │      ├── No configs exist → NO MATCH (no conversations until admin configures)
    │      └── Configs found → evaluate each in order
    │
    ├── 4. EVALUATE CONFIGS (first match wins)
    │      │
    │      │  FOR EACH config (in priority order):
    │      │  │
    │      │  ├── 4a. SOURCE CHECK — does this config target this source?
    │      │  │       ├── channel:       source_id in config.enabled_channels?
    │      │  │       └── chat_endpoint: source_id in config.enabled_chat_endpoints?
    │      │  │       If NO → skip this config, try next
    │      │  │
    │      │  ├── 4b. AUDIENCE CHECK — is this sender allowed by this config?
    │      │  │       │
    │      │  │       ├── "all" → MATCH
    │      │  │       │
    │      │  │       ├── "known_only"
    │      │  │       │   ├── contact_id exists → MATCH
    │      │  │       │   └── contact_id is null → skip this config, try next
    │      │  │       │
    │      │  │       ├── "groups"
    │      │  │       │   ├── contact_id exists → check membership:
    │      │  │       │   │   Call Account API: is contact_id in any config.allowed_groups?
    │      │  │       │   │   ├── Yes → MATCH
    │      │  │       │   │   └── No  → skip this config, try next
    │      │  │       │   └── contact_id is null → skip this config, try next
    │      │  │       │
    │      │  │       └── "allowlist"
    │      │  │           ├── contact_id in config.allowed_contacts → MATCH
    │      │  │           ├── contact_id in any config.allowed_groups → MATCH
    │      │  │           └── Otherwise → skip this config, try next
    │      │  │
    │      │  └── MATCH FOUND → use this config, stop evaluating
    │      │
    │      └── NO CONFIG MATCHED → no conversation created
    │          (message processed normally, logged as unqualified)
    │
    ├── 5. ENSURE CONTACT EXISTS (create only after a config matched)
    │      ├── contact_id exists → use it (already found in step 2)
    │      └── contact_id is null (matched config's audience_mode must be "all"):
    │          ├── IM channel → create contact in Account API:
    │          │   POST /v1/contacts { phone, name: "Unknown", properties: { source: channel_type } }
    │          ├── Webchat with email → create contact:
    │          │   POST /v1/contacts { name, email, properties: { source: "webchat" } }
    │          └── Webchat anonymous → create contact:
    │              POST /v1/contacts { name: "Visitor", properties: { visitor_id, source: "webchat" } }
    │
    ├── 6. FIND EXISTING CONVERSATION
    │      IM:      WHERE contact_id = ? AND channel_id = ? AND status != 'closed'
    │      Webchat: WHERE contact_id = ? AND chat_endpoint_id = ? AND status != 'closed'
    │      │
    │      ├── Active (open / assigned / pending)
    │      │   → Append message to existing thread. DONE.
    │      │
    │      ├── Resolved → apply matched config's reopen_policy:
    │      │   ├── "reopen"    → set status back to "open", append message
    │      │   ├── "new"       → create NEW conversation
    │      │   └── "threshold" → check (now - resolved_at) vs config.reopen_window
    │      │       ├── Within window  → reopen existing
    │      │       └── Past window    → create NEW conversation
    │      │
    │      ├── Closed → create NEW conversation (closed is terminal)
    │      │
    │      └── None found → apply matched config's creation_mode:
    │          ├── "auto"   → create NEW conversation
    │          │   ├── If config.default_team_id → set conversation.team_id
    │          │   └── If config.default_assignee_id → set conversation.assignee_id, status = "assigned"
    │          └── "manual" → store as unthreaded message (agent creates conv manually)
    │
    └── 7. EMIT EVENTS
           conversation.message.created → outbox → RabbitMQ → realtime_push_worker
           (+ conversation.created if new conversation)
```

### 4.1.1 Example: Config Evaluation in Action

Account has 3 configs:

```
Priority 1: "VIP Telegram" — enabled_channels: [telegram-uuid], audience_mode: "groups", allowed_groups: [vip-uuid]
Priority 2: "General Telegram" — enabled_channels: [telegram-uuid], audience_mode: "all"
Priority 3: "Public Webchat" — enabled_channels: [], enabled_chat_endpoints: [support-chat-uuid], audience_mode: "all"
```

**Scenario A:** VIP customer sends Telegram message
```
Config 1: source matches (telegram-uuid) → audience: contact is in vip group → MATCH
→ Uses Config 1 (VIP team assignment, 48h reopen window)
```

**Scenario B:** Unknown person sends Telegram message
```
Config 1: source matches → audience: unknown contact, not in group → skip
Config 2: source matches → audience: "all" → MATCH
→ Uses Config 2 (general handling, auto-create contact)
```

**Scenario C:** Someone opens webchat
```
Config 1: source doesn't match (webchat, not telegram) → skip
Config 2: source doesn't match → skip
Config 3: source matches (support-chat-uuid) → audience: "all" → MATCH
→ Uses Config 3
```

**Scenario D:** Someone sends WhatsApp message (no config covers WhatsApp)
```
Config 1: skip, Config 2: skip, Config 3: skip → NO MATCH
→ No conversation created
```

### 4.2 Account API Integration (Internal Endpoints)

The Messaging API calls the Account API's **internal endpoints** on the Docker network. These endpoints don't require authentication tokens — they're only accessible between services on the shared `gateway-network`, not exposed through KrakenD.

```
Messaging API ──HTTP──→ gt_turumba_account_api:8000/internal/...
```

**Step 2 — Contact lookup (search only, no creation):**

```
POST http://gt_turumba_account_api:8000/internal/contacts/lookup
  Request:  { account_id: "uuid", phone: "+251..." }
            OR { account_id: "uuid", email: "dawit@example.com" }
  Response: { found: true, contact_id: "uuid", name: "Dawit", ... }
            OR { found: false }
```

**Step 4b — Audience check (group membership):**

```
POST http://gt_turumba_account_api:8000/internal/contacts/check-membership
  Request:  { contact_id: "uuid", group_ids: ["group-uuid-1", "group-uuid-2"] }
  Response: { is_member: true, matched_groups: ["group-uuid-1"] }
```

**Step 5 — Contact creation (only after a config matched):**

```
POST http://gt_turumba_account_api:8000/internal/contacts/create
  Request:  { account_id: "uuid", phone: "+251...", name: "Unknown",
              properties: { source: "whatsapp" } }
  Response: { contact_id: "uuid" }
```

These internal endpoints need to be added to the Account API. They mirror the public CRUD endpoints but:
- No JWT validation — trusted service-to-service calls
- Accept `account_id` in the request body (no header context needed)
- Optimized for the conversation flow (e.g., `check-membership` checks multiple groups in one call)

Results are cached per (contact_id, group_ids) pair with a short TTL (5 minutes) to avoid repeated calls for the same contact sending multiple messages.

### 4.3 Rejected Messages

When a message fails the source check or audience check:

| Source Type | Rejection Behavior |
|---|---|
| IM channel (WhatsApp, Telegram, etc.) | Message is processed normally (delivery status tracked) but no conversation is created. Optionally logged as "unqualified inbound" for admin review. |
| Webchat (visitor WebSocket) | Lambda receives rejection from `/internal/visitor-message` → sends error frame to visitor: `{ type: "error", code: "conversation_not_allowed" }`. Widget can show a polite message. |

### 4.4 Manual Creation Mode

When `creation_mode` is `"manual"`, inbound messages from allowed contacts are stored without a conversation thread:

```
messages (stored with conversation_id = NULL, flagged as pending)
├── account_id, channel_id, content, direction: "inbound"
├── contact_id (resolved from Account API)
├── conversation_id = NULL
├── metadata_: { "pending_thread": true }
```

Agents see these in a **"Pending Messages"** view in the inbox. They can select one or more messages and create a conversation manually:

```
POST /v1/conversations/
{
  "channel_id": "uuid",
  "contact_id": "uuid",
  "message_ids": ["msg-uuid-1", "msg-uuid-2"]   // attach existing messages to new conversation
}
```

This links the pending messages to the new conversation by setting their `conversation_id`.

---

## 5. Omnichannel IM Conversations

How conversations from WhatsApp, Telegram, Messenger, SMS, and Email enter the system.

### 5.1 Inbound Flow

```
1. Customer sends message on WhatsApp / Telegram / etc.
              │
2. Provider webhook → POST /v1/webhooks/{type}/{channel_id}
   ├── Verify HMAC signature
   ├── Parse payload via channel adapter (WhatsAppAdapter, TelegramAdapter, ...)
   ├── Return 200 immediately (fast ACK)
   └── Publish raw event → RabbitMQ: conversation.inbound queue
              │
3. inbound_message_worker (RabbitMQ consumer)
   ├── Extract sender identifier from webhook payload (phone, email, platform ID)
   ├── Lookup contact via Account API internal endpoint:
   │   POST /internal/contacts/lookup { account_id, phone/email }
   │   ├── Found → contact_id = result.contact_id (known sender)
   │   └── Not found → contact_id = null (unknown sender)
   ├── Load all active conversation_configs for account_id (ordered by priority)
   ├── Evaluate configs (first match wins — same logic as Section 4.1):
   │   │  FOR EACH config (in priority order):
   │   │  ├── Source check: is channel_id in config.enabled_channels?
   │   │  │   └── No → skip this config, try next
   │   │  ├── Audience check: is this sender allowed by config.audience_mode?
   │   │  │   ├── "all" → MATCH
   │   │  │   ├── "known_only" → contact_id exists? MATCH : skip
   │   │  │   ├── "groups" → contact_id exists + in config.allowed_groups? MATCH : skip
   │   │  │   └── "allowlist" → contact_id in allowed_contacts/groups? MATCH : skip
   │   │  └── MATCH FOUND → use this config, stop evaluating
   │   └── NO CONFIG MATCHED → process message (delivery tracking) but SKIP conversation creation
   ├── Ensure contact exists (only after a config matched):
   │   ├── contact_id exists → use it
   │   └── contact_id is null (matched config's audience_mode must be "all"):
   │       POST /internal/contacts/create { account_id, phone, name: "Unknown", ... }
   │       → contact_id = result.contact_id
   ├── Find existing Conversation for (contact_id, channel_id) — IM lookup
   │   ├── Active → append message to existing thread
   │   ├── Resolved → apply matched config's reopen_policy (reopen / new / threshold)
   │   ├── Closed → create new Conversation
   │   └── None → apply matched config's creation_mode (auto → create / manual → store as pending)
   │       (if auto: set team_id/assignee_id from config defaults)
   ├── Create Message (direction: inbound, sender_type: contact, conversation_id)
   ├── Update conversation.last_message_at
   └── Emit: conversation.message.created → outbox → RabbitMQ
              │
4. realtime_push_worker → pushes events to agent browsers via AWS WebSocket
```

### 5.2 Agent Reply Flow

```
1. Agent reads conversation → subscribes to WebSocket room "conv:{id}"

2. Agent types → WebSocket frame { action: "typing", conversation_id: id }
   → ws-typing Lambda relays to other agents + visitor in the conv room

3. Agent sends reply → POST /v1/conversations/{id}/messages
   { content: "...", is_private: false }
   ├── Message created (direction: outbound, sender_type: agent)
   ├── conversation.first_reply_at set if this is the first agent reply (SLA)
   ├── conversation.last_message_at updated
   ├── IM conversation: dispatched to customer via channel adapter
   │   Webchat conversation: pushed directly via WebSocket (fire-and-forget, Section 8)
   └── Emit: conversation.message.sent → outbox → RabbitMQ → realtime push

4. Customer receives reply on WhatsApp / Telegram / webchat widget
```

### 5.3 Channel Adapter Mapping

| Channel | Inbound Parse | Outbound Send |
|---|---|---|
| `whatsapp` | `WhatsAppAdapter.parse_inbound()` | `WhatsAppAdapter.send()` |
| `telegram` | `TelegramAdapter.parse_inbound()` | `TelegramAdapter.send()` |
| `messenger` | `MessengerAdapter.parse_inbound()` | `MessengerAdapter.send()` |
| `sms` | `SmsAdapter.parse_inbound()` | `SmsAdapter.send()` |
| `smpp` | `SmppAdapter.parse_inbound()` | `SmppAdapter.send()` |
| `email` | `EmailAdapter.parse_inbound()` | `EmailAdapter.send()` |
| `webchat` | AWS WebSocket → Lambda → Internal API | realtime_push_worker → @connections push |

---

## 6. Live Chat Widget (Webchat Channel)

Enables account users to embed a chat window on their own websites so their end-users can start real-time conversations with agents — all through the same AWS API Gateway WebSocket used by agents.

### 6.1 How It Works — End-to-End

```
Account Admin:
  1. Creates a ChatEndpoint in Turumba dashboard
     POST /v1/chat-endpoints → { public_key: "abc123..." }
  2. Copies embed snippet to their website:
     <script src="https://chat.turumba.io/widget.js"
             data-key="abc123..."
             data-position="bottom-right">
     </script>

Visitor on Account User's Website:
  3. Page loads → widget.js initializes
  4. Visitor clicks chat launcher
  5. (Optional) Pre-chat form collects name / email
  6. Widget calls POST /v1/public/chat/abc123.../session
     → Messaging API validates public_key, generates visitor_token (JWT)
     → returns { visitor_token, visitor_id, ws_url }
  7. Widget opens WebSocket to AWS API Gateway:
     wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}?token={visitor_token}&type=visitor
  8. $connect Lambda validates visitor_token by calling:
     POST gt_turumba_messaging_api:8000/internal/validate-visitor
     → returns { valid: true, visitor_id, account_id, endpoint_id }
     → Lambda stores connection in DynamoDB (connection_type: "visitor")
     → Lambda auto-subscribes visitor to room "visitor:{visitor_id}"
  9. Visitor sends message → WS frame { action: "visitor_message", content: "..." }
     → ws-visitor-message Lambda calls:
       POST gt_turumba_messaging_api:8000/internal/visitor-message
       { visitor_id, account_id, endpoint_id, content }
     → Messaging API creates Conversation (if new) + Message
     → Emits conversation.message.created → outbox → RabbitMQ
     → Lambda sends ACK frame back to visitor
 10. realtime_push_worker picks up event (if not already_pushed):
     → pushes to room "conv:{conversation_id}" (agents + visitor viewing thread)
     → pushes to room "account:{account_id}" (all agents, inbox update)
     (visitor receives via "conv:{id}" subscription — not via "visitor:{id}" room)
 11. Agent sees new conversation in inbox, opens it, replies
 12. Agent reply → realtime_push_worker pushes to "conv:{id}" room
     → visitor's connection is subscribed to "conv:{id}" → sees reply in real time

Agent in Turumba Inbox:
 13. Agent WebSocket receives conversation:new push
 14. Agent opens conversation, subscribes to conv room, replies
 15. Reply pushed to visitor via same API Gateway @connections API
```

### 6.2 ChatEndpoint Lifecycle API

```
POST   /v1/chat-endpoints/                    — Create chat point (auth required)
GET    /v1/chat-endpoints/                    — List (scoped to account)
GET    /v1/chat-endpoints/{id}                — Get by internal ID (auth required)
PATCH  /v1/chat-endpoints/{id}                — Update config, toggle active
DELETE /v1/chat-endpoints/{id}                — Deactivate (204)

# Public endpoints — no auth, identified by public_key:
GET    /v1/public/chat/{public_key}           — Widget config (color, welcome message, pre-chat form)
POST   /v1/public/chat/{public_key}/session   — Start or resume visitor session
```

**Session endpoint** (`POST /v1/public/chat/{public_key}/session`):

```json
// Request (optional pre-chat form fields):
{
  "visitor_id": "vs_abc...",    // client-generated or null for first visit
  "name": "Dawit",             // from pre-chat form
  "email": "dawit@example.com"
}

// Response:
{
  "visitor_token": "vt_eyJhbGc...",    // short-lived token (1h), JWT signed by Messaging API
  "visitor_id": "vs_abc...",           // persisted in visitor's localStorage
  "conversation_id": "uuid or null",   // null = new conversation created on first message
  "ws_url": "wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}"
}
```

### 6.3 Visitor WebSocket — AWS API Gateway (Unified)

Visitors connect to the **same AWS API Gateway WebSocket** as agents. The Lambda `$connect` handler distinguishes them via `?type=visitor` and validates by calling back to the Messaging API.

**Connection flow:**

```
Visitor Widget
    │ wss://{api-gateway-url}?token={visitor_token}&type=visitor
    ▼
AWS API Gateway WebSocket
    │
    ├── $connect → Lambda ws-connect
    │   ├── Detect type=visitor from query params
    │   ├── Call Messaging API: POST /internal/validate-visitor
    │   │   Request:  { token: "vt_eyJhbGc..." }
    │   │   Response: { valid: true, visitor_id: "vs_abc", account_id: "uuid",
    │   │              endpoint_id: "uuid", chat_endpoint_name: "Support Chat" }
    │   ├── If invalid → return 401, connection rejected
    │   ├── Store in DynamoDB ws_connections:
    │   │   { connection_id, connection_type: "visitor", visitor_id, account_id, endpoint_id }
    │   ├── Auto-subscribe to room "visitor:{visitor_id}"
    │   └── Return 200, connection established
    │
    ├── visitor_message → Lambda ws-visitor-message
    │   ├── Payload: { content: "Hello, I need help", content_type: "text" }
    │   ├── Lookup connection in DynamoDB → get visitor_id, account_id, endpoint_id
    │   ├── Call Messaging API: POST /internal/visitor-message
    │   │   Request:  { visitor_id, account_id, endpoint_id, content, content_type }
    │   │   Response: { message_id, conversation_id, created_at }
    │   ├── If new conversation → subscribe visitor to room "conv:{conversation_id}"
    │   └── Send ACK to visitor: { type: "ack", message_id, conversation_id, created_at }
    │
    ├── visitor_typing → Lambda ws-visitor-typing
    │   ├── Payload: { typing: true }
    │   ├── Lookup connection → get conversation_id from ws_subscriptions
    │   └── Relay to room "conv:{conversation_id}" (agents see visitor typing)
    │
    └── $disconnect → Lambda ws-disconnect
        ├── Clean up ws_connections + ws_subscriptions (same as agent disconnect)
        └── No presence update (visitors don't have presence)
```

**Visitor token format (JWT, signed by Messaging API):**

```json
{
  "sub": "vs_abc123",         // visitor_id
  "account_id": "uuid",       // scoped to this account
  "endpoint_id": "uuid",      // chat_endpoint id
  "type": "visitor",           // distinguishes from Cognito tokens
  "exp": 1700000000           // 1 hour expiry
}
```

Signed with `VISITOR_JWT_SECRET` environment variable (HMAC-SHA256). Refreshed automatically by the widget before expiry.

### 6.4 Internal Messaging API Endpoints (Lambda Callbacks)

These endpoints are **only accessible on the Docker network** — never exposed through KrakenD gateway. Lambdas reach them via the Messaging API's internal URL.

```
POST /internal/validate-visitor
  Request:  { token: "vt_..." }
  Response: { valid: bool, visitor_id, account_id, endpoint_id, chat_endpoint_name }

  Logic:
  - Decode and verify JWT (HMAC-SHA256 with VISITOR_JWT_SECRET)
  - Check chat_endpoint exists and is_active
  - Return visitor context

POST /internal/visitor-message
  Request:  { visitor_id, account_id, endpoint_id, content, content_type, email? }
  Response: { message_id, conversation_id, created_at, is_new_conversation }
            OR { allowed: false, reason: "no_matching_config" | "audience_rejected" }

  Logic (follows Section 4.1 multi-config evaluation):
  1. Lookup contact (find only, do NOT create yet):
     ├── If email provided → POST /internal/contacts/lookup { account_id, email }
     │   ├── Found → contact_id = result.contact_id
     │   └── Not found → contact_id = null
     └── If no email → contact_id = null (anonymous visitor)
  2. Load all active conversation_configs for account_id (ordered by priority)
  3. Evaluate configs (first match wins):
     │  FOR EACH config (in priority order):
     │  ├── Source check: is endpoint_id in config.enabled_chat_endpoints?
     │  │   └── No → skip this config, try next
     │  ├── Audience check (config.audience_mode):
     │  │   ├── "all" → MATCH
     │  │   ├── "known_only" → contact_id exists? MATCH : skip
     │  │   ├── "groups" → contact_id exists + in config.allowed_groups? MATCH : skip
     │  │   └── "allowlist" → contact_id in allowed_contacts/groups? MATCH : skip
     │  └── MATCH FOUND → use this config, stop evaluating
     └── NO CONFIG MATCHED → return { allowed: false, reason: "no_matching_config" }
  4. Ensure contact exists (only after a config matched):
     ├── contact_id exists → use it
     └── contact_id is null (matched config's audience_mode must be "all"):
         POST /internal/contacts/create { account_id, name: visitor_name or "Visitor",
           email?, properties: { visitor_id, source: "webchat" } }
         → contact_id = result.contact_id
  5. Find existing Conversation for (contact_id, chat_endpoint_id) — webchat lookup
     ├── Active → append to existing thread
     ├── Resolved → apply matched config's reopen_policy
     ├── Closed → create new Conversation
     └── None → apply matched config's creation_mode
         (if auto: set team_id/assignee_id from config defaults)
  6. Create Message (direction: inbound, sender_type: contact, conversation_id)
  7. Update conversation.last_message_at
  8. Emit conversation.message.created → outbox → RabbitMQ
  9. Return { message_id, conversation_id, created_at, is_new_conversation }
```

The Lambda uses the `is_new_conversation` flag to know whether to subscribe the visitor to the new `conv:{id}` room in DynamoDB.

### 6.5 Visitor Room Subscription Management

When a visitor first sends a message and a conversation is created:

```
1. Lambda calls POST /internal/visitor-message → gets { conversation_id, is_new_conversation: true }
2. Lambda writes to DynamoDB ws_subscriptions:
   { room: "conv:{conversation_id}", connection_id: visitor_conn, user_id: "vs_abc" }
3. Now visitor receives all events pushed to room "conv:{conversation_id}" —
   including agent replies, typing indicators, and status changes
```

The visitor is always subscribed to exactly two rooms:
- `visitor:{visitor_id}` — auto-joined on connect (for system messages, token refresh notices)
- `conv:{conversation_id}` — joined when conversation is created (for live messages)

### 6.6 Widget JavaScript

A small embeddable script hosted by Turumba. Delivered from the `turumba_web_core` monorepo as a standalone bundle — **not** a Next.js page.

**File:** `turumba_web_core/apps/widget/` (new app in Turborepo)

```
apps/widget/
├── src/
│   ├── main.ts              # Entry: reads data-key attr, initializes widget
│   ├── api.ts               # Calls /v1/public/chat/{key} and /session
│   ├── websocket.ts         # AWS WebSocket client + reconnect + token refresh
│   ├── ui.ts                # DOM manipulation (no framework — keep bundle small)
│   └── storage.ts           # localStorage: visitor_id, message history cache
├── vite.config.ts           # Builds to single widget.js IIFE bundle
└── package.json
```

**Widget config (from GET /v1/public/chat/{public_key}):**

```json
{
  "name": "Support Chat",
  "welcome_message": "Hi! How can we help?",
  "offline_message": "We're offline right now. Leave a message and we'll reply soon.",
  "widget_config": {
    "color": "#4F46E5",
    "position": "bottom-right",
    "launcher_text": "Chat with us"
  },
  "pre_chat_form": {
    "enabled": true,
    "fields": [
      { "name": "name", "label": "Your Name", "required": true },
      { "name": "email", "label": "Email", "required": false }
    ]
  }
}
```

This endpoint is **public** (no auth) but rate-limited by `public_key` at the gateway.

---

## 7. Real-Time Push Infrastructure

### 7.1 AWS API Gateway WebSocket — Unified for Agents + Visitors

Single WebSocket API handling both connection types.

```
Agent / Visitor Browser
    │ wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}
    │   ?token={jwt_or_visitor_token}&type={agent|visitor}
    ▼
AWS API Gateway WebSocket
    Routes:
    ├── $connect        → Lambda ws-connect        (validate token, store connection)
    ├── $disconnect     → Lambda ws-disconnect     (cleanup connections + subscriptions)
    ├── subscribe       → Lambda ws-subscribe      (agent: join rooms)
    ├── unsubscribe     → Lambda ws-subscribe      (agent: leave rooms — same Lambda, action from route key)
    ├── typing          → Lambda ws-typing         (agent: relay typing to conv room)
    ├── presence        → Lambda ws-presence       (agent: update presence status)
    ├── visitor_message → Lambda ws-visitor-message (visitor: send message via Messaging API)
    └── visitor_typing  → Lambda ws-visitor-typing  (visitor: relay typing to conv room)
    │
    ▼
DynamoDB Tables:
    ws_connections    — PK: connection_id, GSI: user_id-index
    ws_subscriptions  — PK: room, SK: connection_id, GSI: connection_id-index
    ws_presence       — PK: account_id, SK: user_id (agents only)
```

### 7.2 DynamoDB Tables

**`ws_connections`** — Connection registry (agents + visitors)

| Attribute | Type | Notes |
|-----------|------|-------|
| `connection_id` (PK) | String | API Gateway connection ID |
| `connection_type` | String | `"agent"` or `"visitor"` |
| `user_id` | String | Agent: Cognito sub. Visitor: `"vs_abc123"` |
| `account_ids` | StringSet | Agent: from JWT claims. Visitor: single account_id |
| `email` | String | Agent only (null for visitors) |
| `endpoint_id` | String | Visitor only — chat_endpoint ID |
| `connected_at` | String (ISO) | |
| `ttl` | Number | 24h epoch — auto-cleanup |

GSI: `user_id-index` (PK: `user_id`) — find all connections for a user or visitor.

**`ws_subscriptions`** — Room membership

| Attribute | Type | Notes |
|-----------|------|-------|
| `room` (PK) | String | `"account:{uuid}"`, `"conv:{uuid}"`, `"user:{uuid}"`, `"visitor:{visitor_id}"` |
| `connection_id` (SK) | String | |
| `user_id` | String | Agent user_id or visitor_id |
| `subscribed_at` | String (ISO) | |
| `ttl` | Number | 24h epoch |

GSI: `connection_id-index` (PK: `connection_id`) — cleanup all subscriptions on disconnect.

**`ws_presence`** — Agent presence (agents only, visitors don't have presence)

| Attribute | Type | Notes |
|-----------|------|-------|
| `account_id` (PK) | String | |
| `user_id` (SK) | String | |
| `status` | String | `online`, `away`, `offline` |
| `last_seen` | String (ISO) | |
| `connection_count` | Number | Active connections for this user |
| `ttl` | Number | 5min epoch — heartbeat refresh |

### 7.3 Lambda Functions

All Python 3.12. Connection lifecycle and message forwarding — no business logic.

| Lambda | Route | Connection Type | What It Does |
|--------|-------|----------------|-------------|
| `ws-connect` | `$connect` | Both | Parse `?type` and `?token`. Agent: validate Cognito JWT, store connection, auto-subscribe to `user:{user_id}`. Visitor: call Messaging API `/internal/validate-visitor`, store connection, auto-subscribe to `visitor:{visitor_id}` |
| `ws-disconnect` | `$disconnect` | Both | Query `connection_id-index` on `ws_subscriptions` → batch delete. Delete from `ws_connections`. Agent: decrement presence, set offline if zero connections. |
| `ws-subscribe` | `subscribe` | Agent only | Payload: `{ room: "account:uuid" }` or `{ room: "conv:uuid" }`. Validate access (account_ids check). Put in `ws_subscriptions` |
| `ws-typing` | `typing` | Agent only | Payload: `{ conversation_id, typing: bool }`. Query `ws_subscriptions` for room `conv:{id}` → POST `@connections/{conn_id}` for each (skip sender) |
| `ws-presence` | `presence` | Agent only | Payload: `{ status: "online"/"away"/"offline" }`. Update `ws_presence`. Broadcast to `account:*` rooms |
| `ws-visitor-message` | `visitor_message` | Visitor only | Call Messaging API `/internal/visitor-message`. If new conversation → subscribe visitor to `conv:{id}`. Send ACK frame to visitor |
| `ws-visitor-typing` | `visitor_typing` | Visitor only | Payload: `{ typing: true }`. Lookup visitor's conversation room → relay typing indicator to agents in room |

### 7.4 realtime_push_worker

Python worker in the Messaging API. Consumes RabbitMQ events → resolves rooms → POSTs to AWS API Gateway Management API. **Pushes to both agent and visitor connections through the same mechanism.**

**Relationship with fire-and-forget (Section 8):** For `conversation.message.*` events, the message may have already been pushed directly to WebSocket connections via the immediate path (fire-and-forget pattern). Events carry an `already_pushed: true` flag when this is the case. The worker **skips re-pushing** these messages to avoid duplicates. The worker remains the **primary push mechanism** for non-message events (assigned, status_changed, created) which are not pushed directly.

```
Queue: "realtime.events" (on "messaging" exchange)
Bindings: conversation.* routing keys

For each event:
1. Parse event → extract account_id, conversation_id, assignee_id, etc.
2. Check already_pushed flag:
   - If already_pushed: true AND event is conversation.message.* → skip WS push (already delivered)
   - Otherwise → proceed with push
3. Determine target rooms:
   - conversation.created        → ["account:{account_id}"]
   - conversation.message.*      → ["conv:{conversation_id}", "account:{account_id}"]
   - conversation.assigned       → ["user:{assignee_id}", "account:{account_id}"]
   - conversation.status_changed → ["account:{account_id}"]
4. Query DynamoDB ws_subscriptions for each room
5. POST @connections/{connection_id} for each subscriber
   (this delivers to BOTH agents and visitors subscribed to the room)
6. Handle GoneException (410) → cleanup stale connection
7. ACK the RabbitMQ message
```

The worker doesn't need to know whether a connection belongs to an agent or visitor. It pushes to rooms, and whoever is subscribed receives the event. A visitor subscribed to `conv:{id}` receives the same `conversation:message` events as agents in the same room.

**File:** `turumba_messaging_api/src/workers/realtime_push_worker.py`

### 7.5 WebSocket Events

**Server → Client (push via realtime_push_worker to both agents and visitors):**

| Event | Target Room | Payload |
|---|---|---|
| `conversation:new` | `account:{id}` | `{ conversation_id, channel_id?, chat_endpoint_id?, contact_identifier, status, created_at }` |
| `conversation:updated` | `account:{id}` + `conv:{id}` | `{ conversation_id, status?, assignee_id?, labels?, priority?, last_message_at? }` |
| `conversation:message` | `conv:{id}` | `{ conversation_id, message_id, sender_type, content, is_private, created_at }` |
| `conversation:typing` | `conv:{id}` | `{ user_id, conversation_id, typing: bool }` |
| `agent:presence` | `account:{id}` | `{ user_id, status: "online"/"away"/"offline" }` |
| `notification:assignment` | `user:{id}` | `{ conversation_id, assigned_by }` |

Note: `is_private` messages (internal notes) are pushed to `conv:{id}` room but the realtime_push_worker filters out visitor connections for private messages — only agent connections receive them.

**Agent Browser → Server:**

| Action | Payload | Effect |
|---|---|---|
| `subscribe` | `{ room: "account:{id}" }` | Join account room |
| `subscribe` | `{ room: "conv:{id}" }` | Join conversation room |
| `unsubscribe` | `{ room: "conv:{id}" }` | Leave conversation room |
| `typing` | `{ conversation_id, typing: bool }` | Relay to conv room |
| `presence` | `{ status: "online"/"away"/"offline" }` | Update and broadcast |

**Visitor Browser → Server:**

| Action | Payload | Effect |
|---|---|---|
| `visitor_message` | `{ content, content_type }` | Lambda calls Messaging API, creates message, sends ACK |
| `visitor_typing` | `{ typing: bool }` | Relay to conv room (agents see visitor typing) |

### 7.6 Authentication

**Agent connections:**
- On `$connect`, pass Cognito JWT as `?token={jwt}&type=agent`
- Lambda validates token against Cognito JWKS endpoint (RS256)
- Extracts `sub` (user_id), `email`, `custom:account_ids` from claims
- On token refresh, frontend disconnects and reconnects with new token

**Visitor connections:**
- On `$connect`, pass visitor token as `?token={visitor_token}&type=visitor`
- Lambda calls Messaging API `/internal/validate-visitor` to validate
- Messaging API decodes JWT (HMAC-SHA256), checks chat_endpoint is active
- On token refresh (near expiry), widget calls `/session` endpoint again, disconnects and reconnects

### 7.7 Private Message Filtering

Internal notes (`is_private: true`) must not be pushed to visitor connections. The `realtime_push_worker` handles this:

```python
for connection in room_connections:
    # Skip visitor connections for private messages
    if event.get("is_private") and connection.get("connection_type") == "visitor":
        continue
    await push_to_connection(connection["connection_id"], event_payload)
```

The worker queries `ws_connections` for `connection_type` when pushing to `conv:{id}` rooms that might contain visitors.

---

## 8. Message Delivery Model — Fire-and-Forget Push

The core principle: **WebSocket delivery is immediate. DB persistence is a background operation.**

The previous pipeline — `DB write → outbox → RabbitMQ → realtime_push_worker → WebSocket push` — adds 100–500ms of latency before the recipient sees the message. For a realtime chat product this is unacceptable. The two pipelines must be decoupled.

### 8.1 The Pattern

```
Message arrives (WS frame from visitor or HTTP POST from agent)
         │
         ├── 1. Generate message_id (UUID) in-process — no I/O
         │
         ├── 2. IMMEDIATE PATH (synchronous, before returning to caller):
         │      Push WS event to all connected recipients via API Gateway @connections
         │      ├── Visitor message: push to agent conv room
         │      └── Agent reply: push to visitor + other agents in conv room
         │
         ├── 3. Return response immediately:
         │      Visitor WS: ACK frame  { type: "ack", message_id, created_at }
         │      Agent REST: HTTP 202   { message_id, created_at, status: "queued" }
         │
         └── 4. BACKGROUND PATH (FastAPI BackgroundTask, non-blocking):
                ├── INSERT Message row → PostgreSQL
                ├── UPDATE conversation.last_message_at
                ├── Emit conversation.message.created → outbox → RabbitMQ
                └── (IM channels only) dispatch_worker sends to external platform
```

Steps 2 and 3 complete in < 10ms. Steps 4 run asynchronously — failure does not affect the caller.

The `outbox → RabbitMQ → realtime_push_worker` pipeline still runs, but its role is now **audit and IM platform dispatch**, not primary delivery notification. The `realtime_push_worker` skips pushing a second `conversation:message` event if the message was already pushed directly (keyed on `message_id`).

### 8.1.1 `push_to_room` — Direct WebSocket Push from Messaging API

Both the `/internal/visitor-message` handler and the agent reply endpoint (`POST /conversations/{id}/messages`) call `push_to_room()` directly to achieve < 10ms delivery. This utility function:

1. Queries DynamoDB `ws_subscriptions` for all `connection_id`s in the target room
2. For each connection, queries `ws_connections` to get `connection_type` (needed for private message filtering)
3. POSTs to AWS API Gateway Management API `@connections/{connection_id}` for each subscriber

**This means the Messaging API itself needs direct access to AWS resources:**

| Resource | What For |
|---|---|
| DynamoDB `ws_subscriptions` table | Look up room members |
| DynamoDB `ws_connections` table | Look up connection type for filtering |
| API Gateway Management API (`@connections`) | Push event payload to WebSocket connections |

**Required environment variables:**

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...                 # or use IAM role (preferred in production)
AWS_SECRET_ACCESS_KEY=...
WS_API_GATEWAY_ENDPOINT=https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
WS_CONNECTIONS_TABLE=ws_connections
WS_SUBSCRIPTIONS_TABLE=ws_subscriptions
```

**File:** `turumba_messaging_api/src/realtime/push.py` — shared by both the request handlers (fire-and-forget) and the `realtime_push_worker`.

The `realtime_push_worker` uses the same `push_to_room()` utility. The only difference is the trigger: the worker is triggered by RabbitMQ events, while request handlers call it inline before returning a response.

### 8.2 Visitor Message Flow (Lambda → Messaging API → Push)

For visitor messages, the Lambda `ws-visitor-message` calls the Messaging API `/internal/visitor-message` endpoint. The Messaging API handles both the immediate push and background persistence:

```python
# In /internal/visitor-message handler:
async def handle_visitor_message(
    payload: VisitorMessagePayload,
    background_tasks: BackgroundTasks,
):
    message_id = uuid4()
    now = datetime.now(UTC)

    # Resolve conversation (multi-config evaluation + find existing or create new)
    # Internally: lookup contact → evaluate configs (Section 4.1) → ensure contact → find/create conversation
    conversation = await resolve_visitor_conversation(
        visitor_id=payload.visitor_id,
        account_id=payload.account_id,
        endpoint_id=payload.endpoint_id,
        email=payload.email,  # from pre-chat form, nullable
    )

    # Build the WS event payload
    ws_event = {
        "type": "conversation:message",
        "data": {
            "message_id": str(message_id),
            "conversation_id": str(conversation.id),
            "content": payload.content,
            "sender_type": "contact",
            "is_private": False,
            "created_at": now.isoformat(),
        },
    }

    # IMMEDIATE: Push to agents viewing this conversation
    await push_to_room(f"conv:{conversation.id}", ws_event)
    await push_to_room(f"account:{conversation.account_id}", {
        "type": "conversation:updated",
        "data": {"conversation_id": str(conversation.id), "last_message_at": now.isoformat()},
    })

    # BACKGROUND: DB persist + outbox
    background_tasks.add_task(
        persist_visitor_message,
        message_id=message_id,
        conversation=conversation,
        content=payload.content,
        created_at=now,
    )

    return {
        "message_id": str(message_id),
        "conversation_id": str(conversation.id),
        "created_at": now.isoformat(),
        "is_new_conversation": conversation.is_new,
    }
```

### 8.3 Agent Reply Endpoint

```python
@router.post("/conversations/{id}/messages", status_code=202)
async def agent_send_message(
    id: UUID,
    body: ConversationMessageCreate,
    background_tasks: BackgroundTasks,
    current_user_id: UUID = Depends(get_current_user_id),
    conversation: Conversation = Depends(get_conversation_or_404),
):
    message_id = uuid4()
    now = datetime.now(UTC)

    ws_event = {
        "type": "conversation:message",
        "data": {
            "message_id": str(message_id),
            "conversation_id": str(id),
            "content": body.content,
            "sender_type": "agent",
            "sender_id": str(current_user_id),
            "is_private": body.is_private,
            "created_at": now.isoformat(),
        },
    }

    # IMMEDIATE: Push to all subscribers in conv room
    # (includes both agents AND the visitor if it's a webchat conversation)
    # Private notes are filtered by push_to_room — visitor connections skipped
    await push_to_room(f"conv:{id}", ws_event, skip_visitors=body.is_private)

    # Return 202 immediately
    response_data = {
        "message_id": str(message_id),
        "created_at": now.isoformat(),
        "status": "queued",
    }

    # BACKGROUND: DB persist + dispatch to IM platform + outbox
    background_tasks.add_task(
        persist_and_dispatch_agent_message,
        message_id=message_id,
        conversation=conversation,
        content=body.content,
        sender_id=current_user_id,
        is_private=body.is_private,
        created_at=now,
    )

    return SuccessResponse(data=response_data)
```

### 8.4 Background Persistence Task

```python
async def persist_and_dispatch_agent_message(
    message_id: UUID,
    conversation: Conversation,
    content: str,
    sender_id: UUID,
    is_private: bool,
    created_at: datetime,
):
    """
    Runs after the WS push has already been delivered.
    DB write failure must not lose the message silently.
    """
    for attempt in range(3):
        try:
            async with db_session() as db:
                message = Message(
                    id=message_id,
                    conversation_id=conversation.id,
                    content=content,
                    direction="outbound",
                    sender_type="agent",
                    sender_id=sender_id,
                    is_private=is_private,
                    channel_id=conversation.channel_id,              # set for IM, None for webchat
                    chat_endpoint_id=conversation.chat_endpoint_id,  # set for webchat, None for IM
                    account_id=conversation.account_id,
                    created_at=created_at,
                )
                db.add(message)

                conversation.last_message_at = created_at
                if not conversation.first_reply_at:
                    conversation.first_reply_at = created_at

                event_bus.emit(
                    EventType.CONVERSATION_MESSAGE_SENT,
                    {"message_id": str(message_id), "already_pushed": True},
                )
                await OutboxMiddleware.flush(db)
                await db.commit()
            return

        except Exception as exc:
            if attempt == 2:
                logger.error("Message persistence failed after 3 attempts",
                             message_id=message_id, error=str(exc))
                await push_message_failed(sender_id, message_id)
                await enqueue_dead_letter("message_persistence_dlq", {
                    "message_id": str(message_id),
                    "conversation_id": str(conversation.id),
                    "content": content,
                    "error": str(exc),
                })
            else:
                await asyncio.sleep(0.1 * (2 ** attempt))
```

The pre-generated `message_id` is used for the DB insert — this ensures the ID the client already received in the ACK matches the persisted record.

### 8.5 Inbound IM Messages (Webhook Path)

For WhatsApp, Telegram, and other IM platforms, the inbound webhook already ACKs 200 immediately. But agents don't see the message until the inbound worker processes it through RabbitMQ — typically 200–800ms. Optimize with a direct push:

```
POST /v1/webhooks/whatsapp/{channel_id}
    │
    ├── Verify HMAC (sync, fast)
    ├── Parse payload (sync, fast)
    ├── Return 200 immediately
    │
    ├── IMMEDIATE PATH (background, high-priority):
    │   Resolve account_id + channel → push raw inbound event to known agent rooms
    │   (agents see it appear instantly, may briefly show without conversation context)
    │
    └── STANDARD PATH (existing inbound_message_worker):
        Full processing: Contact lookup (internal API), Conversation find/create,
        Message INSERT, event emission
        → sends a "confirmed" WS event that replaces the optimistic push
```

### 8.6 Client-Side Reconciliation

The frontend must handle the optimistic-then-confirmed pattern:

```typescript
// On sending (agent):
// 1. Render message immediately in chat view using local state (optimistic)
// 2. Store pending message: { tempId: uuid, content, status: "sending" }

// On WS ACK received:
// 3. Update pending message: { message_id: confirmedId, status: "sent" }

// On WS "message:failed" event:
// 4. Update pending message: { status: "failed" }
// 5. Show retry button

// On receiving push from realtime_push_worker (with already_pushed: true):
// 6. Deduplicate by message_id — do NOT add a second copy
```

Deduplication is keyed on `message_id`. The `realtime_push_worker` includes `"already_pushed": true` in the event payload when the message was already delivered via the direct path, so the client knows to skip re-rendering.

### 8.7 Failure Modes and Guarantees

| Scenario | Outcome |
|---|---|
| WS push succeeds, DB write succeeds | Normal — message delivered and persisted |
| WS push succeeds, DB write fails all retries | Message seen by recipient but not in history. Dead-lettered for recovery. Sender sees error indicator. |
| WS push fails (stale connection), DB write succeeds | Recipient misses real-time push but message is in DB. Next page load shows it. |
| Both fail | Message lost. Sender sees error. Must retry manually. |

This model favors delivery latency over strict durability. For a support chat product, showing the message instantly to the agent (even if persistence briefly lags) is the correct trade-off.

---

## 9. API Reference

### 9.1 Messaging API — Conversations

```
POST   /v1/conversations/                     # Create (usually by inbound worker)
GET    /v1/conversations/                     # List inbox (filterable)
GET    /v1/conversations/{id}                 # Detail
PATCH  /v1/conversations/{id}                 # Update status, assignee, labels, priority
DELETE /v1/conversations/{id}                 # Soft-close (status → closed)

POST   /v1/conversations/{id}/messages        # Send agent reply or internal note
GET    /v1/conversations/{id}/messages        # Message history (chronological, paginated)
```

**Key filters for inbox:**
```
?status=open
?status=assigned&assignee_id={my_user_id}
?status=assigned&team_id={team_id}
?sort=last_message_at:desc
?channel_id={channel_id}
?priority=high&status=open
```

### 9.2 Messaging API — Chat Endpoints

```
POST   /v1/chat-endpoints/                    # Create webchat point (auth)
GET    /v1/chat-endpoints/                    # List (auth, account-scoped)
GET    /v1/chat-endpoints/{id}                # Detail (auth)
PATCH  /v1/chat-endpoints/{id}                # Update config (auth)
DELETE /v1/chat-endpoints/{id}                # Deactivate (auth)

GET    /v1/public/chat/{public_key}           # Widget config (public, no auth)
POST   /v1/public/chat/{public_key}/session   # Start/resume visitor session (public)
```

### 9.3 Messaging API — Conversation Configs

```
POST   /v1/conversation-configs/              # Create config (account-scoped)
GET    /v1/conversation-configs/              # List configs (account-scoped, ordered by priority)
GET    /v1/conversation-configs/{id}          # Detail
PATCH  /v1/conversation-configs/{id}          # Update config
DELETE /v1/conversation-configs/{id}          # Delete config
```

Multiple configs per account. Each has a `priority` and `name`. Evaluated in priority order at runtime.

### 9.4 Account API — Teams

```
POST   /v1/teams/                        # Create team
GET    /v1/teams/                        # List teams (account-scoped)
GET    /v1/teams/{id}                    # Team detail
PATCH  /v1/teams/{id}                    # Update team
DELETE /v1/teams/{id}                    # Deactivate team

# Team membership (sub-resource, like groups/{id}/persons)
POST   /v1/teams/{id}/members           # Add member { user_id }
GET    /v1/teams/{id}/members           # List members
DELETE /v1/teams/{id}/members/{user_id} # Remove member

# User's teams (convenience)
GET    /v1/users/{id}/teams             # List teams a user belongs to
```

### 9.5 Account API — Internal Endpoints (Service-to-Service)

```
POST   /internal/contacts/lookup            # Find contact by phone or email
POST   /internal/contacts/check-membership  # Check if contact belongs to specified groups
POST   /internal/contacts/create            # Create contact (no auth, account_id in body)
```

These endpoints are **not routed through KrakenD**. They are accessible only on the Docker network (`gt_turumba_account_api:8000`). The Messaging API calls them during the conversation creation flow (Section 4.2). No JWT validation — trusted service-to-service calls.

### 9.6 Messaging API — Internal Endpoints (Lambda Callbacks)

```
POST   /internal/validate-visitor             # Validate visitor JWT, return context
POST   /internal/visitor-message              # Create message from visitor
```

These endpoints are **not routed through KrakenD**. They are accessible only on the Docker network (`gt_turumba_messaging_api:8000`). Lambdas reach them via the Messaging API's internal URL configured as an environment variable (`MESSAGING_API_INTERNAL_URL`).

---

## 10. Event Types

Add to `turumba_messaging_api/src/events/event_types.py`:

```python
CONVERSATION_CREATED         = "conversation.created"
CONVERSATION_ASSIGNED        = "conversation.assigned"
CONVERSATION_STATUS_CHANGED  = "conversation.status_changed"
CONVERSATION_RESOLVED        = "conversation.resolved"
CONVERSATION_MESSAGE_CREATED = "conversation.message.created"
CONVERSATION_MESSAGE_SENT    = "conversation.message.sent"
```

RabbitMQ topology additions:
- New queue: `realtime.events` (durable) on `messaging` exchange
- Bindings: all `conversation.*` routing patterns
- New queue: `conversation.inbound` — raw inbound events from webhooks

---

## 11. Frontend Integration

### 11.1 Agent WebSocket Manager

**File:** `turumba_web_core/apps/turumba/lib/realtime/websocket-manager.ts`

Singleton managing the agent's AWS WebSocket connection:
- Connect with Cognito JWT (`?token={jwt}&type=agent`)
- Auto-reconnect with exponential backoff (max 5 retries, then show banner)
- Subscribe to `account:{id}` room on connect
- Room subscription management (subscribe/unsubscribe for conversations)
- Event dispatch to registered listeners via EventEmitter
- Heartbeat/keepalive every 30s
- Graceful disconnect + reconnect on token refresh

### 11.2 React Hooks

**File:** `turumba_web_core/apps/turumba/lib/realtime/use-realtime.ts`

```typescript
// Inbox: new conversations, conversation status updates
const { newConversations, updatedConversations } = useInboxRealtime(accountId);

// Active conversation: live messages, typing indicators
const { messages, typing } = useConversationRealtime(conversationId);

// Agent presence map across account
const { presenceMap } = usePresenceRealtime(accountId);
```

### 11.3 Conversation Inbox UI

**File:** `turumba_web_core/apps/turumba/features/conversations/`

```
features/conversations/
├── components/
│   ├── ConversationInbox.tsx       # Left panel: list of conversations
│   ├── ConversationChatView.tsx    # Right panel: message thread + reply compose
│   ├── ConversationFilters.tsx     # Status, assignee, channel filters
│   ├── MessageBubble.tsx           # Single message (inbound/outbound/private)
│   ├── ReplyCompose.tsx            # Textarea + send
│   ├── TypingIndicator.tsx         # Animated dots when agent/visitor is typing
│   ├── AgentPresenceBadge.tsx      # Green/yellow/grey dot for agent status
│   └── ChatEndpointManager.tsx     # Admin UI for managing chat endpoints
├── services/
│   ├── conversations.ts            # REST API calls (list, get, update, messages)
│   └── chat-endpoints.ts           # Chat endpoint CRUD
├── store/
│   └── inbox-store.ts              # Zustand: active conversation, filters
├── types/
│   └── index.ts                    # Conversation, Message types
└── index.ts
```

### 11.4 Chat Widget (Embeddable)

Separate standalone build — not part of the Next.js app. Compiles to a single `widget.js` file.

**Path:** `turumba_web_core/apps/widget/` (new app in Turborepo)

```
apps/widget/
├── src/
│   ├── main.ts              # Entry: reads data-key attr, initializes widget
│   ├── api.ts               # Calls /v1/public/chat/{key} and /session
│   ├── websocket.ts         # AWS WebSocket client (same API Gateway as agents)
│   ├── ui.ts                # DOM manipulation (no framework — keep bundle small)
│   └── storage.ts           # localStorage: visitor_id, message history cache
├── vite.config.ts           # Builds to single widget.js IIFE bundle
└── package.json
```

The widget's WebSocket connects to the same AWS API Gateway as agents, using `?type=visitor&token={visitor_token}`.

---

## 12. Local Development

### 12.1 WebSocket (AWS Shim)

**File:** `turumba_messaging_api/src/dev/local_ws_server.py`

Lightweight FastAPI WebSocket endpoint that mimics the AWS API Gateway behavior using in-memory dicts. Supports all routes for both agents and visitors: subscribe, unsubscribe, typing, presence, visitor_message, visitor_typing.

Set `LOCAL_WS_MODE=true` in `.env`:
- `realtime_push_worker` pushes to this server instead of calling AWS APIs
- Agent frontend connects to `ws://localhost:8001` instead of AWS
- Widget connects to `ws://localhost:8001?type=visitor` instead of AWS

The local WS server also implements the Lambda callback logic inline — it calls the Messaging API `/internal/validate-visitor` and `/internal/visitor-message` endpoints directly, simulating the Lambda → Messaging API flow.

### 12.2 Widget Development

```bash
cd turumba_web_core/apps/widget
pnpm dev    # Serves widget.js at http://localhost:4000/widget.js
```

Test by embedding in a local HTML file:
```html
<script src="http://localhost:4000/widget.js" data-key="your-test-key"></script>
```

---

## 13. Deployment

### 13.1 AWS WebSocket Infrastructure

Manual AWS Console setup first to validate:
1. Create API Gateway WebSocket API
2. Create DynamoDB tables with GSIs (ws_connections, ws_subscriptions, ws_presence)
3. Create Lambda functions with IAM roles
4. Configure routes ($connect, $disconnect, subscribe, typing, presence, visitor_message, visitor_typing)
5. Configure Lambda environment: `MESSAGING_API_INTERNAL_URL`, `COGNITO_USER_POOL_ID`, `COGNITO_JWKS_URL`
6. Deploy and test with a WebSocket client

Codify later with CloudFormation, CDK, SAM, or Terraform once validated.

### 13.2 Lambda → Messaging API Connectivity

The Lambdas need to reach the Messaging API's internal endpoints. Two approaches:

**Option A: VPC Lambda + Docker network (recommended for single-region)**
- Lambdas run in the same VPC as ECS/Docker services
- Reach Messaging API via internal DNS or service discovery
- `MESSAGING_API_INTERNAL_URL=http://messaging-api.internal:8000`

**Option B: API Gateway HTTP API (simpler, works across regions)**
- Create a private HTTP API Gateway in front of the Messaging API
- Lambdas call via the private API Gateway URL
- Add API key or IAM auth to prevent external access

### 13.3 Messaging API — New Environment Variables

The Messaging API needs AWS access for direct WebSocket push (fire-and-forget, Section 8.1.1) and the `realtime_push_worker`:

```
# AWS WebSocket push (used by push_to_room utility + realtime_push_worker)
AWS_REGION=us-east-1
WS_API_GATEWAY_ENDPOINT=https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
WS_CONNECTIONS_TABLE=ws_connections
WS_SUBSCRIPTIONS_TABLE=ws_subscriptions

# Visitor token signing (used by /session endpoint and /internal/validate-visitor)
VISITOR_JWT_SECRET=<random-256-bit-secret>

# Account API internal URL (for contact lookup/create during conversation creation)
ACCOUNT_API_INTERNAL_URL=http://gt_turumba_account_api:8000
```

AWS credentials: use IAM roles in production (ECS task role), `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` for local development.

---

## 14. Implementation Phases

### Phase 1: Conversation Foundation (P0)

Goal: Data layer. Conversations exist, messages link to them.

| Task | Service | Spec |
|---|---|---|
| Conversation model & CRUD | Messaging API | CONV-BE-001 |
| Message model extensions (conversation_id, is_private, sender_type) + nested endpoints | Messaging API | CONV-BE-002 |
| ConversationConfig model + CRUD + creation flow logic | Messaging API | New spec needed |
| Teams + TeamMembers models & CRUD + membership endpoints | Account API | New spec needed |
| Gateway route configuration for conversation + teams endpoints | Gateway | CONV-GW-001 |

### Phase 2: Real-Time Infrastructure (P1)

Goal: Live push to agents and visitors. Typing indicators, presence.

| Task | Service | Spec |
|---|---|---|
| AWS WebSocket API + DynamoDB tables + Lambda functions (agent + visitor routes) | AWS | CONV-AWS-001 |
| realtime_push_worker + RabbitMQ topology | Messaging API | CONV-BE-006 |
| Internal endpoints for Lambda callbacks (/internal/validate-visitor, /internal/visitor-message) | Messaging API | New spec needed |

### Phase 3: Live Chat Widget (P1)

Goal: Embeddable webchat channel through unified WebSocket.

| Task | Service | Spec |
|---|---|---|
| ChatEndpoint model + CRUD + public session API + visitor token signing | Messaging API | New spec needed |
| Widget JavaScript bundle (Vite app) | Web Core | New spec needed |
| Gateway routes for chat-endpoints + public endpoints (rate-limited) | Gateway | Add to CONV-GW-001 |

### Phase 4: Frontend Integration (P1)

Goal: Wire existing mock UI to real APIs and WebSocket.

| Task | Service | Spec |
|---|---|---|
| WebSocket client + React hooks | Web Core | CONV-FE-001 |
| Conversation inbox + chat view UI | Web Core | CONV-FE-002 |

### Phase 5: Advanced Features (Future)

- Canned responses (pre-saved reply snippets with variable interpolation)
- Bot-first routing (auto-reply, auto-assign based on rules)
- Agent preferences (availability, working hours, max concurrent conversations)
- AI-powered intent classification
- Multi-turn bot conversations with knowledge base
- CSAT survey after resolution
- SLA tracking + breach alerts
- Agent performance analytics

---

## 15. Summary of Changes Per Service

| Service | New Models | New Endpoints | Other Changes |
|---|---|---|---|
| **Messaging API** | Conversation (with channel_id/chat_endpoint_id mutual exclusion), ChatEndpoint, ConversationConfig + extend Message (add conversation_id, chat_endpoint_id, is_private, sender_type, sender_id; make channel_id nullable) | Conversations CRUD, conv messages, chat endpoints, conversation config, public chat API, internal Lambda callback endpoints | realtime_push_worker, `push_to_room` direct WS push utility, visitor message handler, conversation creation flow with multi-config evaluation, fire-and-forget push logic, new env vars for AWS + visitor JWT |
| **AWS** | — | WebSocket API (wss://) | API Gateway + 7 Lambda routes + 3 DynamoDB tables (unified for agents + visitors) |
| **Account API** | Team, TeamMember | Teams CRUD, team membership, user's teams, **internal endpoints** (/internal/contacts/lookup, check-membership, create) | New models, schemas, controllers, routers, internal service-to-service endpoints |
| **Gateway** | — | — | Routes for conversations, chat endpoints, conversation config (→ Messaging API), teams (→ Account API); rate limiting on public endpoints |
| **Web Core** | — | — | WebSocket manager, React hooks, conversation inbox UI, new `widget` app (Vite) |

---

## 16. Related Documents

- `docs/plans/conversations/ARCHITECTURE.md` — Detailed omnichannel architecture (data models, flows, AWS WebSocket spec)
- `docs/tasks/conversations/README.md` — Conversation task index with dependency graph
- `docs/TURUMBA_DELIVERY_CHANNELS.md` — Delivery channel types and adapter framework
