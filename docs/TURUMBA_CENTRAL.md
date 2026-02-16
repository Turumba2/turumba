# Turumba 2.0 — Platform Reference

> **The single source of truth for architecture, features, and project status.**
> Last updated: 2026-02-16

---

## Table of Contents

1. [What is Turumba](#1-what-is-turumba)
2. [System Architecture](#2-system-architecture)
3. [Service Inventory](#3-service-inventory)
4. [Feature Catalog](#4-feature-catalog)
5. [Data Architecture](#5-data-architecture)
6. [Authentication & Multi-Tenancy](#6-authentication--multi-tenancy)
7. [API Surface](#7-api-surface)
8. [Event Infrastructure](#8-event-infrastructure)
9. [Frontend Application](#9-frontend-application)
10. [Implementation Status](#10-implementation-status)
11. [GitHub Issues Dashboard](#11-github-issues-dashboard)
12. [Team & Workflows](#12-team--workflows)
13. [Technology Stack](#13-technology-stack)
14. [What's Next](#14-whats-next)

---

## 1. What is Turumba

Turumba 2.0 is a **multi-tenant message automation platform** that enables organizations to communicate with their audiences across multiple channels from a single dashboard. It combines **CRM**, **messaging automation**, and **delivery channel management** into one product.

### Core Capabilities

| Capability | Description |
|---|---|
| **Multi-Channel Messaging** | Send messages via SMS, SMPP, Telegram, WhatsApp, Facebook Messenger, and Email — all from one interface |
| **Template Messages** | Create reusable templates with `{VARIABLE}` placeholders that auto-populate from contact data |
| **Group Messaging** | Send bulk messages to contact groups with per-recipient template rendering and progress tracking |
| **Scheduled Messages** | One-time or recurring message dispatch with timezone support and pause/resume controls |
| **Delivery Channels** | Configure and manage connections to external messaging providers (API keys, SMPP binds, bot tokens) |
| **Contact Management** | Store contacts with flexible metadata, custom attributes, and grouping |
| **Multi-Tenant Accounts** | Organizations create accounts; users belong to multiple accounts with role-based permissions |
| **Event-Driven Processing** | Transactional outbox pattern ensures reliable message dispatching via RabbitMQ |

### How It Works (User Journey)

```
1. Sign up → Create an account (organization)
2. Invite team members → Assign roles (admin, agent, viewer)
3. Add delivery channels → Configure SMS provider, connect Telegram bot, etc.
4. Import contacts → Organize into groups
5. Create templates → Define message patterns with variables
6. Compose messages → Send immediately, schedule, or broadcast to groups
7. Monitor delivery → Track sent/delivered/failed status per message
8. Manage at scale → Recurring schedules, bulk operations, analytics
```

---

## 2. System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│   turumba (port 3600)  │  negarit (port 3500)  │  web (3000)    │
│         Next.js 16 + AWS Amplify + Cognito Auth                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTPS
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    KrakenD API Gateway (port 8080)                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Context-Enricher Go Plugin                              │    │
│  │  • Intercepts authenticated requests                     │    │
│  │  • Calls /context/basic on Account API                   │    │
│  │  • Injects x-account-ids, x-role-ids headers             │    │
│  │  • Strips user-provided values (anti-spoofing)           │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  51 endpoints  │  CORS  │  Lua scripts  │  Template config       │
└───────────────────┬──────────────────────┬───────────────────────┘
                    │                      │
        ┌───────────┘                      └──────────┐
        ▼                                             ▼
┌──────────────────────────┐          ┌──────────────────────────┐
│  Account API (port 8000) │          │ Messaging API (port 8000)│
│  FastAPI · Python 3.11   │          │ FastAPI · Python 3.12    │
│                          │          │                          │
│  Users, Accounts, Roles  │          │  Channels, Messages,     │
│  Contacts, Persons       │          │  Templates, Groups,      │
│  Auth (Cognito)          │          │  Scheduled, Outbox       │
│  Context enrichment      │          │  Event infrastructure    │
└──────────┬───────────────┘          └──────────┬───────────────┘
           │                                     │
     ┌─────┴─────┐                         ┌─────┴─────┐
     ▼           ▼                         ▼           ▼
┌─────────┐ ┌─────────┐             ┌─────────┐ ┌──────────┐
│PostgreSQL│ │ MongoDB │             │PostgreSQL│ │ RabbitMQ │
│(users,   │ │(contacts│             │(channels,│ │(event    │
│ accounts,│ │ persons)│             │ messages,│ │ publish) │
│ roles)   │ │         │             │ outbox)  │ │          │
└──────────┘ └─────────┘             └──────────┘ └──────────┘
```

### Network Architecture

All services run on a shared Docker network (`gateway-network`). The gateway routes to services by Docker container name:

| Container Name | Internal Port | Service |
|---|---|---|
| `krakend-gateway` | 8080 | KrakenD API Gateway |
| `gt_turumba_account_api` | 5002 (mapped to 8000) | Account API |
| `gt_turumba_messaging_api` | 5001 (mapped to 8000) | Messaging API |

All containers require `platform: linux/amd64` (critical for Apple Silicon hosts).

### Design Principles

- **Microservices** — Each domain has its own service, database, and deployment lifecycle
- **API Gateway Pattern** — Single entry point; clients never call backends directly
- **Clean Architecture** — 4-layer separation: Routers → Controllers → Services → Models
- **Event-Driven** — Transactional outbox for reliable async processing
- **Multi-Tenant by Default** — Every query scoped to account via gateway-injected headers
- **Database-Agnostic Operations** — Strategy pattern for filters/sorts across PostgreSQL and MongoDB

---

## 3. Service Inventory

### 3.1 Account API

**Purpose:** Identity, access, and contact management.

| Component | Count | Details |
|---|---|---|
| Routers | 7 | auth, user, account, role, contact, person, context |
| Controllers | 10 | Including generic CRUDController base |
| Service Classes | 18 | 3 per entity (Creation, Retrieval, Update) |
| PostgreSQL Models | 5 | user, account, role, account_user, account_role |
| MongoDB Models | 2 | contact, person |
| Alembic Migrations | 1 | Initial schema |
| Test Coverage | 50% | Minimum enforced via pre-commit |

**Key Functions:**
- **User registration & login** via AWS Cognito (JWT RS256)
- **Multi-tenant account management** — users belong to multiple accounts with different roles
- **Role-based access control** — JSON permissions per role, `require_role()` decorator
- **Contact management** — Flexible metadata, stored in MongoDB
- **Context enrichment** — `/context/basic` endpoint used by gateway plugin to resolve account/role context
- **Custom filter resolvers** — Cross-table filtering and sorting (e.g., filter users by account name) via PR #60

**Active Development:**
- AccountUser entity rework in progress (uncommitted on main) — dual-perspective controllers for managing users within accounts

### 3.2 Messaging API

**Purpose:** Message composition, delivery channel management, and message dispatch orchestration.

| Component | Count | Details |
|---|---|---|
| Routers | 5 | channel, message, template, group_message, scheduled_message |
| Controllers | 6 | Including generic CRUDController base |
| Service Classes | 15+ | 3 per entity (Creation, Retrieval, Update) |
| PostgreSQL Models | 6 | channel, message, template, group_message, scheduled_message, outbox_event |
| Alembic Migrations | 7 | Incremental schema evolution |
| Test Coverage | 80% | Minimum enforced in CI |

**Key Functions:**
- **Delivery Channels** — Configure connections to SMS, SMPP, Telegram, WhatsApp, Messenger, Email providers
- **Messages** — Individual message CRUD with status tracking (queued → sending → sent → delivered/failed)
- **Templates** — Reusable message patterns with `{VARIABLE}` placeholders and fallback strategies
- **Group Messages** — Bulk messaging to contact groups with per-recipient rendering and progress counters
- **Scheduled Messages** — One-time or recurring dispatch with timezone awareness and recurrence rules
- **Event Infrastructure** — EventBus, OutboxMiddleware, OutboxEvent model, OutboxWorker (built, not yet wired)

### 3.3 Gateway

**Purpose:** Single entry point, authentication context enrichment, request routing.

| Component | Count | Details |
|---|---|---|
| Endpoints | 51 | 25 Account API + 25 Messaging API + 1 context |
| Go Plugins | 1 | Context-enricher (header injection) |
| Lua Scripts | 6 | Request/response modification utilities |
| Docker Services | 3 | Gateway + Account API + Messaging API |

**Key Functions:**
- **Request routing** — Template-based KrakenD configuration with file composition
- **Context enrichment** — Go plugin intercepts requests, resolves user context, injects trusted headers
- **Security** — Strips user-provided `x-account-ids`/`x-role-ids` before injection (anti-spoofing)
- **Pattern matching** — Supports exact, single-wildcard (`*`), and double-wildcard (`**`) path patterns

### 3.4 Web Core

**Purpose:** User-facing web applications.

| Component | Count | Details |
|---|---|---|
| Apps | 4 | turumba (3600), negarit (3500), web (3000), docs (3001) |
| Auth Components | 8 | SignIn, SignUp, EmailVerify, 2FA, ForgotPassword, ResetPassword, AmplifyConfig |
| Shared UI Components | 24 | Radix-based primitives in @repo/ui |
| Generic Table Builder | 1 | Reusable table with pagination, API integration |

**Key Functions:**
- **Authentication** — AWS Amplify + Cognito (email/password, email verification, server-side auth guard)
- **Shared UI library** — 24 Radix components with Tailwind v4 styling and CVA variants
- **Generic Table Builder** — Reusable data table with pagination and column configuration
- **Form handling** — React Hook Form + Zod validation throughout

---

## 4. Feature Catalog

### Messaging Features

#### 4.1 Messages

Individual messages sent through delivery channels.

- **Direction:** Outbound (org → contact), Inbound (contact → org), System (automated)
- **Status lifecycle:** `Scheduled → Queued → Sending → Sent → Delivered` (or `Failed → Retry → Permanently Failed`)
- **Data:** channel_id, contact_id, delivery_address, message_body, direction, status, metadata, error_details
- **Filtering:** By status, channel, contact, direction, date range, delivery address
- **API:** Full CRUD at `/v1/messages/`

#### 4.2 Template Messages

Reusable message patterns with dynamic variable substitution.

- **Syntax:** `Hello {FIRST_NAME}, your order {ORDER_ID} is ready.`
- **Variable sources (priority order):** Contact fields → Custom attributes → Account fields → Sender fields → System fields → Custom values at send time
- **Fallback strategies:** `keep_placeholder` (default), `use_default`, `skip_contact`
- **Tracking:** category, channel_type, language, approval_status (for WhatsApp), external_template_id
- **API:** Full CRUD at `/v1/templates/`

#### 4.3 Group Messages

Bulk messaging to contact groups with per-recipient template rendering.

- **Status lifecycle:** `Draft → Queued → Processing → Completed` (or `Partially Failed / Failed / Cancelled`)
- **Progress tracking:** total_recipients, sent_count, delivered_count, failed_count, pending_count
- **Auto-template:** Pass `message_body` instead of `template_id` to auto-create a template
- **Features:** Contact group selection, skip duplicates, exclude contacts, rate limiting, custom variable overrides
- **API:** Full CRUD at `/v1/group-messages/`

#### 4.4 Scheduled Messages

Time-delayed message dispatch with recurring support.

- **Send types:** Single (to one address or contact) or Group (to contact groups)
- **Recurrence:** `daily`, `weekly:mon,wed,fri`, `monthly:15`, with optional end date
- **Timezone:** All schedules are timezone-aware
- **Controls:** Pause, resume, cancel, edit before delivery
- **Status lifecycle:**
  - Single: `Pending → Triggered → Completed/Failed`
  - Recurring: `Pending → Triggered → Pending (next trigger)`, with `Pause/Resume/Cancel`
- **API:** Full CRUD at `/v1/scheduled-messages/`

#### 4.5 Delivery Channels

Configured connections to external messaging platforms.

- **Supported types:**

| Type | Protocol | Key Capabilities |
|---|---|---|
| **SMS** | REST API | Twilio, Africa's Talking, Vonage, MessageBird; outbound/inbound, delivery receipts |
| **SMPP** | SMPP 3.4 | Direct SMSC connection; long messages, delivery receipts, keep-alive |
| **Telegram** | Bot API | BotFather bots; outbound/inbound, rich messages, webhook-based |
| **WhatsApp** | Business API | Outbound/inbound, template messages, 24-hour session window, media |
| **Messenger** | Page API | Facebook Page connection; outbound/inbound, 24-hour window, rich messages |
| **Email** | SMTP/IMAP | SMTP outbound, IMAP inbound; subject/body/attachments, threading |

- **Credential security:** Write-only, never returned in full; masked in responses (`sk-****1234`)
- **Channel status:** Connected (green), Disconnected (gray), Rate-Limited (yellow), Error (red), Disabled (muted)
- **Configuration:** sender_name, default_country_code, rate_limit, priority, retry_count, retry_interval
- **Lifecycle:** Add → Configure → Verify → Active (Enable/Disable) → Remove
- **API:** Full CRUD at `/v1/channels/`

### Account & Identity Features

#### 4.6 Authentication

- **Registration:** Email + password via AWS Cognito
- **Email verification:** 6-digit OTP code
- **Login:** JWT RS256 token issued by Cognito
- **Token validation:** FastAPI middleware (`get_current_user`, `get_current_user_id`, `get_current_user_email`)
- **Role-based access:** `require_role("admin")` decorator
- **Frontend:** AWS Amplify handles token refresh, server-side auth guard

#### 4.7 Multi-Tenant Accounts

- **Accounts = Organizations** — Each account is an isolated tenant
- **Users belong to multiple accounts** with different roles in each
- **API requests scoped to active account** — Gateway injects `x-account-ids` header
- **Data isolation enforced at service layer** via "trusted default filters"

#### 4.8 Roles & Permissions

- **JSON permissions model** — Flexible permission structure per role
- **Account-scoped roles** — Different role definitions per account
- **Field-level permissions** — Response fields can be conditionally included based on role

#### 4.9 Contacts & Persons

- **Contacts (MongoDB)** — Flexible metadata, custom attributes, duplicate prevention
- **Persons (MongoDB)** — Person records with flexible schema
- **API:** Full CRUD with filtering/sorting at `/v1/contacts/` and `/v1/persons/`

### Infrastructure Features

#### 4.10 Generic CRUD Controller

A reusable base class that provides standardized CRUD operations across all entities:

- **Filter syntax:** `?filter=email:contains:@example.com&sort=created_at:desc`
- **16 filter operations:** eq, ne, lt, le, gt, ge, contains, icontains, in, like, range, is_null, startswith, endswith
- **Default filters:** "Trusted system filters" that enforce tenant isolation and bypass user validation
- **Schema transformation:** Configurable response schemas for list vs. detail views
- **Database-agnostic:** Strategy pattern supports both PostgreSQL and MongoDB

#### 4.11 API Gateway

- **51 configured endpoints** across both backend APIs
- **Context enrichment plugin** — Resolves user identity and injects account/role headers
- **Template-based configuration** — KrakenD config composed from modular partials
- **Lua scripts** — Request/response modification (error passthrough, header modification, HTTP client)

---

## 5. Data Architecture

### PostgreSQL — Account API

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    users     │     │   accounts   │     │    roles     │
│──────────────│     │──────────────│     │──────────────│
│ id (UUID)    │     │ id (UUID)    │     │ id (UUID)    │
│ email        │     │ name         │     │ name         │
│ phone        │     │ metadata_    │     │ permissions  │
│ cognito_id   │     │ created_at   │     │  (JSONB)     │
│ created_at   │     │ updated_at   │     │ account_id   │
│ updated_at   │     └──────┬───────┘     │ created_at   │
└──────┬───────┘            │             └──────┬───────┘
       │              ┌─────┴──────┐             │
       └──────────────┤account_users├─────────────┘
                      │────────────│
                      │ user_id    │
                      │ account_id │
                      │ role_id    │
                      └────────────┘
```

### MongoDB — Account API

| Collection | Purpose | Key Fields |
|---|---|---|
| `contacts` | Contact management | account_id, name, email, phone, metadata, tags |
| `persons` | Person records | account_id, name, attributes |

### PostgreSQL — Messaging API

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    channels      │     │    messages       │     │    templates     │
│──────────────────│     │──────────────────│     │──────────────────│
│ id (UUID)        │     │ id (UUID)        │     │ id (UUID)        │
│ account_id       │     │ account_id       │     │ account_id       │
│ name             │     │ channel_id (FK)  │     │ name             │
│ channel_type     │     │ contact_id       │     │ category         │
│ status           │     │ direction        │     │ channel_type     │
│ is_enabled       │     │ status           │     │ language         │
│ credentials      │     │ delivery_address │     │ message_body     │
│  (JSONB, write)  │     │ message_body     │     │ variables (JSONB)│
│ sender_name      │     │ metadata_        │     │ default_values   │
│ rate_limit       │     │ error_details    │     │ fallback_strategy│
│ priority         │     │ sent_at          │     │ approval_status  │
│ retry_count      │     │ delivered_at     │     │ created_by_user  │
│ retry_interval   │     │ failed_at        │     │ created_at       │
│ last_verified_at │     │ created_at       │     │ updated_at       │
│ error_message    │     │ updated_at       │     └──────────────────┘
│ created_at       │     └──────────────────┘
│ updated_at       │
└──────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  group_messages  │     │scheduled_messages│     │  outbox_events   │
│──────────────────│     │──────────────────│     │──────────────────│
│ id (UUID)        │     │ id (UUID)        │     │ id (UUID)        │
│ account_id       │     │ account_id       │     │ event_type       │
│ name             │     │ send_type        │     │ aggregate_type   │
│ channel_id       │     │ channel_id       │     │ aggregate_id     │
│ template_id      │     │ template_id      │     │ payload (JSONB)  │
│ status           │     │ delivery_address │     │ status           │
│ contact_group_ids│     │ contact_id       │     │ retry_count      │
│ total_recipients │     │ contact_group_ids│     │ max_retries (10) │
│ sent_count       │     │ scheduled_at     │     │ published_at     │
│ delivered_count  │     │ timezone         │     │ error_message    │
│ failed_count     │     │ is_recurring     │     │ created_at       │
│ pending_count    │     │ recurrence_rule  │     │ updated_at       │
│ custom_values    │     │ next_trigger_at  │     └──────────────────┘
│ started_at       │     │ trigger_count    │
│ completed_at     │     │ status           │
│ created_at       │     │ created_at       │
│ updated_at       │     │ updated_at       │
└──────────────────┘     └──────────────────┘
```

### RabbitMQ Topology

```
                    ┌─────────────────────────┐
                    │  messaging (topic exchange)│
                    └─────┬───────┬──────┬────┘
                          │       │      │
     ┌────────────────────┘       │      └────────────────────┐
     ▼                            ▼                           ▼
┌──────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
│group_message_    │  │scheduled_message_    │  │messaging_audit    │
│processing        │  │processing            │  │(optional)         │
│Pattern:          │  │Pattern:              │  │Pattern: #         │
│group_message.*   │  │scheduled_message.*   │  │(all events)       │
└──────────────────┘  └──────────────────────┘  └───────────────────┘

Dead Letter: messaging.dlx → messaging.dlq
```

---

## 6. Authentication & Multi-Tenancy

### Authentication Flow

```
Client                    Gateway                  Account API           Cognito
  │                         │                         │                    │
  │── POST /v1/auth/login ─▶│── proxy ───────────────▶│── authenticate ──▶│
  │                         │                         │◀── JWT token ─────│
  │◀── JWT token ───────────│◀── JWT token ───────────│                    │
  │                         │                         │                    │
  │── GET /v1/messages ────▶│                         │                    │
  │   (Authorization: JWT)  │── GET /context/basic ──▶│                    │
  │                         │◀── account_ids, roles ──│                    │
  │                         │                         │                    │
  │                         │── inject headers ───────│                    │
  │                         │   x-account-ids: [...]  │                    │
  │                         │   x-role-ids: [...]     │                    │
  │                         │                         │                    │
  │                         │── proxy to Messaging ──▶│                    │
  │◀── scoped response ────│◀── filtered by account ─│                    │
```

### Multi-Tenancy Enforcement (3 Layers)

| Layer | Mechanism | Details |
|---|---|---|
| **Gateway** | Context-enricher plugin | Resolves user → account mapping, injects `x-account-ids` header, strips user-provided values |
| **Controller** | Default filters | `account_id:eq:{header_value}` applied as "trusted system filter" that bypasses user validation and cannot be overridden |
| **Service** | Header context | `set_header_context(headers)` extracts account/role IDs from gateway-injected headers |

### JWT Token Claims

```json
{
  "sub": "cognito-user-uuid",
  "email": "user@example.com",
  "cognito:groups": ["admin", "agent"],
  "iss": "https://cognito-idp.{region}.amazonaws.com/{pool_id}",
  "exp": 1234567890
}
```

---

## 7. API Surface

All endpoints are prefixed with `/v1/` and accessed through the gateway at `http://localhost:8080`.

### Account API Endpoints (25)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/v1/auth/login` | Authenticate user, returns JWT |
| POST | `/v1/auth/register` | Register new user + create account |
| POST | `/v1/auth/verify-email` | Verify email with OTP code |
| GET | `/v1/auth/user-by-cognito-id/{id}` | Lookup user by Cognito ID |
| GET | `/v1/users/` | List users (filtered by account) |
| GET | `/v1/users/{id}` | Get user details |
| POST | `/v1/users/` | Create user |
| PATCH | `/v1/users/{id}` | Update user |
| DELETE | `/v1/users/{id}` | Delete user |
| GET | `/v1/accounts/` | List accounts |
| GET | `/v1/accounts/{id}` | Get account details |
| POST | `/v1/accounts/` | Create account |
| PATCH | `/v1/accounts/{id}` | Update account |
| DELETE | `/v1/accounts/{id}` | Delete account |
| GET | `/v1/roles/` | List roles |
| GET | `/v1/roles/{id}` | Get role details |
| POST | `/v1/roles/` | Create role |
| PATCH | `/v1/roles/{id}` | Update role |
| DELETE | `/v1/roles/{id}` | Delete role |
| GET | `/v1/contacts/` | List contacts |
| POST | `/v1/contacts/` | Create contact |
| GET | `/v1/persons/` | List persons |
| POST | `/v1/persons/` | Create person |
| PATCH | `/v1/persons/{id}` | Update person |
| GET | `/v1/context/basic` | Get user context (used by gateway plugin) |

### Messaging API Endpoints (25)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/v1/channels/` | List delivery channels |
| GET | `/v1/channels/{id}` | Get channel details |
| POST | `/v1/channels/` | Create channel |
| PATCH | `/v1/channels/{id}` | Update channel |
| DELETE | `/v1/channels/{id}` | Delete channel |
| GET | `/v1/messages/` | List messages |
| GET | `/v1/messages/{id}` | Get message details |
| POST | `/v1/messages/` | Create message |
| PATCH | `/v1/messages/{id}` | Update message |
| DELETE | `/v1/messages/{id}` | Delete message |
| GET | `/v1/templates/` | List templates |
| GET | `/v1/templates/{id}` | Get template details |
| POST | `/v1/templates/` | Create template |
| PATCH | `/v1/templates/{id}` | Update template |
| DELETE | `/v1/templates/{id}` | Delete template |
| GET | `/v1/group-messages/` | List group messages |
| GET | `/v1/group-messages/{id}` | Get group message details |
| POST | `/v1/group-messages/` | Create group message |
| PATCH | `/v1/group-messages/{id}` | Update group message |
| DELETE | `/v1/group-messages/{id}` | Delete group message |
| GET | `/v1/scheduled-messages/` | List scheduled messages |
| GET | `/v1/scheduled-messages/{id}` | Get scheduled message details |
| POST | `/v1/scheduled-messages/` | Create scheduled message |
| PATCH | `/v1/scheduled-messages/{id}` | Update scheduled message |
| DELETE | `/v1/scheduled-messages/{id}` | Delete scheduled message |

### Query Parameters (All List Endpoints)

```
GET /v1/messages/?filter=status:eq:delivered&filter=channel_id:eq:uuid&sort=created_at:desc&page=1&page_size=20
```

**Filter operations:** `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `contains`, `icontains`, `in`, `like`, `range`, `is_null`, `startswith`, `endswith`

---

## 8. Event Infrastructure

### Architecture (3-Layer Pipeline)

```
Service Layer         Database Layer            Message Broker
┌───────────┐       ┌──────────────┐          ┌──────────────┐
│ EventBus  │       │OutboxMiddle- │          │  RabbitMQ    │
│ (in-memory│──────▶│ware writes   │          │              │
│  buffer)  │       │ to outbox_   │          │  Exchanges:  │
└───────────┘       │ events table │          │  messaging   │
                    └──────┬───────┘          │              │
                           │ same             │  Queues:     │
                           │ transaction      │  group_msg   │
                           ▼                  │  sched_msg   │
                    ┌──────────────┐          │  audit       │
                    │  PostgreSQL  │          │  dlq         │
                    │  COMMIT      │          └──────▲───────┘
                    └──────┬───────┘                 │
                           │ pg_notify               │
                           ▼                         │
                    ┌──────────────┐                 │
                    │ Outbox Worker│─── publish ─────┘
                    │ (standalone) │
                    │ polls every  │
                    │ 5 seconds    │
                    └──────────────┘
```

### Why Transactional Outbox?

The outbox pattern solves the **dual-write problem**: when creating a group message, the entity and its corresponding event must both persist atomically. Writing to the database and publishing to RabbitMQ in the same operation risks inconsistency if either fails. The outbox pattern writes both to the database in the same transaction, then a separate worker reliably publishes to RabbitMQ.

### Event Types

| Event Type | Aggregate | Trigger |
|---|---|---|
| `group_message.created` | GroupMessage | New group message created |
| `group_message.queued` | GroupMessage | Group message queued for processing |
| `group_message.cancelled` | GroupMessage | Group message cancelled |
| `scheduled_message.created` | ScheduledMessage | New scheduled message created |
| `scheduled_message.updated` | ScheduledMessage | Schedule modified |
| `scheduled_message.cancelled` | ScheduledMessage | Schedule cancelled |
| `scheduled_message.paused` | ScheduledMessage | Recurring schedule paused |
| `scheduled_message.resumed` | ScheduledMessage | Recurring schedule resumed |

### Current Status

The infrastructure is **fully built and tested**: EventBus, OutboxMiddleware, OutboxEvent model, and OutboxWorker are all implemented. However, **services do not yet emit events** — the EventBus is not called from any controller or service. This is the remaining work for BE-006.

---

## 9. Frontend Application

### App Structure

```
turumba_web_core/
├── apps/
│   ├── turumba/        (port 3600) — Main application
│   ├── negarit/        (port 3500) — Secondary app
│   ├── web/            (port 3000) — Generic web app
│   └── docs/           (port 3001) — Documentation
├── packages/
│   ├── ui/             — @repo/ui shared component library
│   ├── eslint-config/  — Shared ESLint rules
│   └── typescript-config/ — Shared tsconfig
```

### Implemented Features

| Feature | Status | Details |
|---|---|---|
| Sign In page | Done | Email/password via Amplify + Cognito |
| Sign Up page | Done | Registration + account creation |
| Email Verification | Done | 6-digit OTP entry |
| Forgot Password | UI only | Form built, not wired to backend |
| Reset Password | UI only | Form built, not wired to backend |
| 2FA/TOTP | UI only | Form built, not wired to backend |
| Google SSO | UI only | Button present, backend pending |
| Server-side auth guard | Done | Middleware protects routes |
| Dashboard | Skeleton | Protected route, placeholder content |
| Organization Management | Done | Org page, empty state, inactive org handling |
| User Management | Done | User management feature |
| Contacts (initial) | Partial | Empty state + filters, page header |
| Generic Table Builder | Done | Reusable table with pagination, API integration |
| Shared UI Library | Done | 24 Radix components, Field composition system |

**Known Bugs:**
- [web#21](https://github.com/Turumba2/turumba_web_core/issues/21) — Inactive User Redirection (2026-02-16)
- [web#22](https://github.com/Turumba2/turumba_web_core/issues/22) — Switching between organization issue (2026-02-16)

### Shared UI Components (@repo/ui)

**Form:** Input, Label, Checkbox, RadioGroup, Select, Field
**Layout:** Card, Separator, Sidebar, Sheet
**Interaction:** Button, DropdownMenu, Dialog, Tooltip
**Data:** Table, Item
**Feedback:** Alert, Empty, Spinner, Skeleton
**Other:** Avatar, InputOTP, Sonner (toast)

### Not Yet Started (10 Frontend Pages)

| Task | Page | Backend API |
|---|---|---|
| FE-001 | Create New Message Compose UI | `/v1/messages/` |
| FE-002 | Delivery Channels Table View | `/v1/channels/` |
| FE-003 | Create New Delivery Channel Page | `/v1/channels/` |
| FE-004 | Messages Table View | `/v1/messages/` |
| FE-005 | Template Messages Table View | `/v1/templates/` |
| FE-006 | Create/Edit Template Message Page | `/v1/templates/` |
| FE-007 | Group Messages Table View | `/v1/group-messages/` |
| FE-008 | Create Group Message Page | `/v1/group-messages/` |
| FE-009 | Scheduled Messages Table View | `/v1/scheduled-messages/` |
| FE-010 | Create/Edit Scheduled Message Page | `/v1/scheduled-messages/` |

**Recommended build order:** FE-002 → FE-003 → FE-005 → FE-006 → FE-004 → FE-001 → FE-007 → FE-008 → FE-009 → FE-010

---

## 10. Implementation Status

### Completion by Service

```
Account API     ████████████████████░░░░  ~80%  Core complete, needs invitations, audit, advanced auth
Messaging API   ██████████████████░░░░░░  ~75%  All CRUD done, events need wiring, no channel integrations
Gateway         ████████████████████████  ~95%  51 endpoints configured, plugin active, CORS fixed
Web Core        ██████░░░░░░░░░░░░░░░░░░  ~25%  Auth + table builder only, 0/10 messaging pages started
```

### Task Spec Completion Matrix

| Task | Description | Status |
|---|---|---|
| **BE-001** | Messages CRUD API | **DONE** |
| **BE-002** | Delivery Channels CRUD API | **DONE** |
| **BE-003** | Template Messages CRUD API | **DONE** |
| **BE-004** | Group Messages CRUD API | **DONE** |
| **BE-005** | Scheduled Messages CRUD API | **DONE** |
| **BE-006** | Event Infrastructure (EventBus + Outbox + RabbitMQ) | **PARTIAL** — infrastructure built, not wired into services |
| **FE-001** | Create New Message Compose UI | NOT STARTED |
| **FE-002** | Delivery Channels Table View | NOT STARTED |
| **FE-003** | Create New Delivery Channel Page | NOT STARTED |
| **FE-004** | Messages Table View | NOT STARTED |
| **FE-005** | Template Messages Table View | NOT STARTED |
| **FE-006** | Create/Edit Template Message Page | NOT STARTED |
| **FE-007** | Group Messages Table View | NOT STARTED |
| **FE-008** | Create Group Message Page | NOT STARTED |
| **FE-009** | Scheduled Messages Table View | NOT STARTED |
| **FE-010** | Create/Edit Scheduled Message Page | NOT STARTED |

### What's Done

- All backend CRUD APIs (Account + Messaging) — 12 entities, 50 API endpoints
- Gateway fully configured with 51 routes and context-enricher plugin
- Frontend authentication flow (sign in, sign up, email verification)
- Shared UI component library (24 components) + Generic Table Builder
- Event infrastructure components (EventBus, OutboxMiddleware, OutboxWorker)
- CI/CD pipelines (lint, Docker build) across all services
- 7 Alembic migrations (messaging) + 1 (account)

### What's In Progress

- **AccountUser rework** — New controllers, schemas, services, routers for managing users within accounts (uncommitted on account_api main)
- **Gateway PR #14** — Messaging API endpoint routes with rate limiting and circuit breakers (reviewed, pending merge)
- **BE-006 completion** — Wire EventBus.emit() calls into group_message and scheduled_message controllers
- **Advanced Table Filter** — Prerequisite for all frontend table views (web_core #5)
- **Bug fixes** — 4 urgent bugs across account_api (#62, #63) and web_core (#21, #22)

### What's Not Started

- All 10 frontend messaging pages (FE-001 through FE-010)
- Channel integrations (actual SMS/WhatsApp/Telegram provider connections)
- Real-time WebSocket support
- Dashboard analytics
- Invitation system, audit logging, advanced auth features
- Doppler secret management integration (3 issues created across repos)

---

## 11. GitHub Issues Dashboard

### Summary (as of 2026-02-16)

| Repository | Open | Closed | Total |
|---|---|---|---|
| turumba_account_api | 30 | 2 | 32 |
| turumba_messaging_api | 2 | 10 | 12 |
| turumba_web_core | 16 | 3 | 19 |
| turumba_gateway | 2 | 1 | 3 |
| **Total** | **50** | **16** | **66** |

### Active Issues by Category

**Urgent Bugs (new since 2026-02-13):**
- account_api #63 — Creating new org returns 500 error (2026-02-15)
- account_api #62 — Unauthorized access to organization (2026-02-15)
- web_core #22 — Switching between organization issue (2026-02-16)
- web_core #21 — Inactive user redirection (2026-02-16)

**Immediate Priority (Frontend Messaging Pages):**
- web_core #5 — Advanced table filter component
- web_core #7–#16 — FE-001 through FE-010 (10 messaging feature pages)

**Backend Integration:**
- messaging_api #13 — BE-006: Wire event infrastructure into services
- messaging_api #26 — Doppler integration

**Gateway:**
- gateway #16 — Add query parameter validation plugin for list endpoints

**Account API Backlog (30 open):**
- **Bugs (4):** #56 Inactive user redirection, #57 Org switching, #62 Unauthorized org access, #63 Org creation 500
- **Infrastructure (5):** #61 Doppler, #23 CI/CD, #22 Gateway setup, #19/#20 Cloud provisioning
- **Enhancements (1):** #58 Sorting/filtering across tables
- **Auth & User Management (6):** #25 JWT security, #26 Auth UI, #27 Org mapping, #28/#29 Invitations, #53 Multi-org switcher
- **Contacts (2):** #30 Contact CRUD & grouping, #31 Contact UI
- **Messaging (3):** #36 Messaging service, #38 WhatsApp, #54 Scheduling engine
- **Real-time & Dashboard (6):** #37 Team inbox, #39 Interactive inbox, #40 RabbitMQ, #41 WebSocket, #42 Dashboard APIs, #43 Dashboard UI
- **Documentation (1):** #50 Issue templates
- **Other (3):** #55 Message automation UI, #18/#21 Test issues, #24 Navigation shell

> **Note:** Many account_api issues (#22–#43) were created as early-stage epic placeholders before the messaging API existed. Some overlap with messaging_api task specs and may need consolidation.

---

## 12. Team & Workflows

### Team Members

| Member | Role | Primary Focus |
|---|---|---|
| **bengeos** | Tech Lead | Architecture, planning, all repos |
| **tesfayegirma-116** | Backend Developer | Messaging API development |
| **nahomfix** | Frontend Developer | Web Core + account API bugs |
| **NardosKb** | Developer | Account API, documentation |

### Development Workflow

- **Branching:** `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, `ci/` prefixes
- **Commits:** Conventional Commits (`feat(scope):`, `fix:`, `refactor:`, etc.)
- **CI/CD:** GitHub Actions — lint on every push/PR, Docker build on main/stage/release
- **Deployment:** main → dev, stage → staging, release/* → production
- **Coverage:** Account API 50% (pre-commit), Messaging API 80% (CI)
- **Pre-commit:** Account API runs Ruff + pytest; Messaging API runs Ruff only

### Task Specification Process

1. Tech lead creates detailed task specs in `docs/tasks/`
2. GitHub issues reference task specs
3. Developers execute in respective service repos
4. PRs reviewed and merged to main

---

## 13. Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **API Gateway** | KrakenD | 2.12.1 | Request routing, auth enrichment, CORS |
| **Backend** | FastAPI | Latest | REST API framework |
| **Backend** | Python | 3.11 (Account), 3.12 (Messaging) | Runtime |
| **Auth** | AWS Cognito | — | JWT RS256 identity provider |
| **Database** | PostgreSQL | — | Relational data (core entities, events) |
| **Database** | MongoDB | — | Document data (contacts, persons) |
| **Message Broker** | RabbitMQ | — | Event publishing (transactional outbox) |
| **ORM** | SQLAlchemy | Async | PostgreSQL ORM |
| **ORM** | Motor | — | MongoDB async driver |
| **Frontend** | Next.js | 16.1.1 | React framework |
| **Frontend** | TypeScript | — | Type safety |
| **Frontend Auth** | AWS Amplify | 6.16.0 | Cognito integration |
| **UI** | Radix UI | — | Accessible component primitives |
| **Styling** | Tailwind CSS | v4 | Utility-first CSS with oklch tokens |
| **Forms** | React Hook Form + Zod | — | Form handling and validation |
| **Monorepo** | Turborepo | — | Build orchestration |
| **Package Manager** | pnpm | 9.0.0 | Workspace package management |
| **Linting** | Ruff (Python), ESLint (TS) | — | Code quality |
| **Containers** | Docker + Compose | — | Service orchestration |
| **CI/CD** | GitHub Actions | — | Lint, test, build, deploy |

---

## 14. What's Next

### Critical Path

```
1. Wire event infrastructure ──▶ 2. Build frontend pages ──▶ 3. Channel integrations ──▶ 4. Real-time
       (BE-006)                    (FE-002 to FE-010)          (SMS, WhatsApp, etc.)      (WebSocket)
```

### Immediate Priorities

1. **Fix urgent bugs** — Account API #62/#63 (org access/creation errors), Web Core #21/#22 (org switching/inactive user)
2. **Merge gateway PR #14** — Messaging API endpoint routes are reviewed and ready
3. **Commit AccountUser rework** — Move uncommitted work on account_api main to a feature branch and PR
4. **Complete BE-006** — Wire `EventBus.emit()` into group_message and scheduled_message services so the outbox pattern is fully operational
5. **Build Advanced Table Filter** (web_core #5) — Prerequisite for all 10 frontend table views
6. **Start frontend messaging pages** — Begin with FE-002 (Delivery Channels table) as it's the simplest entity with the clearest spec

### Near-Term Backlog

- Doppler integration across all 3 services (#61, #26, #20)
- Fix remaining account API bugs: inactive user redirection (#56), org switching (#57)
- Dashboard analytics APIs and UI
- Invitation system for team member onboarding
- Gateway query parameter validation plugin (#16)

### Future Phases (Post-Roadmap)

- Channel provider integrations (SMS via Twilio, WhatsApp Business API, Telegram Bot API)
- Real-time WebSocket messaging
- AI-powered features (smart replies, message composer, translation, sentiment)
- Mobile application
- Advanced analytics and CSAT/NPS surveys
- White-labeling and custom domains
- Billing and subscription management (Stripe)
- SSO/SAML for enterprise
- GDPR compliance tooling

---

## Related Documentation

| Document | Path | Purpose |
|---|---|---|
| CLAUDE.md | `/CLAUDE.md` | Development guide with commands and patterns |
| ARCHITECTURE.md | `/ARCHITECTURE.md` | Deep technical architecture spec |
| ROADMAP.md | `/ROADMAP.md` | 12-week sprint plan |
| What is Turumba | `/docs/WHAT_IS_TURUMBA.md` | Business-focused platform overview |
| Messaging Spec | `/docs/TURUMBA_MESSAGING.md` | Detailed messaging system specification |
| Delivery Channels Spec | `/docs/TURUMBA_DELIVERY_CHANNELS.md` | Channel types, credentials, lifecycle |
| Project Status | `/docs/PROJECT_STATUS.md` | Implementation audit with task matrix |
| Feature Tracker | `/docs/FEATURE_TRACKER.md` | Feature completion dashboard |
| GitHub Issues | `/docs/GITHUB_ISSUES.md` | All issues across repos with links |
| Task Specs | `/docs/tasks/messaging/` | Backend and frontend task specifications |
| Task Specs | `/docs/tasks/delivery-channels/` | Channel-specific task specifications |
| Issue Guidelines | `/docs/guidelines/ISSUE_GUIDELINES.md` | How to create clear GitHub issues |
| Research | `/docs/research/` | Competitor analysis (Chatwoot, Erxes, etc.) |
