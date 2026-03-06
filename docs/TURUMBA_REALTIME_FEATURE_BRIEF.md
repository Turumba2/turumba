# Turumba Realtime Messaging — Feature Brief

> **Audience:** UI/UX Designers & System Analysts
> **Purpose:** Comprehensive overview of the Turumba Realtime Messaging feature — what it does, how users interact with it, what screens and flows need to be designed, and how the system works under the hood.

---

## 1. What Is Turumba Realtime Messaging?

Turumba Realtime Messaging adds **live, two-way conversations** to the Turumba platform. It lets account teams (agents) hold real-time support conversations with their end-users (customers/visitors) — all from a single unified inbox.

There are **two ways** a conversation can start:

| Entry Point | How It Works |
|---|---|
| **Omnichannel IM** | Customers message via WhatsApp, Telegram, Messenger, SMS, or Email. These arrive as inbound webhooks and appear in the agent inbox. |
| **Live Chat Widget** | A small embeddable chat bubble on the account's own website. Visitors click it, optionally fill a pre-chat form, and start chatting in real time. |

Both paths create the same `Conversation` record. **Agents work from one inbox regardless of how the customer reached out.**

### Key Capabilities

| Capability | Description |
|---|---|
| **Unified Inbox** | All conversations from all channels in one place |
| **Real-Time Push** | Messages, typing indicators, and presence updates appear instantly — no page refresh |
| **Teams & Assignment** | Conversations can be assigned to teams (e.g., Billing, Sales) and then picked up by individual agents |
| **Internal Notes** | Agents can leave private notes inside a conversation that are invisible to the customer |
| **Conversation Lifecycle** | Status progression: open, assigned, pending, resolved, closed |
| **Priority & Labels** | Conversations can be tagged with priority levels (low, normal, high, urgent) and custom labels |
| **Live Chat Widget** | Customizable, embeddable webchat for the account's website — with branding, pre-chat forms, and welcome messages |
| **Agent Presence** | Online/away/offline status visible to other agents |

---

## 2. User Roles & Personas

### 2.1 Agent (Internal User)

An authenticated Turumba user who handles conversations. Agents log into the Turumba dashboard (Next.js web app) and interact with the inbox.

**What agents do:**
- View and filter conversations in the inbox
- Open a conversation to read the message thread
- Reply to customers (text messages through the original channel)
- Add internal notes (visible only to other agents)
- Assign conversations to teammates or teams
- Change conversation status (pending, resolved, closed)
- Set their own presence (online, away, offline)
- See typing indicators when a customer or another agent is typing
- Manage chat endpoints (admin agents)

### 2.2 Visitor (External User — Website Chat)

An anonymous or semi-identified person on the account's website who uses the live chat widget.

**What visitors do:**
- Click the chat launcher bubble
- Optionally fill a pre-chat form (name, email)
- Send and receive messages in real time
- See typing indicators when an agent is typing
- Receive a welcome message when opening the widget

### 2.3 Customer (External User — IM Channels)

A person who messages via WhatsApp, Telegram, Messenger, SMS, or Email. They use their native app — they never see the Turumba UI. Their messages flow into the agent inbox.

### 2.4 Account Admin

An agent with admin privileges who can:
- Create and configure **Chat Endpoints** (live chat widgets)
- Create and configure **Conversation Configs** (routing rules)
- Manage **Teams** and team membership

---

## 3. Screens & UI Components to Design

### 3.1 Agent Inbox (Primary Screen)

The heart of the feature. A split-panel layout:

```
+---------------------------------------------+
|  INBOX SIDEBAR        |  CONVERSATION VIEW   |
|                       |                      |
|  [Filters & Search]   |  [Contact Header]    |
|                       |  [Channel Badge]     |
|  Conversation 1  *    |                      |
|    "Hi, I need..."    |  --- Messages ---    |
|    WhatsApp | 2m ago  |                      |
|                       |  [Agent Reply]       |
|  Conversation 2       |  [Visitor Message]   |
|    "Order #1234..."   |  [Internal Note]     |
|    Telegram | 5m ago  |  [System Event]      |
|                       |                      |
|  Conversation 3       |  --- Compose ---     |
|    "Website issue"    |  [Reply | Note toggle]|
|    Webchat | 12m ago  |  [Text Area + Send]  |
|                       |  [Typing Indicator]  |
+---------------------------------------------+
```

