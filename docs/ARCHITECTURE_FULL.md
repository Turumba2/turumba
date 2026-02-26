# Turumba 2.0 — Full Platform Architecture

> Last updated: 2026-02-26
> Covers all four service repositories plus planned extensions.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [API Gateway (turumba_gateway)](#3-api-gateway-turumba_gateway)
4. [Account API (turumba_account_api)](#4-account-api-turumba_account_api)
5. [Messaging API (turumba_messaging_api)](#5-messaging-api-turumba_messaging_api)
6. [Worker Layer](#6-worker-layer)
7. [Channel Adapter Framework](#7-channel-adapter-framework)
8. [Event Infrastructure (Transactional Outbox)](#8-event-infrastructure-transactional-outbox)
9. [Frontend (turumba_web_core)](#9-frontend-turumba_web_core)
10. [Data Architecture](#10-data-architecture)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [API Design Standards](#12-api-design-standards)
13. [Cross-Service Communication](#13-cross-service-communication)
14. [High-Scale Messaging Architecture](#14-high-scale-messaging-architecture)
15. [Conversations & Customer Support (Planned)](#15-conversations--customer-support-planned)
16. [Security Architecture](#16-security-architecture)
17. [Deployment & Infrastructure](#17-deployment--infrastructure)
18. [Design Patterns Reference](#18-design-patterns-reference)
19. [Implementation Status](#19-implementation-status)

---

## 1. Executive Summary

Turumba 2.0 is a multi-tenant **message automation platform** built on microservices. It enables organizations to automate communication across SMS, SMPP, Telegram, WhatsApp, Messenger, Email, and other channels — with group messaging, scheduled messages, contextualized template messages, and delivery channel management.

**Core principles:**

- **Microservices Architecture** — Loosely coupled services communicating via HTTP/REST and RabbitMQ
- **API Gateway Pattern** — Single entry point (KrakenD) with context enrichment for all client requests
- **Domain-Driven Design** — Services organized around business domains (accounts, messaging)
- **Event-Driven Architecture** — Transactional Outbox pattern with RabbitMQ for reliable async processing
- **Multi-Tenancy** — Every request scoped to an account via gateway-injected headers
- **Strategy Pattern** — Database-agnostic operations (PostgreSQL + MongoDB), pluggable channel adapters

**Technology stack:**

| Layer | Technology |
|-------|-----------|
| API Gateway | KrakenD 2.12.1, Go plugins, Lua scripting |
| Backend Services | Python 3.11/3.12, FastAPI, SQLAlchemy, Motor (async MongoDB) |
| Authentication | AWS Cognito, JWT RS256 |
| Databases | PostgreSQL, MongoDB |
| Message Broker | RabbitMQ (topic exchange, Transactional Outbox pattern) |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| Build System | Turborepo, pnpm |
| Infrastructure | Docker, Docker Compose, GitHub Actions CI/CD |

---

## 2. System Architecture Overview

### Service Topology

```
                         ┌──────────────────────────────┐
                         │       Client Applications      │
                         │   (turumba, negarit, web apps) │
                         └─────────────┬────────────────┘
                                       │ HTTP on port 8080
                                       ▼
                 ┌─────────────────────────────────────┐
                 │          KrakenD API Gateway         │
                 │          (krakend-gateway:8080)       │
                 │                                      │
                 │  • Route all /v1/* requests          │
                 │  • Context enrichment via Go plugin  │
                 │  • LRU cache for context calls       │
                 │  • Rate limiting & circuit breakers  │
                 │  • CORS + authentication passthrough │
                 └──────────────┬──────────────────────┘
                                │ Docker network: gateway-network
                    ┌───────────┴──────────────┐
                    │                          │
          ┌─────────▼─────────┐    ┌──────────▼────────────┐
          │   Account API      │    │   Messaging API        │
          │ (Python 3.11)      │    │  (Python 3.12)         │
          │ Port: 8000 internal│    │  Port: 8000 internal   │
          │                   │    │                        │
          │ • Users/Auth      │    │ • Channels             │
          │ • Accounts        │    │ • Messages             │
          │ • Roles/RBAC      │    │ • Templates            │
          │ • Contacts        │    │ • Group Messages       │
          │ • Groups/Persons  │    │ • Scheduled Messages   │
          │ • Context API     │    │ • Outbox Events        │
          └────────┬──────────┘    └──────────┬────────────┘
                  │  │                       │  │  │
           ┌──────┘  └──────┐          ┌────┘  │  └────────┐
           ▼                ▼          ▼       ▼            ▼
       PostgreSQL       MongoDB    PostgreSQL MongoDB    RabbitMQ
       (accounts,       (contacts, (messages, (future)  (event broker)
        users,          persons)   channels,            │
        roles,                     templates,           ▼
        groups)                    outbox)      ┌──────────────────┐
                                                │   Worker Layer   │
                                                │                  │
                                                │ • OutboxWorker   │
                                                │ • DispatchWorker │
                                                │ • GroupMsgProc   │
                                                │ • ScheduleTrig   │
                                                │ • InboundWorker  │
                                                │ • StatusWorker   │
                                                └──────────────────┘
```

### Request Flow Summary

1. Client sends HTTP request to `localhost:8080/v1/...`
2. KrakenD matches route, applies CORS, extracts `Authorization` header
3. Context-enricher Go plugin intercepts authenticated requests:
   - Calls `/context/basic` on Account API (with LRU cache)
   - Injects `x-account-ids` and `x-role-ids` headers
4. Request forwarded to appropriate backend service with enriched headers
5. Backend service processes request, applies tenant scoping from injected headers
6. Response returned through gateway (passthrough / `no-op` encoding)

---

## 3. API Gateway (turumba_gateway)

### Technology

**KrakenD 2.12.1** — high-performance API gateway with Go plugin support and Lua scripting.

### Configuration System

Template-based with file composition:

```
config/krakend.tmpl                          # Main template
config/partials/
├── configs/
│   ├── cors.json                            # CORS settings
│   ├── logging.json                         # Logging
│   └── plugin.json                          # Context-enricher patterns
└── endpoints/
    ├── auth.json                            # Authentication routes (no enrichment)
    ├── accounts.json                        # Account CRUD routes
    ├── users.json                           # User CRUD routes
    ├── roles.json                           # Role CRUD routes
    ├── persons.json                         # Person (MongoDB) routes
    ├── groups.json                          # Group CRUD + membership routes
    ├── channels.json                        # Delivery channel routes
    ├── messages.json                        # Message routes
    ├── group-messages.json                  # Group message routes
    ├── scheduled-messages.json              # Scheduled message routes
    ├── templates.json                       # Template routes
    └── context.json                         # Context retrieval route
config/lua/                                  # Lua scripts
config/plugins/                              # Compiled Go .so plugins
```

`FC_ENABLE=1` and `FC_PARTIALS` environment variables enable file composition in Docker.

### Context-Enricher Go Plugin

**Purpose:** Fetch user context and inject `x-account-ids`/`x-role-ids` headers before forwarding requests.

**Pattern matching** (`configs/plugin.json`):
- `"POST /v1/accounts"` — Exact method + path match
- `"* /v1/accounts/*"` — Any method, `*` matches one path segment
- `"* /v1/accounts/**"` — Any method, `**` matches multiple path segments

**Patterns configured for:** accounts, users, groups, persons, contacts, channels, messages, group-messages, scheduled-messages, templates (10 wildcard patterns total)

**LRU Cache:** The plugin maintains an in-memory LRU cache for context responses (merged in PR #18), dramatically reducing calls to the Account API for frequently accessed users.

**Workflow:**
```
1. Intercept request matching a configured pattern
2. Check LRU cache for user context (by Authorization header)
3. Cache miss → GET /context/basic with Authorization header
4. Parse JSON: { account_ids, role_ids }
5. Cache result with TTL
6. Inject headers: x-account-ids, x-role-ids
7. Forward enriched request to backend
```

**Security:** These headers are trusted system values — the gateway strips any user-provided values for these headers before injection. Backend services must only trust these values because they come from the gateway.

### API Endpoints (60 total)

**Account API routes** (`gt_turumba_account_api:8000`):
- Authentication: `POST /v1/auth/login`, `/register`, `/verify-email`, `/resend-verification` (no enrichment)
- CRUD + context enrichment: accounts (5), users (5), roles (5), persons (5), groups (5), contacts (5), context (1) = **31 endpoints**

**Messaging API routes** (`gt_turumba_messaging_api:8000`):
- CRUD + context enrichment: channels (5), messages (5), templates (5), group-messages (5), scheduled-messages (5) = **25 endpoints**

**Note:** Account API routes strip `/v1/` prefix at backend (gateway → `/accounts/`). Messaging API routes keep `/v1/` prefix (gateway → `/v1/channels`). This is intentional — it reflects each service's internal routing design.

### Resilience

All Messaging API endpoints include:
- **Rate Limiting** (`qos/ratelimit/router`): 100 req/sec globally, 10/sec per client (by `Authorization` header)
- **Circuit Breaker** (`qos/circuit-breaker`): Opens after 5 errors in 60-second window, 10-second recovery timeout

### Docker Composition

```yaml
services:
  krakend:          # bengeos/turumba-gateway:latest, port 8080
  turumba_account_api:   # platform: linux/amd64, port 5002
  turumba_messaging_api: # platform: linux/amd64, port 5001

networks:
  gateway-network:  # bridge, all services share this
```

Environment split across: `.env` (shared), `.env.account-api`, `.env.messaging-api`.

---

## 4. Account API (turumba_account_api)

**Technology:** Python 3.11, FastAPI, SQLAlchemy (PostgreSQL), Motor (MongoDB), AWS Cognito

### Directory Structure

```
src/
├── main.py                  # FastAPI app, router registration
├── config/config.py         # pydantic-settings configuration
├── middleware/auth.py        # JWT validation, Cognito integration
├── controllers/
│   ├── base.py              # Generic CRUDController[Model, Create, Update, Response]
│   ├── user.py
│   ├── account.py
│   ├── role.py
│   ├── group.py
│   ├── contact.py           # MongoDB controller
│   └── person.py            # MongoDB controller
├── services/<entity>/
│   ├── creation.py          # CreationService
│   ├── retrieval.py         # RetrievalService
│   └── update.py            # UpdateService
├── models/
│   ├── postgres/            # SQLAlchemy models (User, Account, Role, AccountUser, Group)
│   └── mongodb/             # Motor models (Contact, Person)
├── schemas/                 # Pydantic schemas (Create, Update, Response)
├── routers/
│   ├── helpers.py           # create_crud_routes() factory
│   ├── auth.py              # Hand-written auth routes
│   ├── account.py           # Account CRUD + sub-resource endpoints
│   ├── group.py             # Group CRUD + membership
│   └── context.py           # /context/basic (used by gateway plugin)
├── filters/                 # Strategy pattern filters (Postgres + MongoDB)
├── sorters/                 # Strategy pattern sorters
├── resolvers/<entity>/      # Cross-table filter resolvers
└── dependencies/            # FastAPI factory functions for controllers
```

### Domain Entities

| Entity | Database | Description |
|--------|----------|-------------|
| `users` | PostgreSQL | Platform users — authentication via AWS Cognito |
| `accounts` | PostgreSQL | Multi-tenant organizations |
| `roles` | PostgreSQL | Account-specific permission roles |
| `account_users` | PostgreSQL | M:N junction — user-to-account with role assignment |
| `groups` | MongoDB | Contact groups for targeted messaging |
| `contacts` | MongoDB | Message recipients with dynamic attributes |
| `persons` | MongoDB | Internal team persons |

### Generic CRUDController Pattern

`CRUDController[ModelType, CreateSchema, UpdateSchema, ResponseSchema]` — abstract base with pluggable strategies.

Every controller defines two class-level configs:

```python
class ChannelController(CRUDController[Channel, ChannelCreate, ChannelUpdate, ChannelResponse]):
    _FILTER_SORT_CONFIG = FilterSortConfig(
        allowed_filters=[
            AllowedFilter("name", [FilterOperation.EQ, FilterOperation.ICONTAINS]),
            AllowedFilter("status", [FilterOperation.EQ, FilterOperation.IN]),
            # Cross-table filter with resolver:
            AllowedFilter("account_id", [FilterOperation.EQ, FilterOperation.IN],
                          resolver=account_id_resolver),
        ],
        allowed_sorts=[AllowedSort("name"), AllowedSort("created_at")],
        strict_mode=True,
    )
    _SCHEMA_CONFIG = SchemaConfig(
        create_schema=ChannelCreate,
        update_schema=ChannelUpdate,
        response_schema=ChannelResponse,
        excluded_fields=["credentials"],  # write-only fields
    )
```

**Key behaviors:**
- **Default filters bypass validation** — default filters (e.g., `account_id:eq:tenant123`) are trusted system filters that enforce tenant isolation
- **Header context injection** — `set_header_context(headers)` extracts `x-account-ids`, `x-role-ids` from gateway headers
- **Filter merge strategy** — user filters merge with system defaults; user cannot override the account_id scope
- **`model_to_response(context)`** — accepts `"single"` or `"list"` context to conditionally include/exclude fields

### Router Factory

`create_crud_routes(router, get_controller_dep, config)` auto-generates:
- `GET /` → list (paginated)
- `GET /{id}` → single item
- `POST /` → create
- `PUT /{id}` → full update (Account API uses PUT, not PATCH)
- `DELETE /{id}` → delete (204)

Every generated handler calls `controller.set_header_context(request.headers)` and `controller.set_current_user(user)`.

**Sub-resource endpoints** (e.g., `accounts/{id}/users`) are defined **before** `create_crud_routes()` to take precedence over the generated `/{id}` catch-all.

### MongoDB Controller Pattern

MongoDB controllers (Contact, Group, Person) override `set_header_context()` to call `_apply_default_filters()` directly (no retrieval service delegation). For writes, they manually validate `account_id ∈ self.account_ids` before persisting.

### Custom Resolver Pattern

For cross-table filtering (e.g., filtering users by `account_id` via `AccountUser` junction):

```python
# src/resolvers/user/filters.py
def user_account_id_resolver(query, conditions):
    query = query.join(AccountUser)            # single join
    for condition in conditions:               # multiple filters (AND)
        query = query.filter(...)
    return query.distinct()

# Wire in controller's _FILTER_SORT_CONFIG:
AllowedFilter("account_id", [FilterOperation.EQ, FilterOperation.IN],
              resolver=user_account_id_resolver)
```

### Authentication

AWS Cognito with JWT RS256 validation. Dependencies in `src/middleware/auth.py`:

| Dependency | Returns |
|------------|---------|
| `get_current_user` | Full token payload dict |
| `get_current_user_id` | Just `sub` (user UUID) |
| `get_current_user_email` | User email string |
| `require_role("admin")` | Decorator for role-based access |

**Registration is two-step:** `/auth/register` creates Cognito user only. `/auth/verify-email` creates DB records (account + user + role) in one transaction.

### Service Layer Pattern

Three service classes per entity: `CreationService`, `RetrievalService`, `UpdateService`.

All DB operations use `await run_sync(lambda: ...)` (runs in `loop.run_in_executor(None, func)` thread pool) since SQLAlchemy is synchronous but the API is async.

A fourth service may be added for sub-resource membership operations (e.g., `AccountUserService` manages account-user membership, validates `account_id ∈ allowed_account_ids`, raises `InvalidAccountIdError` → HTTP 403).

---

## 5. Messaging API (turumba_messaging_api)

**Technology:** Python 3.12, FastAPI, SQLAlchemy (PostgreSQL), Motor (MongoDB async)

### Directory Structure

```
src/
├── main.py                     # FastAPI app entry point
├── database.py                 # PostgreSQL + MongoDB connections + dependencies
├── config/config.py            # pydantic-settings
├── adapters/
│   ├── base.py                 # ChannelAdapter ABC + 5 data types
│   ├── registry.py             # Decorator-based adapter registry
│   ├── exceptions.py           # AdapterError hierarchy
│   └── telegram/
│       └── telegram_adapter.py # Telegram Bot API adapter
├── clients/
│   └── account_api.py          # HTTP client for cross-service enrichment
├── controllers/                # CRUDController subclasses (5 entities)
├── events/
│   ├── domain_event.py         # Frozen DomainEvent dataclass
│   ├── event_types.py          # EventType string constants
│   ├── event_bus.py            # In-memory EventBus + get_event_bus()
│   ├── outbox_middleware.py    # OutboxMiddleware.flush()
│   ├── pg_notify.py            # PostgreSQL NOTIFY helper
│   └── rabbitmq.py             # RabbitMQ connection + topology
├── extractors/                 # Parse filter/sort/pagination from requests
├── filters/                    # PostgreSQL + MongoDB filter strategies
├── sorters/                    # PostgreSQL + MongoDB sort strategies
├── models/postgres/            # SQLAlchemy models (Channel, Message, Template, etc.)
├── routers/                    # HTTP endpoints (5 entity routers)
├── schemas/                    # Pydantic schemas (Create, Update, Response, Embedded)
├── services/<entity>/          # CreationService, RetrievalService, UpdateService
├── utils/
│   ├── template_renderer.py    # Template variable substitution
│   ├── template_helpers.py     # Variable extraction regex
│   └── recurrence.py          # rrule-based schedule computation
└── workers/
    ├── outbox_worker.py        # Publishes outbox events to RabbitMQ
    ├── dispatch_worker.py      # Sends messages via channel adapters
    ├── group_message_processor.py  # Fan-out GroupMessage → individual Messages
    ├── schedule_trigger.py     # Fires scheduled messages at trigger time
    ├── inbound_message_worker.py   # Creates inbound Message records
    ├── status_update_worker.py # Updates delivery status from provider callbacks
    └── smoke_test.py           # End-to-end dispatch pipeline test
```

### Domain Entities

| Entity | DB | Description |
|--------|----|-------------|
| `channels` | PostgreSQL | Delivery channel configurations (Telegram, SMS, SMPP, WhatsApp, Messenger, Email) |
| `messages` | PostgreSQL | Individual sent/received messages with full status lifecycle |
| `templates` | PostgreSQL | Reusable message blueprints with `{VARIABLE}` placeholders |
| `group_messages` | PostgreSQL | Bulk messaging operations to contact groups |
| `scheduled_messages` | PostgreSQL | Time-delayed dispatch (one-time or recurring) |
| `outbox_events` | PostgreSQL | Transactional outbox for reliable event publishing |

### Request Processing Pipeline

```
HTTP Request
    │
    ▼
FastAPI Router
    │  Injects: db, event_bus, current_user, request headers
    ▼
Controller (set_header_context → extracts account scope)
    │
    ▼
Extractor (parse filters/sorts/pagination from query params or body)
    │
    ▼
FilterSortConfig validation (strict_mode=True → 400 on invalid input)
    │
    ▼
Service Layer (Creation / Retrieval / Update)
    │  CreationService: emit events → flush outbox → commit → pg_notify
    ▼
FilterStrategy / SortStrategy (translate to PostgreSQL or MongoDB)
    │
    ▼
Database (PostgreSQL or MongoDB)
    │
    ▼
SchemaConfig + Response Transformation (field permissions, excluded fields)
    │  MessageController: cross-service enrichment via AccountApiClient
    ▼
HTTP Response (wrapped in envelope)
```

### Cross-Service Response Enrichment

Message responses embed related objects instead of raw UUIDs:

**Same-DB relations** (`channel`, `group_message`, `scheduled_message`):
- Loaded via SQLAlchemy `joinedload` in retrieval service
- Relationships use `lazy="raise"` to prevent N+1 — always explicit `joinedload`
- `model_to_response` uses `model_instance.__dict__` (filtering `_`-prefixed keys) to safely extract loaded attributes

**Cross-service** (`account`, `contact`, `sent_by_user`):
- Fetched from Account API via `AccountApiClient` (`src/clients/account_api.py`)
- Auth header forwarded in service-to-service calls
- List endpoints batch-fetch unique IDs to avoid N+1 HTTP calls
- Failures are silent — fields default to `null`

**Embedded schemas** (`src/schemas/embedded.py`): Compact Pydantic models for each embedded object type.

### Auto-Create Pattern (Template + Message on Parent Creation)

When `POST /scheduled-messages/` or `POST /group-messages/` includes `message_body` instead of `template_id`:

1. A `Template` is auto-created from the body text (category: `"auto-generated"`, variables extracted via regex)
2. A linked `Message` record is created atomically in the same transaction
3. For group sends, `contact_group_ids` are stored in the message's `metadata`
4. This lets users skip a separate template creation step; the auto-created template is also reusable

The request must provide **either** `template_id` **or** `message_body`, enforced by a `@model_validator` in the Create schema.

### Channel Types

| Type | Provider Examples | Auth Method |
|------|------------------|-------------|
| `sms` | Twilio, Africa's Talking, Vonage, MessageBird | API Key + Secret |
| `smpp` | Direct telecom SMSC | System ID + Password over TCP |
| `telegram` | Telegram Bot API | Bot Token |
| `whatsapp` | WhatsApp Business Cloud API | Access Token + Phone Number ID |
| `messenger` | Facebook Messenger | Page Access Token + App Secret |
| `email` | Any SMTP/IMAP server | SMTP + IMAP credentials |

All credentials stored in a `credentials` JSONB column — **write-only** (excluded from API responses).

---

## 6. Worker Layer

All workers are standalone Python processes in `turumba_messaging_api/src/workers/`. They share models, adapters, config, and event types with the main API application.

### Architecture Overview

```
FastAPI API
    │ writes outbox_events in same transaction as entity
    ▼
PostgreSQL
    │ pg_notify wakes worker immediately
    ▼
Outbox Worker ──publishes──▶ RabbitMQ messaging exchange (topic)
                                    │
                    ┌───────────────┼─────────────────┐
                    ▼               ▼                 ▼
           group_message    message.dispatch     webhook.inbound
           _processing      .<channel_type>      message.status.update
                    │               │                 │
                    ▼               ▼                 ▼
           Group Message    Dispatch Worker    Inbound Message /
           Processor        (per channel)      Status Update Worker
                    │               │
                    ▼               ▼
           message.dispatch.  Provider API
           <type> events      (Telegram, Twilio, etc.)
```

### Worker 1: Outbox Worker

**Entry:** `python -m src.workers.outbox_worker`

Implements the Transactional Outbox Pattern. Runs two concurrent async tasks:

**Poll loop (`_poll_loop`):**
- Queries `outbox_events WHERE status = 'pending'` ordered by `created_at`, limited to `OUTBOX_BATCH_SIZE` (default 100)
- Uses `FOR UPDATE SKIP LOCKED` for safe concurrent workers
- Publishes each event to RabbitMQ with `routing_key = event_type`
- Marks `published` on success; increments `retry_count` on failure; marks `failed` after `max_retries` (default 10)
- Every 100 cycles: deletes published events older than `OUTBOX_CLEANUP_DAYS` (default 7)

**pg_notify listener (`_listen_pg_notify`):**
- Opens a raw `psycopg2` connection, executes `LISTEN outbox_channel`
- On notification: immediately triggers `_process_batch()` — reduces latency from poll interval (5s) to near-zero
- Falls back to polling-only if LISTEN fails

### Worker 2: Dispatch Worker

**Entry:** `python -m src.workers.dispatch_worker --channel-type telegram`

Consumes from `message.dispatch.<channel_type>` queue. Sends messages through the appropriate channel adapter.

**Processing flow:**
1. Parse payload: `message_id`, `channel_id`, `retry_count`, `max_retries`, `group_message_id`
2. Load `Message` + `Channel` from PostgreSQL; validate `status = 'queued'` and channel enabled
3. Set message `status = 'sending'`
4. Build `DispatchPayload`; call `get_adapter(channel_type).send(payload)`
5. On success: `status = 'sent'`, record `sent_at` + `provider_message_id` in metadata
6. On retryable failure: requeue with delay (delay queue pattern — TTL + dead-letter back to main queue)
7. On permanent failure: `status = 'failed'`, record `error_details`
8. If `group_message_id` present: atomically increment `sent_count`/`failed_count` on `GroupMessage`

**Error handling by exception type:**

| Exception | Action |
|-----------|--------|
| `AdapterPayloadError` | Permanent failure — mark `failed` |
| `AdapterAuthError` | Permanent failure — mark `failed` |
| `AdapterRateLimitError` | Requeue with delay (respects `retry_after`) |
| `AdapterConnectionError` | Exponential backoff retry, fail after `max_retries` |

**Delay queue pattern:** Instead of `asyncio.sleep()`, messages are published to `message.dispatch.<type>.delay` with a per-message TTL. The queue has no consumers — when TTL expires, RabbitMQ dead-letters the message back to the main dispatch queue via the topic exchange.

### Worker 3: Group Message Processor

**Entry:** `python -m src.workers.group_message_processor`

Consumes `group_message.queued` events from `group_message_processing` queue. Fans out a single group message into individual per-contact dispatch events.

**Processing flow:**
1. Load `GroupMessage`, `Template` (if any), `Channel`; validate all exist and channel is enabled
2. Set `GroupMessage.status = 'processing'`
3. Paginated contact fetch from Account API (`GET /v1/contacts/?filter=group_id:in:{ids}`, batch size: 1000)
4. For each batch:
   - Resolve delivery address per contact (channel-type-specific field mapping)
   - Render template via `render_template()` with contact data, custom values, fallback strategy
   - Deduplicate contacts across batches via `seen_contact_ids`
   - Skip excluded contacts
   - Batch-INSERT all `Message` records in one `db.add_all()` + `commit()`
   - Publish individual dispatch events to `message.dispatch.<channel_type>` queue
   - Update `GroupMessage.pending_count`
5. Set `GroupMessage.status = 'completed'` (or `'partially_failed'`/`'failed'`)

**Contact-to-address resolution:**

| Channel Type | Delivery Address Field |
|--------------|----------------------|
| `sms`, `smpp`, `whatsapp` | `contact.phone` or `contact.phone_number` |
| `email` | `contact.email` |
| `telegram`, `messenger` | `contact.metadata.<type>_chat_id` → fallback to phone |

### Worker 4: Schedule Trigger

**Entry:** `python -m src.workers.schedule_trigger`

Polls `scheduled_messages` table for messages whose `next_trigger_at ≤ now()`.

**Processing flow:**
1. Query `WHERE status = 'pending' AND next_trigger_at <= now()` with `FOR UPDATE SKIP LOCKED`
2. For `send_type = 'single'`: create `Message` record + publish dispatch event to `message.dispatch.<channel_type>`
3. For `send_type = 'group'`: create `GroupMessage` record + publish `group_message.queued` event
4. Handle recurrence:
   - If `is_recurring` + `recurrence_rule`: compute `next_trigger_at` via `compute_next_trigger()`
   - If `next_trigger_at > recurrence_end_at`: set `status = 'completed'`
   - Otherwise: keep `status = 'pending'` with new `next_trigger_at`
   - Non-recurring: set `status = 'completed'`

### Worker 5: Inbound Message Worker

**Entry:** `python -m src.workers.inbound_message_worker`

Consumes from `webhook.inbound` queue (published by webhook route handlers).

**Processing flow:**
1. Extract `channel_id`, `account_id`, `sender_address`, `message_body`, `provider_message_id`, etc.
2. Deduplicate by `provider_message_id` + `channel_id` + `direction = 'inbound'` (JSONB query)
3. Create `Message` with `direction = 'inbound'`, `status = 'delivered'`; store media info in `metadata_`

### Worker 6: Status Update Worker

**Entry:** `python -m src.workers.status_update_worker`

Consumes delivery receipts from `message.status.update` queue.

**Processing flow:**
1. Look up `Message` by `provider_message_id` in JSONB `metadata_` column + `channel_id`
2. Apply status: `delivered` → `status + delivered_at`; `failed` → `status + failed_at + error_details`; `read` → `metadata_.read_at`; `sent` → `status + sent_at`
3. If `group_message_id` present and status changed: increment `delivered_count`/`failed_count`, decrement `pending_count` atomically

### Worker 7: Smoke Test

**Entry:** `python -m src.workers.smoke_test --channel-type telegram --chat-id <id> --bot-token <token>`

End-to-end test: seeds test data, publishes dispatch event, polls until status reaches terminal state, reports PASS/FAIL, cleans up.

### RabbitMQ Topology

```
Exchange: messaging (topic, durable)
│
├── group_message_processing       ← group_message.queued
│   Consumer: Group Message Processor
│
├── message.dispatch.<type>        ← message.dispatch.<type>  (per channel type)
│   Consumer: Dispatch Worker (scalable, one per type)
│
├── message.dispatch.<type>.delay  ← message.dispatch.<type>.delay
│   No consumer (TTL → dead-letters back to dispatch queue)
│
├── webhook.inbound                ← webhook.inbound
│   Consumer: Inbound Message Worker
│
├── message.status.update          ← message.status.update
│   Consumer: Status Update Worker
│
└── messaging.dlq                  ← # (all) via messaging.dlx
    Dead-letter queue for manual investigation

Exchange: messaging.dlx (topic, durable) — dead-letter exchange
```

---

## 7. Channel Adapter Framework

Pluggable interface for dispatching messages through external providers.

### Abstract Interface

```python
class ChannelAdapter(ABC):
    @abstractmethod
    async def send(self, message: DispatchPayload) -> DispatchResult: ...
    @abstractmethod
    async def verify_credentials(self, credentials: dict) -> bool: ...
    @abstractmethod
    async def check_health(self) -> ChannelHealth: ...
    @abstractmethod
    def parse_inbound(self, payload: dict) -> InboundMessage: ...
    @abstractmethod
    def parse_status_update(self, payload: dict) -> StatusUpdate: ...
    @abstractmethod
    def verify_webhook_signature(self, request, secret: str) -> bool: ...
```

### Data Types (dataclasses in `src/adapters/base.py`)

| Type | Purpose |
|------|---------|
| `DispatchPayload` | Input to `send()`: message_id, channel_id, channel_type, credentials, delivery_address, message_body, metadata |
| `DispatchResult` | Output of `send()`: success, provider_message_id, status, error_code, error_message, metadata |
| `ChannelHealth` | Output of `check_health()`: status, latency_ms, error_message |
| `InboundMessage` | Parsed inbound webhook: sender, body, timestamp, provider data |
| `StatusUpdate` | Delivery receipt: provider_message_id, status, timestamp |

### Registry

Decorator-based registration — adapters register at import time:

```python
@register_adapter("telegram")
class TelegramAdapter(ChannelAdapter):
    async def send(self, message: DispatchPayload) -> DispatchResult:
        # POST to api.telegram.org/bot{token}/sendMessage
        ...
```

Resolution at runtime:

```python
adapter = get_adapter(channel_type="telegram", provider="default")
result = await adapter.send(payload)
```

Supports multiple providers per channel type with fallback to `"default"`.

### Exception Hierarchy (`src/adapters/exceptions.py`)

```
AdapterError (base)
├── AdapterNotFoundError      — no adapter for channel_type/provider
├── AdapterConnectionError    — network/connectivity failure (retryable)
├── AdapterAuthError          — invalid credentials (permanent)
├── AdapterRateLimitError     — rate limited (retry_after attribute)
└── AdapterPayloadError       — invalid message payload (permanent)
```

### Implemented Adapters

| Adapter | Status | Capabilities |
|---------|--------|-------------|
| `TelegramAdapter` | Implemented | send, verify_credentials, parse_inbound, parse_status_update, verify_webhook_signature |
| `SMSAdapter` (Twilio, Africa's Talking, Vonage) | Planned | HSM-005 |
| `WhatsAppAdapter` | Planned | HSM-005 |
| `MessengerAdapter` | Planned | HSM-005 |
| `EmailAdapter` (SMTP) | Planned | HSM-005 |
| `SMPPAdapter` (via Jasmin) | Planned | HSM-005 |

---

## 8. Event Infrastructure (Transactional Outbox)

### Why the Outbox Pattern

The naive dual-write (save to DB + publish to RabbitMQ) has a fundamental flaw: a crash between the two operations leaves the system inconsistent. The Transactional Outbox solves this by writing events to a database table in the **same transaction** as the business data. A separate worker then reads the outbox and publishes to RabbitMQ.

| Concern | Solution |
|---------|----------|
| Atomicity | Entity + outbox event in one DB transaction — both succeed or both fail |
| No event loss | Events persist even if RabbitMQ is down — published when broker recovers |
| Separation of concerns | Services emit events without knowing about outbox or RabbitMQ |
| Testability | Mock EventBus to assert events without real DB or broker |
| Idempotency | Events carry a unique `id` — consumers handle at-least-once delivery |
| Scalability | Multiple outbox workers with `FOR UPDATE SKIP LOCKED` |
| Observability | Outbox table is queryable — monitor pending, published, failed events |

### Three-Layer Architecture

```
Layer 1: EventBus (in-memory, request-scoped)
    Services emit DomainEvent objects — nothing is persisted yet.
         │
         ▼
Layer 2: OutboxMiddleware (PostgreSQL, same transaction)
    flush() drains EventBus → creates OutboxEvent rows in DB session.
    Caller commits: entity + outbox events → ATOMIC.
         │
         ▼
Layer 3: Outbox Worker → RabbitMQ
    Standalone process reads pending outbox rows, publishes to broker.
    routing_key = event_type (e.g. "group_message.queued")
         │
         ▼
    Consumers (Group Message Processor, Schedule Trigger, etc.)
```

### DomainEvent

Frozen (immutable) dataclass:

```python
@dataclass(frozen=True)
class DomainEvent:
    event_type: str        # "group_message.created"
    aggregate_type: str    # "group_message"
    aggregate_id: UUID     # Entity ID
    payload: dict          # Event-specific data
    event_id: UUID         # Auto-generated unique ID
    occurred_at: datetime  # Auto-generated UTC timestamp
```

### EventType Constants

| Constant | Value | When Emitted |
|----------|-------|-------------|
| `MESSAGE_CREATED` | `message.created` | Message created |
| `GROUP_MESSAGE_CREATED` | `group_message.created` | GroupMessage created |
| `GROUP_MESSAGE_QUEUED` | `group_message.queued` | Status → `queued` |
| `GROUP_MESSAGE_CANCELLED` | `group_message.cancelled` | Status → `cancelled` |
| `SCHEDULED_MESSAGE_CREATED` | `scheduled_message.created` | ScheduledMessage created |
| `SCHEDULED_MESSAGE_UPDATED` | `scheduled_message.updated` | Config changed |
| `SCHEDULED_MESSAGE_CANCELLED` | `scheduled_message.cancelled` | Status → `cancelled` |
| `SCHEDULED_MESSAGE_PAUSED` | `scheduled_message.paused` | Status → `paused` |
| `SCHEDULED_MESSAGE_RESUMED` | `scheduled_message.resumed` | Status `paused` → `pending` |

### Service Integration Pattern

```python
# Router — inject EventBus once per request
def get_group_message_controller(
    db: Session = Depends(get_postgres_db),
    event_bus: EventBus = Depends(get_event_bus),  # NEW instance per request
) -> GroupMessageController:
    return GroupMessageController(db=db, event_bus=event_bus)

# Service — emit → flush → commit → notify
def _create(self, obj_in, account_id):
    db_obj = GroupMessage(account_id=account_id, **payload)
    self.db.add(db_obj)
    self.db.flush()  # get db_obj.id

    if self.event_bus is not None:
        self.event_bus.emit(DomainEvent(
            event_type=EventType.GROUP_MESSAGE_CREATED,
            aggregate_type="group_message",
            aggregate_id=db_obj.id,
            payload={...},
        ))
        OutboxMiddleware.flush(self.db, self.event_bus)

    self.db.commit()       # ATOMIC: entity + outbox rows
    send_pg_notify(self.db)  # Wake worker immediately
    self.db.refresh(db_obj)  # Must happen AFTER pg_notify (which does its own commit)
    return db_obj
```

**Critical rules:**
- `event_bus` is `None`-guarded for backward compatibility
- `db.refresh()` must happen **after** `send_pg_notify()` — pg_notify does an internal `db.commit()` that expires SQLAlchemy attributes
- `db.flush()` before emit ensures the entity has a generated `id`
- Inject `EventBus` **once** at router level and pass explicitly — multiple `Depends(get_event_bus)` calls create separate instances

### OutboxEvent Model

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | UUID | auto | Primary key |
| `event_type` | String(100) | — | Routing key for RabbitMQ |
| `aggregate_type` | String(100) | — | Entity type |
| `aggregate_id` | UUID | — | Entity ID |
| `payload` | JSONB | — | Full event envelope with metadata |
| `status` | String(20) | `pending` | `pending → published` or `failed` |
| `retry_count` | Integer | 0 | Publish attempts |
| `max_retries` | Integer | 10 | Max attempts before `failed` |
| `published_at` | DateTime | null | When published to RabbitMQ |
| `error_message` | Text | null | Last error (truncated to 500 chars) |

**Indexes:** `event_type`, `aggregate_type`, `aggregate_id`, `status`, composite `(status, created_at)` for efficient batch polling.

### Outbox Envelope Structure

All outbox event payloads contain a standard envelope written by `OutboxMiddleware.flush()`:

```json
{
  "event_id": "uuid",
  "event_type": "group_message.created",
  "aggregate_type": "group_message",
  "aggregate_id": "uuid",
  "occurred_at": "2026-02-26T10:30:00+00:00",
  "data": { ...event-specific fields... },
  "user_id": "cognito-sub",
  "request_id": "req-abc-123",
  "context": { "source": "api", "tenant": "account-uuid" }
}
```

### pg_notify Security

`send_pg_notify()` validates the channel name against `ALLOWED_CHANNELS = {"outbox_channel"}` before interpolating into SQL. PostgreSQL's `NOTIFY` does not support parameter binding for the channel name, making this whitelist essential to prevent SQL injection. SQLite-safe: catches all exceptions and logs at DEBUG level.

---

## 9. Frontend (turumba_web_core)

**Technology:** Turborepo monorepo, pnpm, Next.js 16, React 19, TypeScript, Tailwind CSS v4

### Applications

| App | Port | Status | Purpose |
|-----|------|--------|---------|
| `turumba` | 3600 | Active | Main dashboard — full-featured platform UI |
| `negarit` | 3500 | Skeleton | Focused messaging operations app |
| `web` | 3000 | Skeleton | Additional web app |
| `docs` | 3001 | Skeleton | Documentation app |

### Shared Packages

| Package | Contents |
|---------|----------|
| `@repo/ui` | 24 Radix UI-based components, Field composition system, `DataTable`/`DataTablePagination` generics |
| `@repo/eslint-config` | Shared ESLint configuration |
| `@repo/typescript-config` | Shared TypeScript configuration |

### Feature Module Pattern

```
apps/turumba/src/features/<name>/
├── components/    # Feature-specific UI components
├── services/      # API calls (typed wrappers around Axios client)
├── store/         # Zustand stores (optional)
├── types/         # TypeScript models (optional)
└── index.ts       # Re-exports public API
```

Import from `@/features/<name>`, never from internal paths.

### State Management

| Layer | Technology | Persistence |
|-------|-----------|-------------|
| Server state | TanStack React Query v5 | In-memory cache |
| Client state | Zustand (org store) | localStorage |
| URL state | `nuqs` | URL query params |
| Forms | React Hook Form + Zod | — |

### API Integration

Single Axios instance (`lib/api/client.ts`) against KrakenD gateway:
- Request interceptor: adds JWT token + `account_id` query param from Zustand org store
- All calls go through `localhost:8080/v1/...`

### Authentication

AWS Amplify + Cognito:
- Email + password login
- Optional TOTP 2FA
- Server-side middleware for route protection
- Session management with JWT refresh

### UI Architecture

- Radix UI primitives for accessibility
- CVA (Class Variance Authority) for component variants
- Tailwind CSS v4 with oklch color tokens
- Light/dark theme support via CSS variables
- Path alias: `@/*` maps to app source root

### Implemented Features

| Feature | Status |
|---------|--------|
| Sign In (email/password) | Done |
| Sign Up + Email Verification | Done |
| Server-side Auth Guard | Done |
| Shared UI Library (`@repo/ui`) | Done — 24 components |
| Generic DataTable + Pagination | Done |
| Organization Management | Done |
| User Management | Done |
| Contacts Management (CRUD + filters) | Done |
| Groups Management (CRUD + detail + contacts) | Done |
| 2FA / TOTP | UI only |
| Forgot/Reset Password | UI only |

**Pending (all backend APIs are ready):** Delivery Channels, Messages, Templates, Group Messages, Scheduled Messages pages (FE-001 through FE-010 task specs).

---

## 10. Data Architecture

### Databases Per Service

| Service | PostgreSQL | MongoDB |
|---------|-----------|---------|
| Account API | `turumba_account` | `turumba_account` |
| Messaging API | `turumba_messaging` | `turumba_messaging` (future) |

### Account API — PostgreSQL Schema

```
users
├── id (UUID PK)
├── cognito_sub (string, unique)
├── email (string, unique)
├── first_name, last_name
├── is_active (boolean)
└── created_at, updated_at

accounts
├── id (UUID PK)
├── name (string)
├── slug (string, unique)
├── is_active (boolean)
└── created_at, updated_at

roles
├── id (UUID PK)
├── account_id (UUID FK)
├── name (string)
├── permissions (JSONB)
└── created_at, updated_at

account_users
├── id (UUID PK)
├── account_id (UUID FK)
├── user_id (UUID FK)
├── role_id (UUID FK)
└── UNIQUE(account_id, user_id)

groups (MongoDB)
├── _id (ObjectId)
├── account_id (string UUID)
├── name, description
└── created_at, updated_at

contacts (MongoDB)
├── _id (ObjectId)
├── account_id (string UUID)
├── email, phone, first_name, last_name
├── custom_attributes (dynamic JSONB-equivalent)
└── created_at, updated_at
```

### Messaging API — PostgreSQL Schema

```
channels
├── id (UUID PK)
├── account_id (UUID, indexed)
├── name, channel_type, status, is_enabled
├── credentials (JSONB, write-only)
├── sender_name, default_country_code
├── rate_limit, priority, retry_count, retry_interval
├── last_verified_at, error_message
└── created_at, updated_at

messages
├── id (UUID PK)
├── account_id (UUID, indexed)
├── channel_id (UUID, nullable FK)
├── contact_id (UUID, nullable)
├── sent_by_user_id (UUID, nullable)
├── group_message_id (UUID, nullable FK)
├── template_id (UUID, nullable)
├── direction (enum: outbound/inbound/system)
├── status (enum: queued/sending/sent/delivered/failed/permanently_failed/scheduled)
├── delivery_address, message_body, original_template
├── scheduled_at, sent_at, delivered_at, failed_at
├── metadata_ (JSONB), error_details (JSONB)
└── created_at, updated_at

templates
├── id (UUID PK)
├── account_id (UUID, indexed)
├── name, body, category, channel_type, language
├── variables (JSONB), default_values (JSONB)
├── fallback_strategy (keep_placeholder/use_default/skip_contact)
├── approval_status, external_template_id, is_active
├── created_by_user_id
└── created_at, updated_at

group_messages
├── id (UUID PK)
├── account_id (UUID, indexed)
├── channel_id, template_id, created_by_user_id
├── name, status (draft/queued/processing/completed/partially_failed/failed/cancelled)
├── contact_group_ids (JSONB), exclude_contact_ids (JSONB)
├── total_recipients, sent_count, delivered_count, failed_count, pending_count
├── scheduled_at, started_at, completed_at
├── custom_values (JSONB), metadata_ (JSONB)
└── created_at, updated_at

scheduled_messages
├── id (UUID PK)
├── account_id (UUID, indexed)
├── channel_id, template_id, created_by_user_id
├── name, status (pending/triggered/completed/failed/cancelled/paused)
├── message_body (nullable), custom_values (JSONB)
├── send_type (single/group)
├── delivery_address (nullable), contact_id (nullable)
├── contact_group_ids (JSONB nullable), exclude_contact_ids (JSONB nullable)
├── scheduled_at, timezone, is_recurring
├── recurrence_rule, recurrence_end_at
├── last_triggered_at, next_trigger_at (indexed), trigger_count
├── message_id (FK nullable), group_message_id (FK nullable)
├── metadata_ (JSONB)
└── created_at, updated_at

outbox_events
├── id (UUID PK)
├── event_type (string, indexed)
├── aggregate_type (string, indexed)
├── aggregate_id (UUID, indexed)
├── payload (JSONB)
├── status (pending/published/failed)
├── retry_count, max_retries
├── published_at, error_message
└── created_at, updated_at
```

### Key Model Conventions

- **`metadata_` column** — Models use `metadata_` (avoids Python keyword); schemas use `metadata` with `validation_alias="metadata_"`
- **PostgreSQL base model** — `PostgresBaseModel` provides `id` (UUID), `created_at`, `updated_at` automatically — never redefine
- **MongoDB base model** — `MongoDBBaseModel` provides `id` (PyObjectId aliased to `_id`), timestamps. Call `update_timestamp()` before saving updates
- **Re-export requirement** — All PostgreSQL models must be re-exported in `src/models/postgres/__init__.py` for Alembic `--autogenerate` to detect them
- **Relationship loading** — Use `lazy="raise"` on SQLAlchemy relationships + explicit `joinedload` in retrieval queries. Never use `lazy="joined"` or `lazy="select"`
- **Async + sync SQLAlchemy** — Use `asyncio.to_thread()` for sync SQLAlchemy operations in async FastAPI context

---

## 11. Authentication & Authorization

### Authentication Flow

```
1. User calls POST /v1/auth/register
   → Account API creates Cognito user (user pool only)
   → Returns: confirmation required

2. User calls POST /v1/auth/verify-email
   → Account API verifies OTP with Cognito
   → Creates DB records: user + account + default role (single transaction)
   → Returns: JWT tokens

3. User calls POST /v1/auth/login
   → Account API authenticates with Cognito
   → Returns: access_token (JWT RS256), refresh_token, id_token

4. All subsequent requests:
   → Include "Authorization: Bearer {access_token}"
   → Gateway context-enricher calls /context/basic
   → Injects x-account-ids, x-role-ids headers
   → Backend services trust these headers
```

### JWT Validation

The Account API's `src/middleware/auth.py` validates JWT tokens:
- Algorithm: RS256
- Key: fetched from Cognito JWKS endpoint
- Claims validated: `exp`, `iss`, `aud`, `token_use`

### Multi-Account Context

A single user can belong to multiple accounts with different roles in each:

- `x-account-ids` header: comma-separated list of account UUIDs the user belongs to
- `x-role-ids` header: comma-separated list of role IDs for those accounts
- Backend services use these to scope all queries (`account_id IN (x-account-ids)`)

### Role-Based Access Control

Roles are account-specific and contain JSON permissions:

```json
{
  "can_send_messages": true,
  "can_manage_channels": false,
  "can_manage_templates": true,
  "can_view_analytics": true
}
```

`require_role("admin")` decorator enforces role-based access in routers.

### Security Properties

- Backend services never trust `x-account-ids`/`x-role-ids` from external sources — only from the gateway
- KrakenD strips these headers from incoming requests before the plugin adds them
- Credentials (channel API keys, tokens) are stored in JSONB but **excluded from all API responses** via `SchemaConfig`
- AWS Cognito manages password hashing, token rotation, MFA

---

## 12. API Design Standards

### Response Envelope (All Services)

**Single item** (`SuccessResponse[T]`):
```json
{ "success": true, "data": {...}, "message": null }
```

**List** (`ListResponse[T]`):
```json
{ "success": true, "data": [...], "meta": { "total": N, "skip": 0, "limit": 100 } }
```

**Error** (`ErrorResponse`):
```json
{ "success": false, "error": "not_found", "message": "...", "details": {} }
```

**Delete:** `204 No Content` with no body.

### HTTP Method Conventions

| Method | Status | Response |
|--------|--------|----------|
| `GET /` | 200 | `ListResponse[T]` |
| `GET /{id}` | 200 | `SuccessResponse[T]` |
| `POST /` | 201 | `SuccessResponse[T]` |
| `PATCH /{id}` | 200 | `SuccessResponse[T]` (Messaging API uses PATCH for partial updates) |
| `PUT /{id}` | 200 | `SuccessResponse[T]` (Account API uses PUT for full replacement) |
| `DELETE /{id}` | 204 | No body |

### Filter & Sort Syntax

```
?filter=field:op:value&sort=field:order
```

**Operations:** `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `contains`, `icontains`, `in`, `like`, `range`, `is_null`, `is_not_null`, `startswith`, `endswith`

**Sort order:** `asc` (default), `desc`

**Examples:**
```bash
GET /v1/messages/?filter=status:eq:delivered&filter=direction:eq:outbound&sort=created_at:desc
GET /v1/channels/?filter=channel_type:in:telegram,sms&filter=is_enabled:eq:true
GET /v1/templates/?filter=name:icontains:welcome&sort=updated_at:desc
```

### Standard Error Codes

| HTTP Status | Error Code |
|-------------|-----------|
| 400 | `bad_request` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 409 | `conflict` |
| 422 | `validation_error` |
| 429 | `rate_limited` |
| 500 | `internal_error` |
| 503 | `service_unavailable` (MongoDB connectivity errors) |

---

## 13. Cross-Service Communication

This section documents every actual service-to-service call in the platform — the caller, the endpoint, the authentication mechanism, the failure handling, and why the call exists. All HTTP calls bypass the KrakenD gateway and go directly over the Docker `gateway-network` using container DNS names.

### Service Discovery

```
Account API:   http://gt_turumba_account_api:8000
Messaging API: http://gt_turumba_messaging_api:8000
RabbitMQ:      amqp://rabbitmq:5672/    (by service name on gateway-network)
```

Configuration for the Account API base URL in Messaging API (`src/config/config.py`):

```python
ACCOUNT_API_BASE_URL: str = "http://gt_turumba_account_api:8000"
ACCOUNT_API_SERVICE_TOKEN: str = ""  # Shared secret for machine-to-machine calls
```

Override for local development: `ACCOUNT_API_BASE_URL=http://localhost:8000`

---

### Call 1: Gateway → Account API — Context Enrichment

**Who calls:** KrakenD context-enricher Go plugin (on every authenticated request)
**Endpoint:** `GET http://gt_turumba_account_api:8000/context/basic`
**Auth:** Forwards the incoming request's `Authorization: Bearer {JWT}` header
**Timeout:** 10,000ms (10 seconds)
**Cached:** Yes — in-memory LRU cache in the Go plugin (keyed by Authorization header value)

**What `/context/basic` returns** (from `src/controllers/context.py`):

```json
{
  "message": "Basic context retrieved",
  "account_ids": "uuid1,uuid2",
  "role_ids": "uuid3,uuid4"
}
```

The plugin maps these fields:
- `account_ids` → `x-account-ids` header (comma-separated UUIDs)
- `role_ids` → `x-role-ids` header (comma-separated UUIDs)

**What Account API does internally:**

```python
# ContextController.get_basic_context()
user = db.query(User).filter(User.cognito_user_id == jwt["sub"]).first()
accounts = db.query(Account).filter(Account.users.contains(user)).all()
account_ids = [a.id for a in accounts]
roles = db.query(Role).filter(Role.account_id.in_(account_ids)).all()
```

**Failure handling:** If the context call fails or times out, the plugin lets the request through unenriched (no `x-account-ids`/`x-role-ids` headers). Backend services then see empty account scope and return empty results or 403.

```
Client Request
    │
    ▼
KrakenD Gateway
    ├── Check LRU cache (by Authorization header value)
    │   ├── HIT  → inject cached account_ids/role_ids headers → forward to backend
    │   └── MISS → GET /context/basic (10s timeout)
    │              ├── Success → cache result → inject headers → forward to backend
    │              └── Failure → forward request without enriched headers
    ▼
Backend Service (receives x-account-ids, x-role-ids as trusted headers)
```

---

### Call 2: Messaging API → Account API — Response Enrichment (User JWT Forwarding)

**Who calls:** `AccountApiClient` (`src/clients/account_api.py`), invoked from message router handlers
**When:** On `GET /v1/messages/{id}` and `GET /v1/messages/`
**Auth:** Forwards the end-user's `Authorization: Bearer {JWT}` from the incoming HTTP request
**Timeout:** 5 seconds (`_TIMEOUT = 5.0`)
**HTTP client:** `httpx.AsyncClient` (singleton on `request.app.state.account_api_client`)

**Endpoints called:**

| Method | URL | Purpose | Response Field |
|--------|-----|---------|---------------|
| `GET` | `/accounts/{account_id}` | Embed account name/description | `message.account` |
| `GET` | `/persons/{contact_id}` | Embed contact profile | `message.contact` |
| `GET` | `/users/{user_id}` | Embed sender info | `message.sent_by_user` |

> **Note:** Contact data is fetched from `/persons/` (MongoDB collection), not `/contacts/`.

**How the client works** (`src/clients/account_api.py`):

```python
class AccountApiClient:
    async def _get(self, url: str, auth: str | None) -> dict | None:
        headers = {"Authorization": auth} if auth else {}
        try:
            response = await self._client.get(url, headers=headers)
            response.raise_for_status()
            body = response.json()
            return body.get("data", body)   # unwraps SuccessResponse envelope
        except Exception as exc:
            logger.debug("Account API call failed for %s: %s", url, exc)
            return None                     # silent failure — field becomes null
```

**Single message enrichment** — three concurrent calls via `asyncio.gather()`:

```python
# enrich_message(response, auth)
account_data, contact_data, user_data = await asyncio.gather(
    self.get_account(response.account_id, auth),
    self.get_contact(response.contact_id, auth) if response.contact_id else _noop(),
    self.get_user(response.sent_by_user_id, auth) if response.sent_by_user_id else _noop(),
)
```

**List enrichment** — deduplicates IDs first, batch-fetches, then maps back. Avoids N+1 HTTP calls:

```python
# enrich_message_list(responses, auth)
account_ids = list({r.account_id for r in responses})        # unique account IDs
contact_ids = list({r.contact_id for r in responses if r.contact_id})
user_ids    = list({r.sent_by_user_id for r in responses if r.sent_by_user_id})

# Single asyncio.gather for ALL unique IDs across the page
all_results = await asyncio.gather(
    *[self.get_account(aid, auth) for aid in account_ids],
    *[self.get_contact(cid, auth) for cid in contact_ids],
    *[self.get_user(uid, auth) for uid in user_ids],
)
# Then build lookup maps and assign to each response
```

**How the router injects the client** (from `src/routers/message.py`):

```python
# Singleton stored on app.state at startup
def _get_account_client(request: Request) -> AccountApiClient:
    return request.app.state.account_api_client

# In list handler:
account_client = _get_account_client(request)
auth = request.headers.get("authorization")   # forward user's JWT verbatim
enriched = await account_client.enrich_message_list(responses, auth)
```

**Embedded shapes returned:**

```
account:       { id, name, description }
contact:       { id, account_id, properties }
sent_by_user:  { id, given_name, family_name, email }
```

**Failure handling:** All failures are **silent** — logged at DEBUG level, the field in the response is set to `null`. The response is always returned even if enrichment partially or fully fails. `contextlib.suppress(ValidationError)` guards schema validation of the returned data.

---

### Call 3: Messaging API Workers → Account API — Service Token Authentication

Workers run without a user session — there is no JWT to forward. They use a **pre-shared service token** set via the `ACCOUNT_API_SERVICE_TOKEN` environment variable.

#### Call 3a: Group Message Processor — Fetch Contacts for Fan-Out

**Who calls:** `GroupMessageProcessor._fetch_contacts()` (`src/workers/group_message_processor.py`)
**When:** During group message fan-out, in paginated batches of 1000 contacts
**Auth:** `Authorization: Bearer {ACCOUNT_API_SERVICE_TOKEN}` (machine-to-machine)
**Timeout:** 30 seconds (longer than the 5s API enrichment timeout — fan-out is latency-tolerant)
**HTTP client:** Fresh `httpx.AsyncClient` per batch (not reused between calls)

**Endpoint called:**

```
GET http://gt_turumba_account_api:8000/v1/contacts/
    ?filter=group_id:in:{group_id_1},{group_id_2}
    &limit=1000
    &offset=0
```

**Actual implementation:**

```python
async def _fetch_contacts(self, contact_group_ids, offset, limit) -> list[dict]:
    group_filter = ",".join(str(gid) for gid in contact_group_ids)
    url = (
        f"{settings.ACCOUNT_API_BASE_URL}/v1/contacts/"
        f"?filter=group_id:in:{group_filter}&limit={limit}&offset={offset}"
    )
    headers: dict[str, str] = {}
    if settings.ACCOUNT_API_SERVICE_TOKEN:
        headers["Authorization"] = f"Bearer {settings.ACCOUNT_API_SERVICE_TOKEN}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", data.get("items", []))   # handles both envelope formats
```

**Pagination loop:**

```python
offset = 0
while True:
    contacts = await self._fetch_contacts(group_ids, offset, settings.GROUP_MESSAGE_BATCH_SIZE)
    if not contacts:
        break
    # process batch...
    offset += settings.GROUP_MESSAGE_BATCH_SIZE
    if len(contacts) < settings.GROUP_MESSAGE_BATCH_SIZE:
        break    # last page
```

**Failure handling:** `httpx.RequestError` and `httpx.HTTPStatusError` are re-raised — the entire fan-out fails with a logged exception. The `GroupMessage` status is set to `"failed"` or `"partially_failed"` depending on how many contacts were already dispatched.

#### Call 3b: Inbound Message Worker — Contact Upsert

**Who calls:** `InboundMessageWorker._resolve_contact()` (`src/workers/inbound_message_worker.py`)
**When:** When processing an inbound webhook message from any channel. Resolves (or creates) the sending contact in the Account API before creating the inbound `Message` record.
**Auth:** `X-Service-Token: {ACCOUNT_API_SERVICE_TOKEN}` header (via `AccountApiClient._internal_headers()`)
**Endpoint:** `POST http://gt_turumba_account_api:8000/internal/contacts/upsert`

**Why a different header (`X-Service-Token` vs `Bearer`):** Internal endpoints on the Account API use a dedicated header to distinguish service calls from user-JWT calls, allowing different authorization logic.

**Actual implementation in `AccountApiClient`:**

```python
def _internal_headers(self) -> dict:
    token = settings.ACCOUNT_API_SERVICE_TOKEN
    return {"X-Service-Token": token} if token else {}

async def upsert_contact_by_sender(
    self, account_id, channel_type, sender_address, extra_properties
) -> dict | None:
    body = {
        "account_id": str(account_id),
        "channel_type": channel_type,
        "sender_address": sender_address,
        "extra_properties": extra_properties or {},
    }
    return await self._post(
        f"{self._base_url}/internal/contacts/upsert",
        body,
        internal=True,    # uses X-Service-Token header
    )
```

**Request body example:**

```json
{
  "account_id": "uuid",
  "channel_type": "telegram",
  "sender_address": "+251911234567",
  "extra_properties": { "username": "abebe_tesfaye" }
}
```

**What it does on the Account API side:** Find-or-create a contact by `(account_id, channel_type, sender_address)`. Returns the contact dict with `id`.

**How the worker uses the result:**

```python
contact = await self._account_client.upsert_contact_by_sender(
    account_id=account_id,
    channel_type=channel_type,
    sender_address=sender_address,
    extra_properties={"username": metadata.get("from_username")},
)
contact_id = contact.get("id") if contact else None

msg = Message(
    ...
    contact_id=contact_id,    # null if upsert failed (non-fatal)
    delivery_address=sender_address,
    ...
)
```

**Failure handling:** Contact resolution failures are **non-fatal**. The inbound message is still created with `contact_id = None`. A warning is logged. This prevents losing inbound messages just because contact resolution fails.

---

### Communication Matrix

| Caller | Target | Endpoint | Auth Method | Sync/Async | On Failure |
|--------|--------|----------|-------------|-----------|------------|
| KrakenD plugin | Account API | `GET /context/basic` | User JWT (forwarded) | Sync (Go) | Pass through unenriched |
| Message router | Account API | `GET /accounts/{id}` | User JWT (forwarded) | Async (httpx) | Silent null |
| Message router | Account API | `GET /persons/{id}` | User JWT (forwarded) | Async (httpx) | Silent null |
| Message router | Account API | `GET /users/{id}` | User JWT (forwarded) | Async (httpx) | Silent null |
| GroupMessage processor | Account API | `GET /v1/contacts/?filter=group_id:in:...` | Bearer service token | Async (httpx) | Fatal — fan-out fails |
| Inbound message worker | Account API | `POST /internal/contacts/upsert` | X-Service-Token | Async (httpx) | Non-fatal — contact_id = null |

### Two Authentication Modes Summary

```
Mode 1: User JWT Forwarding (API handlers)
─────────────────────────────────────────
Request arrives at Messaging API with:
  Authorization: Bearer {user_JWT}

AccountApiClient._get() passes it through:
  headers = {"Authorization": auth}  # auth = the same JWT string

Account API validates it with Cognito JWKS (same as any user request).
Used for: response enrichment (GET /accounts, /persons, /users)


Mode 2: Service Token (Workers — no user session)
──────────────────────────────────────────────────
Workers have no user JWT. They use a pre-shared secret:
  ACCOUNT_API_SERVICE_TOKEN=<shared_secret>

Two header variants:
  a) Bearer token  → Authorization: Bearer {service_token}
     Used by: GroupMessageProcessor._fetch_contacts()
     Calls: GET /v1/contacts/ (regular authenticated endpoint)

  b) X-Service-Token → X-Service-Token: {service_token}
     Used by: AccountApiClient._internal_headers()
     Calls: POST /internal/contacts/upsert (internal endpoint)

If ACCOUNT_API_SERVICE_TOKEN is empty (string ""), no auth header is sent.
Account API must be configured to accept or reject unauthenticated service calls.
```

### Pattern: RabbitMQ Events (Async)

All domain events flow through RabbitMQ (no direct service-to-service call needed). The `turumba_realtime` service (planned) will consume events from the `messaging` exchange to push to browser clients via WebSocket.

```
Messaging API  ──outbox_worker──▶  RabbitMQ messaging exchange
                                          │
                              ┌───────────┼──────────────┐
                              ▼           ▼              ▼
                       group_message  dispatch.*    webhook.inbound
                       _processing                 status.update
                              │
                     (planned) turumba_realtime
                              │
                              ▼
                        Browser clients (Socket.IO)
```

---

## 14. High-Scale Messaging Architecture

> **Status:** Architecture proposal. P0 components (channel adapters, dispatch workers, group message processor) are implemented. P1+ components are planned.

See `docs/HIGH_SCALE_MESSAGING_ARCHITECTURE.md` for full details.

### Scale Target

| Metric | Value |
|--------|-------|
| Messages/day | 1,000,000 |
| Average throughput | ~12 msg/sec |
| Peak burst (10x) | ~120 msg/sec |
| Group spike | 100K–500K messages in minutes |
| 1-year data | ~365M message rows |

### Full Dispatch Pipeline (End-to-End)

```
Single message:
POST /v1/messages/ { channel_id, message_body, delivery_address }
    → Message record (status: queued)
    → Outbox event: message.dispatch.<channel_type>
    → Outbox Worker → RabbitMQ
    → Dispatch Worker (loads credentials from Redis cache → DB fallback)
    → Rate limiter check (Redis token bucket per channel)
    → ChannelAdapter.send()
    → status: sent
    → Provider webhook → POST /webhooks/<type>/<channel_id>
    → Inbound worker → message.status.update queue
    → Status Update Worker → status: delivered

Group message (100K contacts):
POST /v1/group-messages/ { status: queued, channel_id, template_id, contact_group_ids }
    → GroupMessage record
    → Outbox event: group_message.queued
    → Group Message Processor (consumes from group_message_processing queue)
    → Paginated contact fetch from Account API (1000/batch)
    → Per-contact: render template, create Message, publish dispatch event
    → N × Dispatch Worker instances process individual messages
    → Aggregate progress: delivered_count, failed_count updated atomically
```

### Per-Channel-Type Dispatch Queues

Each channel type gets its own queue for independent scaling and isolation:

```
message.dispatch.sms      ← SMS Dispatch Workers (N instances)
message.dispatch.telegram ← Telegram Dispatch Workers
message.dispatch.whatsapp ← WhatsApp Dispatch Workers
message.dispatch.messenger ← Messenger Dispatch Workers
message.dispatch.email    ← Email Dispatch Workers
message.dispatch.smpp     ← SMPP Gateway (Jasmin or custom)
```

### Rate Limiting (Three Levels)

| Level | Mechanism | Scope |
|-------|-----------|-------|
| Per-channel instance | Redis token bucket (`rate_limit:{channel_id}`) | Respects `channel.rate_limit` (msgs/min) |
| Per-provider global | Redis shared counter | Account-level provider limits (e.g., Twilio 100 msg/sec) |
| Per-tenant quota | API layer | Business-level daily/monthly caps |

### New Infrastructure Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| RabbitMQ | Message broker, event routing | Configured |
| Redis | Rate limiting, credential caching, progress counters, dispatch dedup | P1 — not yet added |
| PostgreSQL read replica | Read scaling for list queries | P3 — later |
| S3 / MinIO | Media attachments | P2 — not yet added |
| Jasmin (SMPP proxy) | SMPP connection management | P2 — if SMPP needed early |

### Database Scaling Strategy

**Table partitioning** (when approaching 10M+ rows):
```sql
CREATE TABLE messages (...) PARTITION BY RANGE (created_at);
CREATE TABLE messages_2026_01 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

**Key indexes:**
```sql
CREATE INDEX idx_messages_account_created ON messages (account_id, created_at DESC);
CREATE INDEX idx_messages_account_status ON messages (account_id, status);
CREATE INDEX idx_outbox_pending ON outbox_events (status, created_at) WHERE status = 'pending';
```

**Archive strategy:** Hot (3 months) → Warm with compression (12 months) → Cold S3 Parquet (12+ months)

---

## 15. Conversations & Customer Support (Planned)

> **Status:** Architecture designed, not yet implemented. See `docs/plans/conversations/ARCHITECTURE.md` for full spec.

### Overview

An omnichannel customer support module enabling agents to converse with customers across all connected channels (Telegram, WhatsApp, Messenger, SMS, Email) with bot-first routing and intelligent agent assignment.

### New Service: turumba_realtime

Standalone real-time event delivery service bridging RabbitMQ domain events to connected browser clients via WebSocket.

```
turumba_realtime (:3200)
├── RabbitMQ Consumer (subscribes to conversation.*, message.*, agent.*)
├── Event Router (maps events to Socket.IO rooms)
├── Socket.IO Server (/agents namespace, /customers namespace)
│   Rooms: account:{id}, conv:{id}, user:{id}
├── Auth Middleware (Cognito JWT validation)
└── Redis Adapter (Socket.IO multi-instance + presence tracking + typing indicators)
```

**Technology:** Node.js + Socket.IO + Redis adapter

### New Models (Messaging API)

| Model | Purpose |
|-------|---------|
| `conversations` | Thread of messages between a contact and agent team on a channel |
| `canned_responses` | Pre-written quick replies with short codes (e.g., `/greeting`) |
| `bot_rules` | Trigger-condition-action rules for automated routing |
| `contact_identifiers` | Cross-platform contact resolution (same person on WhatsApp + Telegram) |

**Extended `messages` model:**
- `conversation_id` (FK nullable)
- `is_private` (boolean — internal notes visible only to agents)
- `sender_type` (enum: contact/agent/bot/system)
- `sender_id` (UUID nullable — agent user_id or bot_rule_id)

### New Model (Account API)

`agent_preferences` — One row per user: available_channels, available_topics, available_hours (with timezone), languages, max_concurrent_conversations, is_available, auto_accept, notification_preferences.

### Conversation Status Lifecycle

```
open → bot → assigned → pending → resolved → closed
         ↑         ↓
         └── can be reassigned
Customer sends new message after resolved → reopens as "open"
```

### Bot-First Routing Phases

**Phase 1 (MVP):** Rule-based router — keyword matching, time-based (business hours), channel-based routing. `BotRules` evaluated in priority order.

**Phase 2:** AI-powered intent classification — LLM classifies intent and confidence, rules match on `intent + confidence_min`.

**Phase 3:** Conversational bot — Multi-turn conversations, knowledge base FAQ, human handoff with full context transfer.

### Agent Routing Algorithm

```
1. Filter eligible agents:
   - is_available == true
   - current time within available_hours (timezone-aware)
   - available_channels includes conversation's channel type
   - available_topics includes detected topic
   - active_conversations < max_concurrent_conversations

2. Sort by: least active conversations, then longest idle time

3. Assign top candidate (or queue if none available)
```

### New API Endpoints

**Messaging API:** Conversations CRUD, ConversationMessages (nested), ConversationAssignment, CannedResponses CRUD, BotRules CRUD, ContactIdentifiers CRUD, Webhooks (inbound)

**Account API:** AgentPreferences CRUD + `/me` shortcut

### Implementation Phases

| Phase | Content |
|-------|---------|
| 1 — Foundation | Conversation model, extend Message, ContactIdentifier, CannedResponse, AgentPreference, basic inbox |
| 2 — Bot + Routing | BotRule engine, keyword/time routing, round-robin assignment, service-to-service HTTP |
| 3 — Real-Time | turumba_realtime service, agent inbox UI, typing/presence |
| 4 — AI Bot | Intent classification, multi-turn bot, knowledge base, CSAT, SLA tracking |

---

## 16. Security Architecture

### Network Isolation

- All services run on private `gateway-network` Docker bridge
- Only KrakenD is exposed externally (port 8080)
- Internal communication via Docker DNS container names
- No backend ports exposed in production

### Header Security

- KrakenD strips user-provided `x-account-ids`/`x-role-ids` before injection
- Backend services validate these headers come from trusted (gateway) source
- All credentials excluded from API responses via `SchemaConfig.excluded_fields`

### Credential Security

- Channel credentials stored as JSONB — never returned in API responses
- Credentials masked in logs
- No hardcoded credentials — all via environment variables / pydantic-settings
- GitHub Secrets for CI/CD credentials

### Input Validation

- All API inputs validated by Pydantic v2 schemas
- Filter operations validated against `AllowedFilter` whitelist — unknown fields rejected with 400
- SQL injection impossible via SQLAlchemy ORM and parameterized queries
- pg_notify channel whitelist prevents SQL injection in `NOTIFY` statements

### Webhook Security

Each provider uses a different HMAC verification scheme:
- Telegram: `secret_token` in X-Telegram-Bot-Api-Secret-Token header
- WhatsApp: `x-hub-signature-256` with app secret
- Twilio: X-Twilio-Signature with auth token
- Messenger: `app_secret` HMAC

Webhook routes do **not** require JWT auth — signature verification replaces it.

### CORS

Currently permissive (`allow_origins: ["*"]`, credentials not allowed). Should be tightened for production.

---

## 17. Deployment & Infrastructure

### Docker Compose Services

**Gateway stack** (`turumba_gateway/docker-compose.yml`):
- `krakend-gateway` — KrakenD API gateway
- `gt_turumba_account_api` — Account API (Python 3.11, `platform: linux/amd64`)
- `gt_turumba_messaging_api` — Messaging API (Python 3.12, `platform: linux/amd64`)

All containers require `platform: linux/amd64` (critical for Apple Silicon compatibility with KrakenD).

### Worker Deployment

Workers in `turumba_messaging_api` run as separate Docker containers sharing the same image but different entry points:

```dockerfile
# Dockerfile.worker
FROM python:3.12
CMD ["python", "-m", "src.workers.outbox_worker"]
```

Scale independently via Docker Compose or Kubernetes deployment replicas:
```bash
docker compose scale dispatch_worker_telegram=3 dispatch_worker_sms=5
```

### CI/CD Pipelines

**Account API / Messaging API (GitHub Actions):**
- `lint.yml` — Every push/PR: Ruff lint, format check, pytest with coverage (50%/80%)
- `docker-build.yml` — Push to main/stage/release: build Docker image + push to Docker Hub

**Gateway:**
- `build-plugin.yml` — Push to main (plugins/ or config/ changes): build Go plugins + Docker image
- `deploy.yml` — SSH deploy: main→dev, stage→staging, release/*→prod

### Branch → Environment Mapping

| Branch | Environment |
|--------|-------------|
| `main` | Development |
| `stage` | Staging |
| `release/*` | Production |

### Environment Configuration

```
.env                    # Shared: ports, images, AWS credentials
.env.account-api        # Account API: DATABASE_URL, MONGODB_URL, COGNITO_*
.env.messaging-api      # Messaging API: DATABASE_URL, RABBITMQ_URL, ACCOUNT_API_BASE_URL
```

All configuration via `pydantic-settings` — no hardcoded values.

---

## 18. Design Patterns Reference

### Strategy Pattern

Used for database-agnostic filtering and sorting:

```
FilterStrategy (ABC)
├── PostgresFilterStrategy  → SQLAlchemy .filter() expressions
└── MongoDBFilterStrategy   → MongoDB query operators

SortStrategy (ABC)
├── PostgresSortStrategy    → SQLAlchemy .order_by() expressions
└── MongoDBSortStrategy     → MongoDB sort dictionaries
```

Also used for channel adapters:
```
ChannelAdapter (ABC)
├── TelegramAdapter    (implemented)
├── SMSAdapter         (planned)
├── WhatsAppAdapter    (planned)
└── ...
```

### Dependency Injection

FastAPI's `Depends()` for controller factories:

```python
@router.post("/")
async def create(
    payload: ChannelCreate,
    controller: ChannelController = Depends(get_channel_controller),
    user: dict = Depends(get_current_user),
):
    controller.set_header_context(request.headers)
    controller.set_current_user(user)
    result = await controller.create(payload)
    return SuccessResponse(data=controller.model_to_response(result))
```

**Rule:** Never instantiate controllers manually inside route handlers — always via `Depends()`.

### Transactional Outbox

Solves the dual-write problem: entity change + event emission in one atomic DB transaction. A separate worker process publishes events to RabbitMQ. (See Section 8.)

### CQRS Light

Write path (API creates/updates entities, emits events) is separated from read path (future: read replicas for list queries and analytics).

### Multi-Tenancy via Header Injection

Gateway injects `x-account-ids` header → backend controllers extract → apply as untouchable default filters → every query scoped to tenant. Users can never see or modify data from other accounts.

### Adding a New Domain Entity (Backend)

Follow this 8-step process (consistent across both APIs):

1. **Model** — Create in `src/models/postgres/` or `src/models/mongodb/`; re-export in `__init__.py`
2. **Schemas** — Create `<Entity>Create`, `<Entity>Update`, `<Entity>Response` in `src/schemas/`
3. **Services** — Create `CreationService`, `RetrievalService`, `UpdateService` in `src/services/<entity>/`
4. **Controller** — Extend `CRUDController` with `_FILTER_SORT_CONFIG` and `_SCHEMA_CONFIG` class attrs
5. **FilterSortConfig** — Define allowed filters/sorts with operations and resolvers
6. **SchemaConfig** — Define field permissions, excluded fields, transformations
7. **Router** — Create FastAPI router with CRUD endpoints
8. **Register** — Add router to `src/main.py`
9. **Migration** — `alembic revision --autogenerate -m "Add <entity>"`
10. **Architecture docs** — Update `ARCHITECTURE.md` alongside the code

---

## 19. Implementation Status

### turumba_account_api — Complete

All core entities fully implemented (model → schema → service → controller → router → tests).

| Entity | Status |
|--------|--------|
| User | Done |
| Account | Done |
| Role | Done |
| AccountUser (membership) | Done |
| Group | Done |
| Contact (MongoDB) | Done |
| Person (MongoDB) | Done |
| Auth (Cognito) | Done |
| Context endpoint | Done |

**Endpoints:** `/v1/auth`, `/v1/users`, `/v1/accounts`, `/v1/roles`, `/v1/contacts`, `/v1/persons`, `/v1/groups`, `/v1/context`

**Recent:** Response envelope standardization (PR #70), account user sub-endpoints (PR #68), MongoDB error handling (PR #71), group CRUD + membership (PR #66)

---

### turumba_messaging_api — CRUD + Events + Adapters + Workers Done; Pipeline Integration In Progress

| Component | Status |
|-----------|--------|
| Channel CRUD | Done |
| Message CRUD | Done |
| Template CRUD | Done |
| GroupMessage CRUD | Done |
| ScheduledMessage CRUD | Done |
| OutboxEvent model | Done |
| EventBus | Done |
| OutboxMiddleware | Done |
| Outbox Worker | Done |
| Event emission in create flows | In Progress (BE-007) |
| TelegramAdapter | Done |
| Dispatch Worker | Done |
| Group Message Processor | Done |
| Schedule Trigger | Done |
| Inbound Message Worker | Done |
| Status Update Worker | Done |
| Response envelope standardization | Done (PRs #30, #39) |
| Cross-service message enrichment | Active branch |
| Webhook routes (for inbound messages) | Planned (HSM-003) |
| SMS/WhatsApp/Messenger/Email adapters | Planned (HSM-005) |
| Redis rate limiting | Planned (HSM-004) |

**Endpoints:** `/v1/channels`, `/v1/messages`, `/v1/templates`, `/v1/group-messages`, `/v1/scheduled-messages`

**Coverage:** 80% minimum enforced in CI

---

### turumba_gateway — Fully Configured

| Component | Status |
|-----------|--------|
| KrakenD template config | Done |
| Context-enricher Go plugin + LRU cache | Done |
| Account API routes (35 endpoints) | Done |
| Messaging API routes (25 endpoints) | Done |
| Rate limiting + circuit breakers | Done |
| Lua scripts | Done |

**Active PR:** `fix/messaging-api-trailing-slash` — trailing slash fix (pending merge)

---

### turumba_web_core — Auth + Contacts/Groups Done; Messaging Pages Pending

| Feature | Status |
|---------|--------|
| Core Auth (login, register, verify) | Done |
| Extended Auth (forgot/reset/2FA) | UI only |
| Shared UI Library (@repo/ui) | Done |
| Generic DataTable + Pagination | Done |
| Contacts Management | Done |
| Groups Management | Done |
| Delivery Channels pages (FE-002, FE-003) | Not started |
| Messages pages (FE-001, FE-004) | Not started |
| Templates pages (FE-005, FE-006) | Not started |
| Group Messages pages (FE-007, FE-008) | Not started |
| Scheduled Messages pages (FE-009, FE-010) | Not started |

**Note:** All backend APIs for the messaging pages are ready. Frontend work is blocked on the Advanced Table Filter component (web#5) and can proceed in parallel once that's done.

---

### Planned Services

| Service | Status | Description |
|---------|--------|-------------|
| `turumba_realtime` | Architecture designed | Socket.IO + RabbitMQ consumer for real-time push (conversations feature) |

---

*This document reflects the state of all four service repositories as of 2026-02-26.*
*Source documents: service `ARCHITECTURE.md` files, `TURUMBA_MESSAGING.md`, `TURUMBA_DELIVERY_CHANNELS.md`, `HIGH_SCALE_MESSAGING_ARCHITECTURE.md`, `docs/plans/conversations/ARCHITECTURE.md`, `docs/PROJECT_STATUS.md`, service `CLAUDE.md` files, and messaging API `docs/WORKERS.md`.*
