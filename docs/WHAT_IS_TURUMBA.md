# What is Turumba?

Turumba is a multi-tenant **message automation platform**. It allows organizations to automate communication with their contacts across multiple instant messaging channels — SMS, Telegram, WhatsApp, Messenger, and more.

The platform's core purpose is to give users powerful messaging tools: **group messaging**, **scheduled messages**, and **contextualized template messages**.

---

## What Can You Do With Turumba?

### Messaging

> For a detailed breakdown of all messaging features, see [Turumba Messaging](./TURUMBA_MESSAGING.md).

- **Messages** — View all sent and received messages across every delivery channel in one place. Filter by channel, status, date range, or contact; sort by date or delivery status; and paginate through large message histories within your account
- **Group Messaging** — Send a single message to an entire contact group at once across any supported channel
- **Scheduled Messages** — Compose messages now and schedule them for delivery at a specific future date and time
- **Contextualized Template Messages** — Create message templates with placeholders like `Hi {FIRST_NAME}, this is your code: {VERIFICATION_CODE}` that get personalized for each recipient automatically

### Delivery Channels

> For a detailed breakdown of delivery channels, see [Turumba Delivery Channels](./TURUMBA_DELIVERY_CHANNELS.md).

Delivery Channels are the messaging connections that users add to their Turumba account. Each channel represents a configured link to an external messaging platform — a Telegram bot, a WhatsApp Business number, an SMS provider, an SMPP port, etc. Users can add multiple channels of the same type (e.g., two different SMS providers) and choose which channel to use when sending messages.

**Channel Management:**
- **Add Channel** — Connect a new delivery channel by providing the required credentials and configuration (e.g., API key, bot token, phone number, SMPP host/port)
- **Configure Channel** — Set channel-specific settings such as sender name, default country code, rate limits, or delivery priority
- **Enable / Disable Channel** — Temporarily disable a channel without removing its configuration
- **Remove Channel** — Disconnect and delete a channel from the account
- **Channel Status** — View the connection health and delivery status of each channel (connected, disconnected, rate-limited, error)