**Left Panel — Conversation List:**
- Each item shows: contact name/identifier, last message preview, channel icon (WhatsApp/Telegram/webchat/etc.), timestamp, unread indicator, priority badge, assignee avatar
- Filter bar: by status (open, assigned, pending, resolved), by assignee (me, unassigned, specific agent), by team, by channel, by priority
- Sort: by last message time (default, newest first)
- Real-time updates: new conversations slide in at the top, existing ones reorder when new messages arrive

**Right Panel — Conversation Thread:**
- Header: contact name, channel type badge, conversation status, priority, labels, assignee
- Action buttons: Assign (to agent or team), Change Status, Set Priority, Add Label
- Message thread (scrollable, chronological):
  - **Inbound messages** (from customer) — left-aligned bubbles
  - **Outbound messages** (from agent) — right-aligned bubbles
  - **Internal notes** — visually distinct (e.g., yellow/amber background, "private" badge), only visible to agents
  - **System events** — inline, muted text (e.g., "Conversation assigned to Billing Team", "Status changed to pending")
- Typing indicator at the bottom when customer or another agent is typing
- Compose area:
  - Toggle between "Reply" (sends to customer) and "Note" (private, internal)
  - Text area with send button
  - Reply mode should show which channel the reply goes through (e.g., "Replying via WhatsApp")

### 3.2 Conversation Detail / Actions

When an agent opens a conversation, they need access to:

| Action | Description |
|---|---|
| **Assign to Agent** | Dropdown of agents (show presence: online/away/offline). Assignee gets a notification. |
| **Assign to Team** | Dropdown of teams. All team members see it in their queue. |
| **Change Status** | Allowed transitions: open -> assigned, assigned -> pending/resolved, pending -> assigned/resolved, resolved -> closed. Customer reply after "resolved" reopens automatically. |
| **Set Priority** | Low, Normal, High, Urgent — color-coded badges |
| **Add Labels** | Free-form tags (e.g., "billing", "bug", "feature-request") |
| **Contact Info** | Side panel or expandable section showing contact details from Account API |

### 3.3 Conversation Status Lifecycle

Design a clear visual language for each status:

```
  open          assigned        pending         resolved        closed
  (new,         (agent is       (waiting for    (issue          (archived,
   unassigned)   working on it)  customer reply)  addressed)      terminal)
```

**Valid transitions:**

```
open ---------> assigned -------> pending -------> resolved -------> closed
  |               ^    |            |                 |
  +---------------+    +------------+                 |
  (manual assign)  (agent sets pending,               |
                    waiting for reply)                 |
                                                      |
  Customer sends new message after resolved ----------+---> reopens as "open"
```

Design consideration: "Closed" is terminal — the conversation disappears from the active inbox and moves to a history/archive view.

### 3.4 Agent Presence

Each agent has a presence status visible to other agents:

| Status | Visual | Meaning |
|---|---|---|
| **Online** | Green dot | Agent is actively using Turumba |
| **Away** | Yellow/amber dot | Agent stepped away or idle |
| **Offline** | Grey dot | Agent is not connected |

Presence appears:
- Next to agent names in the assignment dropdown
- In a team members list or sidebar
- Updated in real time (no refresh needed)

### 3.5 Typing Indicators

Two directions:
- **Customer is typing** — shown at the bottom of the conversation thread (e.g., animated dots with "Visitor is typing...")
- **Agent is typing** — shown to the customer in the chat widget, and to other agents viewing the same conversation

### 3.6 Pending Messages View (Manual Creation Mode)

Some conversation configs use `creation_mode: "manual"`, meaning inbound messages arrive but no conversation is auto-created. These appear in a **Pending Messages** queue:

- List of unthreaded inbound messages (no conversation yet)
- Agent can select one or more messages and click "Create Conversation" to group them into a new thread
- Think of this as a triage/screening queue

---

## 4. Live Chat Widget (Embeddable)

### 4.1 Widget States & Flow

The chat widget is embedded on the account's own website via a script tag. It goes through these states:

```
1. LAUNCHER (collapsed)
   - Floating button in corner (default: bottom-right)
   - Shows launcher text (e.g., "Chat with us")
   - Customizable color from widget config

2. PRE-CHAT FORM (if enabled)
   - Opens on first click
   - Configurable fields: Name (required/optional), Email (required/optional)
   - Submit starts the session

3. CHAT WINDOW (active)
   - Welcome message displayed first (if configured)
   - Message thread (visitor messages right, agent messages left)
   - Text input + send button
   - Typing indicator when agent is typing
   - Minimize button to collapse back to launcher

4. OFFLINE STATE
   - If no agents are online (presence check)
   - Shows offline message (configurable)
   - Can still allow message submission (async reply)
```

### 4.2 Widget Customization (Chat Endpoint Config)

Account admins configure each widget via the dashboard. Designers need a **Chat Endpoint Management** screen:

| Setting | Type | Description |
|---|---|---|
| **Name** | Text | Internal label, e.g., "Support Chat", "Sales Inquiry" |
| **Brand Color** | Color picker | Primary color for the widget (launcher, header, send button) |
| **Position** | Dropdown | `bottom-right` or `bottom-left` |
| **Launcher Text** | Text | Button label, e.g., "Chat with us", "Need help?" |
| **Welcome Message** | Textarea | First message shown when chat opens |
| **Offline Message** | Textarea | Shown when no agents are online |
| **Pre-Chat Form** | Toggle + field builder | Enable/disable, add fields (name, email, custom) with required/optional |
| **Allowed Origins** | Tag input | CORS domains (e.g., `https://example.com`). Empty = all allowed. |
| **Active/Inactive** | Toggle | Enable or disable the widget |
| **Embed Code** | Read-only snippet | Auto-generated `<script>` tag with the public key |

**Chat Endpoint List View:**
- Table/card list of all chat endpoints for the account
- Shows: name, status (active/inactive), public key (truncated), created date
- Actions: edit, deactivate, copy embed code

### 4.3 Widget Visual Design Notes

- The widget is a **standalone JavaScript bundle** — it renders its own DOM (not React/Next.js). Keep it lightweight.
- It should work on any website without conflicting with the host page's styles (shadow DOM or scoped CSS).
- The widget inherits no styles from the Turumba dashboard — it needs its own complete design system (minimal: colors, typography, spacing, bubbles).
- Responsive: must work on mobile browsers too (full-screen or near-full-screen on small viewports).

---

## 5. Conversation Routing & Configuration

### 5.1 What Are Conversation Configs?

Conversation Configs are rules that control **when, how, and for whom** conversations are created. An account can have **multiple configs**, each targeting different channels/widgets and different audiences. They are evaluated in priority order — first match wins.

This is an **admin-facing** feature. Designers need a management screen.

### 5.2 Config Properties

| Property | Description | Design Implication |
|---|---|---|
| **Name** | Human label, e.g., "VIP WhatsApp Support" | Text input |
| **Priority** | Evaluation order (lower = first). Determines which config wins when multiple could match. | Number input or drag-to-reorder list |
| **Source Targeting** | Which channels and/or chat endpoints this config applies to | Multi-select from existing channels + chat endpoints |
| **Audience Mode** | Who is allowed to create conversations | Radio/dropdown: All, Known Contacts Only, Specific Groups, Allowlist |
| **Allowed Groups** | Groups whose contacts are permitted (when audience = groups/allowlist) | Multi-select from account groups |
| **Allowed Contacts** | Individual contacts permitted (when audience = allowlist) | Multi-select/search contacts |
| **Creation Mode** | `auto` (conversation created immediately) or `manual` (agent must create manually) | Radio toggle |
| **Reopen Policy** | What happens when a customer messages after a conversation was resolved | Radio: Always Reopen, Always New, Threshold (with hours input) |
| **Reopen Window** | Hours threshold for the "threshold" reopen policy | Number input (shown conditionally) |
| **Default Team** | Auto-assign new conversations to this team | Dropdown of teams |
| **Default Assignee** | Auto-assign to a specific agent | Dropdown of agents |
| **Active/Inactive** | Toggle to enable/disable the config | Toggle switch |

### 5.3 Config List View

- Ordered list (by priority) of all configs for the account
- Drag-to-reorder for changing priority
- Each item shows: name, priority number, source badges (channel/widget icons), audience mode badge, creation mode, active status
- Actions: edit, activate/deactivate, delete

### 5.4 Config Evaluation — How It Works (For System Analysts)

When an inbound message arrives:

```
1. Identify source (which channel or chat endpoint)
2. Look up the contact (is this a known person?)
3. Load all active configs, sorted by priority (ascending)
4. For each config (in order):
   a. Does this config target this source? (channel/widget match)
      - No -> skip, try next config
   b. Does this sender pass the audience check?
      - "all" -> match
      - "known_only" -> only if contact exists in the system
      - "groups" -> only if contact is in one of the allowed groups
      - "allowlist" -> only if contact is explicitly listed
      - Fail -> skip, try next config
   c. MATCH -> use this config, stop evaluating
5. No config matched -> no conversation created (message is logged but unthreaded)
```

**Example scenarios:**

| Scenario | Config Matched | Result |
|---|---|---|
| VIP customer messages on Telegram | "VIP Telegram" (priority 1, groups: VIP) | Routed to VIP support team |
| Unknown person messages on Telegram | "General Telegram" (priority 2, audience: all) | Auto-created, general handling |
| Someone opens webchat | "Website Support Chat" (priority 3, audience: all) | Auto-created, assigned to general team |
| Someone sends WhatsApp (no config covers it) | None | No conversation — message logged only |

---

## 6. Teams

### 6.1 What Are Teams?

Teams are organizational groups of agents. They enable conversation routing — a conversation can be assigned to a team before an individual agent picks it up.

Examples: "Billing Support", "Technical Support", "Sales", "VIP"

### 6.2 Team Management Screen

**Team List:**
- Table/card list of all teams for the account
- Columns: name, member count, team lead, active status
- Actions: edit, manage members, deactivate

**Team Detail / Edit:**
- Name, description
- Team lead (dropdown of agents)
- Active/inactive toggle
- Member list with add/remove functionality

**Team Members:**
- List of agents in the team
- Each shows: name, email, role (member or lead), presence status
- Add member: search/select from account users
- Remove member: confirm dialog
- An agent can belong to multiple teams

### 6.3 Team in Inbox Context

- Inbox filter: "My Teams" shows conversations assigned to teams the agent belongs to
- Assignment dropdown groups agents by team
- Conversation header shows team badge when assigned to a team

---

## 7. System Architecture (For System Analysts)

### 7.1 High-Level Architecture

```
                     EXTERNAL

  WhatsApp ----+
  Telegram ----+---> Webhooks ---> KrakenD Gateway ---> Messaging API
  Messenger ---+                                            |
  SMS ---------+                                            |
  Email -------+                                       PostgreSQL
                                                       (conversations,
  Website Visitor ---> Chat Widget ---> AWS WebSocket    messages,
                                           |             chat_endpoints,
                                        Lambdas           configs)
                                           |
                                      Messaging API        |
                                           |          RabbitMQ
  Agent Browser <--- Next.js App <--- AWS WebSocket   (event queues)
                                           |
                                       DynamoDB
                                    (connections,
                                     subscriptions,
                                     presence)
```

### 7.2 Two Communication Paths

| Path | Used For | How It Works |
|---|---|---|
| **REST API** (HTTP) | Agent actions: reply, assign, change status, CRUD operations | Standard request/response through KrakenD gateway |
| **WebSocket** (persistent connection) | Real-time push: new messages, typing, presence, inbox updates | Agent and visitor browsers hold open connections to AWS API Gateway |

### 7.3 Message Flow Summary

**Inbound (customer -> agent):**

```
Customer sends message (WhatsApp/Telegram/etc.)
  -> Provider webhook hits Turumba
  -> Inbound worker processes it
  -> Finds or creates Conversation
  -> Creates Message record
  -> Pushes real-time event to agent's browser via WebSocket
  -> Agent sees it instantly in inbox
```

**Inbound (visitor -> agent via webchat):**

```
Visitor types message in chat widget
  -> WebSocket frame sent to AWS API Gateway
  -> Lambda calls Messaging API internal endpoint
  -> Messaging API finds/creates Conversation + Message
  -> Pushes event to agent's browser via WebSocket
  -> Sends ACK back to visitor's widget
  -> Agent sees it instantly in inbox
```

**Outbound (agent -> customer):**

```
Agent types reply and clicks Send
  -> POST to Messaging API
  -> Message pushed to WebSocket immediately (< 10ms)
  -> Visitor/customer sees it in real time
  -> Background: message persisted to DB
  -> Background (IM only): dispatched to WhatsApp/Telegram/etc. via channel adapter
```

### 7.4 Key System Entities

| Entity | Owner | Purpose |
|---|---|---|
| **Conversation** | Messaging API | A support thread between an agent and a contact. Has status, priority, labels, assignee, team. |
| **Message** | Messaging API | A single message within a conversation. Can be inbound (from contact), outbound (from agent), or a private internal note. |
| **Chat Endpoint** | Messaging API | Configuration for an embeddable chat widget. Has public_key, branding, pre-chat form config. |
| **Conversation Config** | Messaging API | Routing rules: which sources, which audience, auto/manual creation, reopen policy, default assignment. |
| **Team** | Account API | Group of agents for routing. Has members with roles (member/lead). |
| **Contact** | Account API | End-user record (name, phone, email, properties). Created automatically on first inbound if needed. |
| **Channel** | Messaging API | An external messaging channel (WhatsApp number, Telegram bot, etc.). Already exists in the platform. |

### 7.5 Conversation Source Types

A conversation always originates from exactly one source:

| Source | Field Set | Example |
|---|---|---|
| **IM Channel** | `channel_id` is set, `chat_endpoint_id` is null | WhatsApp conversation through a configured WhatsApp Business number |
| **Chat Widget** | `chat_endpoint_id` is set, `channel_id` is null | Webchat conversation through the embedded widget |

This distinction affects:
- The channel badge shown in the inbox (WhatsApp icon vs. chat bubble icon)
- How replies are delivered (via channel adapter vs. via WebSocket push)
- How existing conversations are looked up (by channel vs. by chat endpoint)

### 7.6 Real-Time Event Types

These are the events pushed to agent and visitor browsers via WebSocket:

| Event | When | Who Receives | UI Effect |
|---|---|---|---|
| `conversation:new` | New conversation created | All agents in the account | New item appears in inbox list |
| `conversation:updated` | Status, assignee, priority, or label changed | Agents viewing the inbox + agents in the conversation | Inbox item updates, conversation header updates |
| `conversation:message` | New message in a conversation | Agents + visitor viewing that conversation | Message bubble appears in thread |
| `conversation:typing` | Someone is typing | Others viewing the same conversation | Typing indicator shown |
| `agent:presence` | Agent changes presence | All agents in the account | Presence dot updates |
| `notification:assignment` | Conversation assigned to an agent | The assigned agent | Notification/toast + inbox highlight |

**Private messages** (`is_private: true`) are only pushed to agent connections — visitors never receive them.

---

## 8. Design Considerations & UX Notes

### 8.1 Inbox Performance

- The inbox must handle hundreds of conversations efficiently
- Virtual scrolling recommended for the conversation list
- Only load full message history when a conversation is opened
- Real-time updates should not cause layout shifts or flicker

### 8.2 Channel Visual Identity

Each channel should have a distinct icon and color so agents can quickly identify the source:

| Channel | Suggested Icon | Color |
|---|---|---|
| WhatsApp | WhatsApp logo | Green |
| Telegram | Telegram logo | Blue |
| Messenger | Messenger logo | Blue/Purple |
| SMS | Message bubble | Grey |
| Email | Envelope | Dark blue |
| Webchat | Chat bubble | Brand color (from widget config) |

### 8.3 Message Bubble Design

Different visual treatments for:

| Type | Alignment | Style |
|---|---|---|
| **Customer message** (inbound) | Left | Light background, contact avatar |
| **Agent reply** (outbound) | Right | Brand-colored background, agent avatar |
| **Internal note** (private) | Right, but distinct | Yellow/amber background, "Note" badge, lock icon. Must be unmistakably different from regular replies to prevent agents from accidentally thinking notes are visible to customers. |
| **System event** | Center | Muted, small text, no bubble (e.g., "Abebe assigned this to Billing Team") |

### 8.4 Optimistic UI

When an agent sends a message:
1. The message appears immediately in the thread (optimistic render) with a "sending" indicator
2. On confirmation (WebSocket ACK): indicator changes to "sent"
3. On failure: indicator changes to "failed" with a retry button

This is critical for a responsive chat experience.

### 8.5 Notification Strategy

- **In-app:** Badge counts on inbox, toast notifications for new assignments
- **Browser:** Push notifications for new conversations or messages when the tab is not active (with permission)
- **Sound:** Optional notification sound for new messages (with mute control)

### 8.6 Multi-Tab & Reconnection