**Supported Channel Types:**
- **SMS** — Connect an SMS gateway provider (e.g., Twilio, Africa's Talking, Vonage) using API credentials
- **SMPP** — Connect directly to an SMS Center via SMPP protocol by configuring host, port, system ID, and password
- **Telegram** — Connect a Telegram Bot by providing the bot token from BotFather
- **WhatsApp** — Connect a WhatsApp Business account via the WhatsApp Business API
- **Facebook Messenger** — Connect a Facebook Page to send and receive messages through Messenger
- **Email** — Connect an email account via SMTP/IMAP credentials for outbound and inbound email
- **Additional Types** — The architecture supports adding new channel types over time (e.g., Viber, Line, Signal)

**How channels are used:**
- When composing a new message, the user selects which delivery channel to send through
- Group messages and campaigns can target a specific channel or let the system choose based on the contact's preferred channel
- Each message in the history shows which channel it was sent or received through
- Inbound messages arrive through connected channels and are associated with the originating channel

### Contacts and Segmentation

- **Contact Management** — Organize contacts into groups, tag them, and manage their profiles and metadata
- **Custom Attributes** — Store flexible, custom data per contact (e.g., enrollment date, program name, preferred language)
- **Labels and Tags** — Categorize contacts with color-coded labels for easy filtering and targeting
- **Contact Segments** — Create saved filters to define reusable audiences (e.g., "Active Mentees in Addis Ababa", "Unresponsive contacts last 30 days")
- **Contact Import/Export** — Bulk import contacts from CSV and export contact data for external use

### Automation

- **Automation Rules** — Define trigger-based rules that execute actions automatically (e.g., when a new contact is added, send a welcome message)
- **Webhook Integrations** — Receive events from external systems to trigger messaging workflows (e.g., a new registration in another system triggers a welcome message in Turumba)

### AI-Powered Messaging

- **AI Message Composer** — Use AI to generate or refine message content based on a prompt or context (e.g., "write a follow-up message for mentees who missed last week's session")
- **Smart Replies** — AI-suggested reply options when responding to inbound messages from contacts
- **Message Translation** — Automatically translate outbound messages into the recipient's preferred language before delivery
- **Sentiment Detection** — Analyze inbound messages to flag negative or urgent responses that need immediate attention

### Analytics and Reporting

- **Message Reports** — Track message volume, delivery success, and failure rates across channels
- **Channel Reports** — Compare delivery and engagement metrics across different messaging platforms
- **Exportable Reports** — Download reports as CSV for external analysis or sharing

### Accounts and Team Management

- **Multi-Tenant Accounts** — Create accounts and sub-accounts, invite team members, and define roles with granular permissions
- **Role-Based Access Control** — Define custom roles with fine-grained JSON permissions per account (e.g., who can send campaigns, who can manage contacts)
- **Team Collaboration** — Multiple team members can operate within the same account with clear permission boundaries
- **Invitation System** — Invite users to join an account by email, with a role pre-assigned
- **Audit Log** — Track who sent what, when, and to whom for accountability and compliance

### Integrations and Extensibility

- **Webhook Triggers** — Push real-time events (message sent, message delivered, message failed, new inbound message) to external systems
- **Inbound Webhooks** — Accept events from external systems to trigger messaging actions inside Turumba (e.g., a new signup in your app triggers a welcome sequence)
- **API-First Design** — Every feature available through the Turumba Gateway API, enabling custom integrations and third-party apps to build on top of Turumba
- **Embeddable Chat Widget** — A JavaScript widget that can be embedded on any website to enable live chat directly from an external site

---

## How Turumba is Built

Turumba is a single web application built on a microservices architecture. It is composed of four repositories that work together as one platform:

```
                         Turumba Web Apps
                      (Turumba, Negarit, etc.)
                               |
                               v
                 +----------------------------+
                 |     Turumba Gateway         |
                 |     (KrakenD - Port 8080)   |
                 |                            |
                 |  - Route API requests      |
                 |  - Enrich request context  |
                 |  - Handle CORS & security  |
                 +----------------------------+
                        |              |
                        v              v
              +-----------------+  +---------------------+
              | Account API     |  | Messaging API       |
              | (FastAPI)       |  | (FastAPI)           |
              |                 |  |                     |
              | - Auth & Users  |  | - Send/Receive msgs |
              | - Accounts      |  | - Schedule msgs     |
              | - Roles & RBAC  |  | - Group messages    |
              | - Contacts      |  | - Templates         |
              |                 |  | - Channels          |
              |                 |  | - Event Outbox      |
              +-----------------+  +---------------------+
                   |        |              |          |
                   v        v              v          v
             PostgreSQL  MongoDB    PostgreSQL   RabbitMQ
                                                     |
                                        +------------+------------+
                                        |                         |
                                        v                         v
                                 +-------------+         +--------------+
                                 | Outbox      |         | Schedule     |
                                 | Worker      |         | Trigger      |
                                 |             |         | Service      |
                                 | - Publishes |         |              |
                                 |   events to |         | - Fires at   |
                                 |   RabbitMQ  |         |   scheduled  |
                                 +-------------+         |   times      |
                                                         +--------------+
```

---

## The Four Parts of Turumba

### turumba_gateway

The gateway is the single entry point for the entire platform. Built on **KrakenD**, it is responsible for exposing all API endpoints and passing context to each backend service.

**How context enrichment works:**

When a user hits an API endpoint — for example `/v1/accounts` — the gateway does not simply forward the request. Instead, KrakenD first sends an internal request to the Context API at `/v1/context`. From the context response, the gateway extracts essential authorization information such as:

- **Allowed Account IDs** — which accounts the user belongs to
- **Allowed Role IDs** — what roles the user holds within those accounts

This context is then injected as HTTP headers (`x-account-ids`, `x-role-ids`) into the original request before it reaches the target service. The backend services use this context to scope their queries, enforce multi-tenant isolation, and execute service-specific actions accordingly.

This design ensures that every backend service receives consistent, pre-validated authorization context without needing to independently resolve user permissions.

---

### turumba_account_api

The Account API manages the identity, access, and contact management side of Turumba. It is the backbone that every other part of the platform relies on.

**What it handles:**
- **Accounts and Sub-Accounts** — Organizations create their primary account and can create sub-accounts for departments, teams, or clients
- **Users** — Registration, authentication, and profile management via AWS Cognito with JWT-based security
- **Contacts** — A contact database with flexible metadata, tags, and custom fields — these are the people users send messages to
- **Roles and Permissions** — Account-specific roles with granular permissions, so each organization controls who can do what
- **Multi-Account Membership** — A single user can belong to multiple accounts with different roles in each
- **Context** — The `/context/basic` endpoint that powers the gateway's request enrichment

---

### turumba_messaging_api

The Messaging API is the core of what makes Turumba a message automation platform. It handles all messaging operations across multiple third-party channels.

**Supported Channels (planned):**
- SMS
- Telegram
- WhatsApp
- Facebook Messenger
- Email
- And other instant messaging platforms

**What it handles:**
- **Send Messages** — Deliver outbound messages to contacts through their preferred channel
- **Receive Messages** — Ingest inbound messages from connected platforms via webhooks
- **Group Messages** — Send bulk messages to an entire contact group or segment
- **Scheduled Messages** — Queue messages for delivery at a specified future time, with support for one-time and recurring schedules
- **Template Messages** — Create reusable templates with variable placeholders (e.g., `Hi {FIRST_NAME}, this is your code: {CODE}`) that get rendered with each contact's data before sending
- **Delivery Channels** — Users add and manage their own delivery channel connections (SMS providers, SMPP ports, Telegram bots, WhatsApp Business, etc.)
- **Message History** — A complete log of all sent, received, scheduled, and group messages

**Event-Driven Processing:**

Group messaging and scheduled message delivery are powered by an event-driven architecture using the **Transactional Outbox** pattern with **RabbitMQ**:

- When a group message or scheduled message is created or updated, the API emits domain events via a request-scoped **EventBus**
- Events are flushed to an **outbox table** in the same database transaction as the entity changes — guaranteeing atomicity (no events lost, no phantom events)
- An **Outbox Worker** process reads pending events from the outbox and publishes them to RabbitMQ
- **Consumer services** subscribe to RabbitMQ queues and handle background processing — iterating through contacts for group sends, triggering scheduled messages at the right time, updating progress counters, and managing retries

---

### turumba_web_core

The frontend of Turumba. It is a **monorepo** built on **Turborepo** that houses multiple web applications, all consuming the Turumba Gateway API.

**Turumba**

The main web application — a full-featured dashboard for automating messages through different instant messaging platforms. Users can:

- Manage their accounts, team members, and contacts
- Send, schedule, and group messages for contacts across multiple channels
- Create and manage template messages with variable placeholders
- Add and configure delivery channels
- Monitor messaging activity and delivery status

**Negarit**

A focused web application dedicated exclusively to messaging operations. Unlike the full Turumba dashboard, Negarit is streamlined for:

- Sending and receiving messages through different instant messaging platforms
- Scheduling messages for future delivery
- Managing message history and delivery status

**Additional Applications**

The monorepo architecture supports creating additional web applications as needed — each consuming the same Turumba Gateway API through shared packages (UI components, configurations, utilities).

---

## How It All Works Together

1. **A user signs up** through the Turumba or Negarit web app, which calls the Gateway's `/v1/auth/register` endpoint
2. **The Gateway** routes the request to the Account API, which creates the user in AWS Cognito and the database
3. **On login**, the user receives a JWT token included in all subsequent requests
4. **For every authenticated request**, the Gateway calls `/v1/context` to resolve the user's accounts and roles, then injects this context as headers
5. **The user creates contacts** and organizes them into groups through the Account API
6. **When sending a single message**, the web app calls the Gateway, which routes to the Messaging API. The API renders template variables and delivers through the selected channel
7. **When creating a group message or scheduled message**, the Messaging API writes the entity and emits domain events via the EventBus. Events are flushed to the outbox table in the same transaction, then published to RabbitMQ by the Outbox Worker
8. **Background processors** pick up events from RabbitMQ — iterating through contacts for group sends, firing scheduled messages at the right time, and updating progress counters in real-time
9. **All message activity** is recorded, allowing users to track delivery status, view message history, and monitor group message progress

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **API Gateway** | KrakenD 2.12.1, Go plugins, Lua scripting |
| **Backend Services** | Python (FastAPI), SQLAlchemy, Motor (async MongoDB) |
| **Authentication** | AWS Cognito, JWT RS256 |
| **Databases** | PostgreSQL, MongoDB |
| **Message Broker** | RabbitMQ (Transactional Outbox pattern for reliable event delivery) |
| **Frontend** | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| **Build System** | Turborepo, pnpm |
| **Infrastructure** | Docker, Docker Compose, GitHub Actions CI/CD |

---

## Multi-Tenancy Model

Turumba is designed as a multi-tenant platform from the ground up:

- **Accounts** represent organizations or teams
- **Users** can belong to multiple accounts with different roles in each
- **Every API request** is scoped to the user's active account through the gateway's context enrichment
- **Data isolation** is enforced at the service layer — users can never access data from accounts they don't belong to
- **Roles and permissions** are account-specific, allowing each organization to define its own access control structure