- Agent may have multiple tabs open — presence and state should sync
- WebSocket auto-reconnects with exponential backoff on disconnect
- After reconnect, fetch latest state from REST API to reconcile any missed events
- Show a subtle banner when connection is lost: "Reconnecting..." and "Connected" on recovery

### 8.7 Mobile Responsiveness

- The agent inbox should be responsive: on mobile, show conversation list OR thread (not both)
- The chat widget must work well on mobile browsers — consider full-screen or slide-up panel on small screens

---

## 9. Screen Inventory Summary

| # | Screen / Component | User | Priority |
|---|---|---|---|
| 1 | **Conversation Inbox** (split panel: list + thread) | Agent | P0 |
| 2 | **Conversation Thread / Chat View** (message bubbles, compose, typing) | Agent | P0 |
| 3 | **Conversation Actions** (assign, status change, priority, labels) | Agent | P0 |
| 4 | **Chat Widget — Launcher** (floating button) | Visitor | P1 |
| 5 | **Chat Widget — Pre-Chat Form** | Visitor | P1 |
| 6 | **Chat Widget — Chat Window** (messages, typing, input) | Visitor | P1 |
| 7 | **Chat Widget — Offline State** | Visitor | P1 |
| 8 | **Chat Endpoint Management** (list, create, edit, embed code) | Admin | P1 |
| 9 | **Conversation Config Management** (list, create, edit, priority reorder) | Admin | P1 |
| 10 | **Team Management** (list, create, edit, members) | Admin | P1 |
| 11 | **Pending Messages Queue** (unthreaded messages, manual triage) | Agent | P2 |
| 12 | **Agent Presence Controls** (status dropdown in nav/header) | Agent | P1 |
| 13 | **Notification Toasts / Assignment Alerts** | Agent | P1 |

---

## 10. Implementation Phases

| Phase | What Ships | Screens Affected |
|---|---|---|
| **Phase 1 — Foundation** | Conversation & message data layer, team management, config management | Screens 8, 9, 10 (admin setup) |
| **Phase 2 — Real-Time Infra** | WebSocket connections, live push, typing indicators, presence | Screens 12, 13 (presence & notifications) |
| **Phase 3 — Live Chat Widget** | Embeddable chat widget, visitor sessions, public endpoints | Screens 4, 5, 6, 7 (widget) |
| **Phase 4 — Frontend Integration** | Inbox UI wired to real APIs and WebSocket | Screens 1, 2, 3, 11 (inbox & thread) |
| **Phase 5 — Advanced (Future)** | Canned responses, bot routing, CSAT, SLA tracking, analytics | New screens TBD |

---

## 11. Glossary

| Term | Definition |
|---|---|
| **Conversation** | A threaded exchange between an agent and a contact, tied to a specific channel or chat endpoint |
| **Channel** | An external messaging platform connection (e.g., a WhatsApp Business number, a Telegram bot) |
| **Chat Endpoint** | A configured live chat widget that can be embedded on a website |
| **Conversation Config** | A routing rule that determines if/how conversations are created for a given source and audience |
| **Agent** | An authenticated Turumba user who handles conversations |
| **Visitor** | An anonymous or semi-identified person using the live chat widget |
| **Contact** | A record in the Account system representing an end-user (customer/visitor) |
| **Team** | A group of agents for conversation routing (e.g., Billing, Sales) |
| **Internal Note** | A private message within a conversation visible only to agents |
| **Presence** | An agent's online/away/offline status |
| **Inbound** | A message from the customer/visitor to the agent |
| **Outbound** | A message from the agent to the customer/visitor |
| **Reopen Policy** | What happens when a customer messages after a conversation was resolved (reopen existing, create new, or time-based threshold) |
| **Fire-and-Forget** | The delivery model where WebSocket push happens immediately and DB persistence runs in the background |

---

## 12. Related Documents

| Document | What It Covers |
|---|---|
| `TURUMBA_REALTIME_MESSAGING.md` | Full technical specification (data models, API endpoints, worker pipelines, code samples) |
| `TURUMBA_MESSAGING.md` | Existing messaging system (broadcast, templates, group messages, scheduled messages) |
| `TURUMBA_DELIVERY_CHANNELS.md` | Channel types, adapter framework, credentials lifecycle |
| `WHAT_IS_TURUMBA.md` | Platform overview and architecture diagram |
