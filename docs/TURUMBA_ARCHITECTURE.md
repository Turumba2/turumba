# Turumba Architecture Overview

This document provides a reader-friendly overview of the Turumba 2.0 platform architecture — how the services are organized, how they communicate, and the key design decisions that shape the system.

> For the full technical specification with diagrams, schemas, and code examples, see the root [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Table of Contents

1. [Architecture Principles](#1-architecture-principles)
2. [System Architecture](#2-system-architecture)
3. [Service Components](#3-service-components)
4. [API Gateway](#4-api-gateway)
5. [Backend API Architecture](#5-backend-api-architecture)
6. [Data Architecture](#6-data-architecture)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Event-Driven Architecture](#8-event-driven-architecture)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Security Architecture](#10-security-architecture)
11. [Deployment Architecture](#11-deployment-architecture)
12. [Design Patterns](#12-design-patterns)

---

## 1. Architecture Principles

Turumba 2.0 is a multi-tenant **message automation platform** built on microservices. The architecture follows five core principles:

- **Microservices** — Loosely coupled services communicating via HTTP/REST, each deployable independently
- **API Gateway Pattern** — A single entry point (KrakenD) that routes requests, enriches context, and handles cross-cutting concerns
- **Domain-Driven Design** — Services organized around business domains: accounts (identity, access, contacts) and messaging (channels, messages, templates, schedules)
- **Event-Driven Architecture** — Transactional Outbox pattern with RabbitMQ for reliable asynchronous processing of group messages and scheduled sends
- **Cloud-Native** — Containerized with Docker, orchestrated via Docker Compose, deployed through GitHub Actions CI/CD

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| KrakenD API Gateway | High performance, plugin extensibility, template-based configuration |
| FastAPI for Backend | Async support, automatic OpenAPI docs, Pydantic validation |
| AWS Cognito | Managed authentication, JWT tokens, user pool groups for RBAC |
| PostgreSQL + MongoDB | Relational data for core entities, document storage for flexible schemas (contacts) |
| RabbitMQ | Reliable message broker with topic routing, dead letter exchange, and management UI |
| Transactional Outbox | Solves dual-write problem — entity + event saved in same DB transaction |
| Turborepo | Efficient monorepo builds with shared configurations and parallel execution |

---

## 2. System Architecture

The platform is organized in four layers:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│                                                                      │
│   Turumba Web (Next.js)    Negarit Web (Next.js)    Mobile (Future)  │
└───────────────────────────────────┬──────────────────────────────────┘
                                    │ HTTPS
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       API GATEWAY LAYER                               │
│                                                                      │
│   KrakenD Gateway (Port 8080)                                        │
│   CORS | Routing | Go Plugins (Context Enrichment) | Lua Scripts     │
└───────────────────────────────────┬──────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SERVICE LAYER                                  │
│                                                                      │
│   Account API (FastAPI)           Messaging API (FastAPI)            │
│   - Authentication & Users        - Messages & Templates             │
│   - Accounts & Roles              - Group Messages                   │
│   - Contacts (MongoDB)            - Scheduled Messages               │
│   - Context Service               - Delivery Channels                │
│                                   - Event Outbox                     │
└───────────────────────────────────┬──────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                    │
│                                                                      │
│   PostgreSQL          MongoDB       AWS Cognito      RabbitMQ        │
│   (users, accounts,   (contacts)    (User Pool,      (messaging      │
│    roles, channels,                  Groups,          exchange,       │
│    messages, etc.)                   App Clients)     DLX/DLQ)       │
└─────────────────────────────────────────────────────────────────────┘
```

### Network Architecture

All services run within a shared Docker network (`gateway-network`). Only the KrakenD gateway (port 8080) is exposed externally. Internal services communicate via Docker DNS:

| Service | Container Name | Internal Port | External Port |
|---------|----------------|---------------|---------------|
| API Gateway | `krakend-gateway` | 8080 | 8080 |
| Account API | `gt_turumba_account_api` | 8000 | 5002 |
| Messaging API | `gt_turumba_messaging_api` | 8000 | 5001 |
| PostgreSQL | `postgres` | 5432 | 5432 |
| MongoDB | `mongodb` | 27017 | 27017 |
| RabbitMQ | `rabbitmq` | 5672 | 5672 (mgmt: 15672) |
| Outbox Worker | `outbox_worker` | — | — |

---

## 3. Service Components

### Account API

The Account API manages identity, access, and contact management — the backbone that every other service relies on.

**Responsibilities:**
- **Authentication** — User registration, login, email verification, password reset, and 2FA via AWS Cognito
- **User Management** — User profiles, account memberships, and multi-account support
- **Account Management** — Multi-tenant accounts with sub-accounts
- **Roles & Permissions** — Account-specific roles with granular JSON permissions
- **Contact Management** — Contacts stored in MongoDB with flexible metadata, tags, and custom fields
- **Context Service** — The `/context/basic` endpoint that powers the gateway's request enrichment

**Component Tree:**
```
Account API (FastAPI)
├── Controllers: Auth, User, Account, Context
├── Services: Cognito, UserCreation, AccountCreation, Context
├── Models: PostgreSQL (users, accounts, roles) + MongoDB (contacts)
└── Middleware: JWT validation
```

### Messaging API

The Messaging API powers the core messaging capabilities. Currently in **skeleton stage** — the base architecture is in place but domain entities and routers are being built.

**Responsibilities:**
- **Delivery Channels** — Connect and manage SMS, SMPP, Telegram, WhatsApp, Messenger, and Email channels
- **Messages** — Send, receive, and track messages across channels with full status lifecycle
- **Template Messages** — Reusable templates with `{VARIABLE}` placeholders, auto-extraction, and fallback strategies
- **Group Messaging** — Bulk send to contact groups with progress tracking
- **Scheduled Messages** — One-time and recurring schedules with timezone support
- **Event Infrastructure** — EventBus + Transactional Outbox + RabbitMQ for reliable async processing

**Component Tree:**
```
Messaging API (FastAPI)
├── Controllers: Channel, Message, Template, GroupMessage, ScheduledMessage
├── Services: Channel, Template, AutoTemplate
├── Event Infrastructure: DomainEvent, EventBus, OutboxMiddleware
├── Models (PostgreSQL): channels, messages, templates, group_messages,
│                         scheduled_messages, outbox_events
└── Background Workers: OutboxWorker
```

### API Gateway

KrakenD 2.12.1 serves as the single entry point for all client requests.

**Responsibilities:**
- **Request Routing** — Route requests to backend microservices via Docker container names
- **Context Enrichment** — Go plugin fetches user context and injects `x-account-ids`, `x-role-ids` headers
- **CORS Handling** — Cross-origin policy enforcement
- **Request Modification** — Lua scripts for header manipulation and error passthrough
- **Template Configuration** — Modular config with partials for each endpoint group

---

## 4. API Gateway

### Context Enrichment

The gateway's most important feature is **context enrichment** via a custom Go plugin. For every authenticated request:

1. The plugin intercepts the request and extracts the `Authorization` header
2. It calls the Account API's `/context/basic` endpoint with the user's token
3. The context response contains the user's account IDs and role IDs
4. These are injected as `x-account-ids` and `x-role-ids` headers into the downstream request
5. Backend services use these headers for multi-tenant data scoping and permission checks

This ensures every service receives consistent, pre-validated authorization context without independently resolving permissions.

### Request Processing Pipeline

```
Incoming Request
    │
    ▼
Pre-Processing
    1. CORS preflight check
    2. Route matching
    3. Header extraction
    4. Plugin execution (context-enricher)
    5. Lua script execution
    │
    ▼
Backend Proxy → Forward to service, apply timeout (30s), handle retries
    │
    ▼
Post-Processing
    1. Response encoding (no-op passthrough)
    2. Lua post-proxy scripts
    3. Return to client
```

### Configuration Architecture

KrakenD uses a template-based configuration system with file composition:

```
config/
├── krakend.tmpl           # Main template — imports partials via Go templates
├── partials/
│   ├── configs/           # cors.json, logging.json, plugin.json
│   └── endpoints/         # auth.json, accounts.json, users.json, context.json
├── lua/                   # Lua scripts for request/response modification
└── plugins/               # Compiled Go plugins (.so files)
```

Plugin pattern matching supports:
- `"POST /v1/accounts"` — Exact method and path
- `"* /v1/accounts/*"` — Any method, single wildcard segment
- `"GET /v1/**"` — Double wildcard matches multiple path segments

---

## 5. Backend API Architecture

### Clean Architecture Layers

Both the Account API and Messaging API follow a four-layer clean architecture:

```
Routers Layer (HTTP Request Handlers)
    ↓
Controllers Layer (Business Logic Coordination)
    ↓
Services Layer (Domain Business Logic)
    ↓
Models Layer (Data Access & Persistence)
```

| Layer | Responsibility | Rules |
|-------|---------------|-------|
| **Routers** | Define API endpoints, validate requests/responses with Pydantic | No business logic |
| **Controllers** | Orchestrate service calls, apply CRUD operations, filtering, sorting | Uses generic base class |
| **Services** | Complex business rules, external integrations (Cognito), validation | Domain-specific logic |
| **Models** | Database models (SQLAlchemy/Motor), query building | Data access only |

### Generic CRUD Controller

A type-safe abstract base class that provides pluggable filter/sort strategies:

```
CRUDController[T, C, U, R]
    T = ModelType (SQLAlchemy or Motor model)
    C = CreateSchema (Pydantic input)
    U = UpdateSchema (Pydantic input)
    R = ResponseSchema (Pydantic output)

Abstract Methods: create, get_by_id, get_all, update, delete, count
Concrete Methods: exists, get_or_create, bulk_create, bulk_delete, model_to_response

Configuration:
    filter_strategy: FilterStrategy (Postgres or MongoDB)
    sort_strategy: SortStrategy
    filter_sort_config: FilterSortConfig (allowed fields, strict mode)
    schema_config: SchemaConfig (response transformation)
```

### Filtering & Sorting System

Database-agnostic filtering and sorting via the Strategy pattern. Query parameters are parsed, validated, and applied through the appropriate strategy.

**Syntax:** `?filter=email:contains:@example.com&filter=created_at:ge:2024-01-01&sort=created_at:desc`

**Supported Operations:**

| Operation | Description | Example |
|-----------|-------------|---------|
| `eq` / `ne` | Equals / Not equals | `status:eq:active` |
| `lt` / `le` / `gt` / `ge` | Comparison | `created_at:ge:2024-01-01` |
| `contains` / `icontains` | Substring match (case-sensitive/insensitive) | `email:icontains:@gmail` |
| `like` / `ilike` | SQL LIKE pattern | `name:like:%son` |
| `in` | Value in list | `status:in:active,pending` |
| `range` | Between two values | `age:range:18,65` |
| `is_null` / `is_not_null` | Null checks | `phone:is_null` |
| `startswith` / `endswith` | String prefix/suffix | `email:endswith:@company.com` |

---

## 6. Data Architecture

### Account API Databases

**PostgreSQL:**

| Table | Key Columns | Purpose |
|-------|------------|---------|
| `users` | id, email, phone, given_name, family_name, cognito_user_id | User accounts with Cognito reference |
| `accounts` | id, name, status | Multi-tenant organization accounts |
| `roles` | id, name, permissions (JSON), account_id | Account-specific roles |
| `account_users` | id, account_id, user_id, role_id | M:N user-account-role mapping |

**MongoDB:**

| Collection | Key Fields | Purpose |
|------------|-----------|---------|
| `contacts` | _id, account_id, name, email, phone, metadata | Contacts with flexible metadata |

### Messaging API Database (PostgreSQL)

| Table | Key Columns | Purpose |
|-------|------------|---------|
| `channels` | id, account_id, name, channel_type, status, credentials (JSONB), rate_limit | Delivery channel connections |
| `messages` | id, account_id, channel_id, contact_id, direction, status, message_body | Individual message records |
| `templates` | id, account_id, name, body, variables (JSONB), fallback_strategy | Reusable message templates |
| `group_messages` | id, account_id, channel_id, template_id, status, contact_group_ids, sent/delivered/failed counts | Bulk send campaigns |
| `scheduled_messages` | id, account_id, channel_id, template_id, scheduled_at, is_recurring, recurrence_rule | Time-delayed messages |
| `outbox_events` | id, event_type, aggregate_type, aggregate_id, payload (JSONB), status, retry_count | Transactional outbox for event publishing |

---

## 7. Authentication & Authorization

### Authentication Flow

1. **Login** — Client sends `POST /v1/auth/login` with email and password
2. **Cognito Validation** — Credentials validated against the AWS Cognito User Pool
3. **JWT Tokens** — Cognito returns access, ID, and refresh tokens
4. **Authenticated Requests** — Client includes `Authorization: Bearer <access_token>` on all subsequent requests
5. **Token Verification** — Backend validates the RS256 signature using Cognito's JWKS public keys
6. **Claims Extraction** — `sub` (user ID), `email`, and `cognito:groups` (roles) are extracted from the token

### Authorization Model

- **Cognito Groups** map to application roles (admin, manager, user)
- **JWT tokens** carry the user's group membership in the `cognito:groups` claim
- **API endpoints** use `require_role("admin")` decorators to enforce access
- **Account-level permissions** are stored as JSON in the `roles` table and enforced at the service layer
- **Context enrichment** via the gateway ensures multi-tenant isolation — services receive `x-account-ids` and `x-role-ids` headers on every request

### FastAPI Authentication Dependencies

| Dependency | Returns |
|-----------|---------|
| `get_current_user` | Full JWT token payload (all claims) |
| `get_current_user_id` | User ID (`sub` claim) |
| `get_current_user_email` | User email |
| `require_role("admin")` | Decorated endpoint requiring specific role |

---

## 8. Event-Driven Architecture

Group messaging and scheduled message delivery are powered by an event-driven architecture that decouples the API layer from background processing.

### Three-Layer Event Pipeline

```
Layer 1: EventBus (in-memory, request-scoped)
    Controllers emit domain events during business logic.
    Events are collected in memory — nothing is persisted yet.
         │
         ▼
Layer 2: Transactional Outbox (PostgreSQL)
    OutboxMiddleware flushes events from the EventBus to the
    outbox_events table in the SAME DB transaction as the entity.
    Guarantees atomicity — entity + events succeed or fail together.
         │
         ▼
Layer 3: Outbox Worker → RabbitMQ
    A separate background process polls the outbox table and
    publishes pending events to RabbitMQ. Events are routed
    to processing queues by type.
         │
         ▼
    Consumers (Group Message Processor, Schedule Trigger, etc.)
```

### Why Transactional Outbox?

The **dual-write problem** occurs when an application writes to a database AND publishes to a message broker — if either fails, the system is inconsistent. The Transactional Outbox solves this:

| Concern | How It's Handled |
|---------|-----------------|
| **Atomicity** | Entity + outbox event saved in one DB transaction |
| **No event loss** | Events persist in outbox even if RabbitMQ is down |
| **Separation of concerns** | Controllers emit events without knowing about outbox or RabbitMQ |
| **Idempotency** | Events carry unique IDs — consumers handle at-least-once delivery |
| **Scalability** | Multiple outbox workers with `FOR UPDATE SKIP LOCKED` |

### Router Pattern

The pattern used in every router that emits events:

```
result = controller.create(data, db, event_bus)     # business logic, events collected in memory
outbox.flush(db, event_bus, user_id)                 # flush events to outbox_events table
db.commit()                                          # atomic: entity + outbox events committed together
pg_notify('outbox_channel')                          # wake up outbox worker (fire-and-forget)
```

### Event Types

| Event Type | Trigger |
|------------|---------|
| `group_message.created` | GroupMessage created |
| `group_message.queued` | Status changed to queued |
| `group_message.cancelled` | Status changed to cancelled |
| `scheduled_message.created` | ScheduledMessage created |
| `scheduled_message.updated` | Schedule configuration changed |
| `scheduled_message.cancelled` | Status changed to cancelled |
| `scheduled_message.paused` | Status changed to paused |
| `scheduled_message.resumed` | Status changed from paused to pending |

### RabbitMQ Topology

```
                Exchange: messaging (topic, durable)
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
  group_message      scheduled_message   messaging_audit
  _processing        _processing         (optional)
  Bind: group_       Bind: scheduled_    Bind: # (all)
  message.*          message.*

  Dead letter exchange (messaging.dlx) → dead letter queue (messaging.dlq)
```

### Outbox Worker

The outbox worker is a standalone Python process that:

1. Listens on `pg_notify('outbox_channel')` for instant wake-up (5-second poll fallback)
2. Reads pending events in batches of 100 using `FOR UPDATE SKIP LOCKED`
3. Publishes each event to the `messaging` exchange with `routing_key = event_type`
4. Marks published events as `published`
5. Retries with exponential backoff (max 10 retries before marking `failed`)
6. Cleans up published events older than 7 days

> For detailed event infrastructure documentation, see [TURUMBA_MESSAGING.md — Section 5: Event Infrastructure](./TURUMBA_MESSAGING.md#5-event-infrastructure).

---

## 9. Frontend Architecture

### Turborepo Monorepo

The frontend is a Turborepo monorepo (`turumba_web_core`) containing multiple Next.js 16 applications and shared packages:

**Applications:**
- **turumba** (port 3600) — Main dashboard for account management, messaging, and channel configuration
- **negarit** (port 3500) — Streamlined messaging-focused application
- **web** (port 3000) — Reference template app
- **docs** (port 3001) — Documentation app

**Shared Packages:**
- **@repo/ui** — React component library built on Radix UI primitives, styled with Tailwind CSS v4 and CVA variants
- **@repo/eslint-config** — Shared ESLint 9 flat configs (base, next-js, react-internal)
- **@repo/typescript-config** — Shared TypeScript configs (strict mode)

### Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 16 (App Router) |
| UI Library | React 19 |
| Language | TypeScript 5.9 (strict mode, `noUncheckedIndexedAccess`) |
| Styling | Tailwind CSS v4 with oklch color tokens, light/dark themes |
| Build System | Turbo 2.7.2, pnpm 9 |
| Node.js | >=22 |

### Authentication (Turumba App)

AWS Amplify + Cognito with email-based auth and optional TOTP 2FA:

- `components/AmplifyConfig.tsx` — Client-side Amplify setup
- `lib/amplifyUtils.ts` — Server-side auth context
- `lib/proxy.ts` — Middleware redirecting unauthenticated users to `/auth/sign-in`
- Auth routes: `/auth/sign-in`, `/auth/sign-up`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/2fa`

### Key Frontend Patterns

- **React Hook Form + Zod** — Form handling and validation with `@hookform/resolvers`
- **Field Composition** — `<Field>`, `<FieldLabel>`, `<FieldContent>`, `<FieldError>`, `<FieldGroup>`
- **URL State** — `nuqs` library for shareable/bookmarkable query parameters
- **`cn()` Utility** — `clsx + tailwind-merge` for conditional class names
- **Path Aliases** — `@/*` maps to app source root

### Build Pipeline

```
turbo build
    ├── Dependency graph analysis — build packages first, then apps
    ├── Parallel: @repo/ui, @repo/eslint-config, @repo/typescript-config
    │       ↓
    ├── Then parallel: turumba, negarit, web, docs
    └── Caching: local (.turbo/) + remote (Vercel, optional)
```

---

## 10. Security Architecture

Security is enforced across five layers:

| Layer | Mechanisms |
|-------|-----------|
| **Network** | Docker network isolation, only gateway exposed (port 8080), internal DNS |
| **Transport** | HTTPS termination at load balancer/CDN, CORS policy, request size limits |
| **Authentication** | AWS Cognito managed auth, JWT RS256 verification, token expiration |
| **Authorization** | RBAC via Cognito groups, endpoint-level `require_role()`, account-scoped permissions |
| **Data** | Password hashing (Cognito), sensitive fields excluded from responses, env-based secrets |

### CORS Configuration

```json
{
  "allow_origins": ["*"],
  "allow_methods": ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  "allow_headers": ["Accept-Language", "Authorization", "Content-Type"],
  "max_age": "12h"
}
```

---

## 11. Deployment Architecture

### CI/CD Pipeline

All repositories use GitHub Actions with branch-based deployment:

| Branch | Environment | Purpose |
|--------|-------------|---------|
| `main` | Development | Development testing |
| `stage` | Staging | Pre-production testing |
| `release/*` | Production | Live environment |

**Pipeline Steps:**
1. **Build & Test** — Lint (Ruff/ESLint), run tests (Pytest), build Docker images
2. **Push Images** — Push to Docker Hub (`bengeos/turumba-account-api`, `bengeos/turumba-gateway`, `bengeos/turumba-messaging-api`)
3. **Deploy** — SSH to server, pull latest code and images, restart services

### Container Orchestration

All services run via Docker Compose with the following dependency chain:

```
krakend (gateway)
    ├── depends_on: turumba_account_api
    └── depends_on: turumba_messaging_api

turumba_account_api
    ├── depends_on: postgres
    └── depends_on: mongodb

turumba_messaging_api
    ├── depends_on: postgres
    └── depends_on: rabbitmq
```

Persistent volumes: `postgres_data`, `mongodb_data`

---

## 12. Design Patterns

| Pattern | Application | Benefit |
|---------|-------------|---------|
| **API Gateway** | KrakenD routing | Single entry point, cross-cutting concerns |
| **Repository** | Controllers/Services | Data access abstraction |
| **Strategy** | Filter/Sort strategies | Database-agnostic operations |
| **Factory** | Dependency injection | Flexible object creation |
| **Template Method** | CRUDController | Shared behavior with customization points |
| **Decorator** | FastAPI dependencies | Cross-cutting concerns (auth, validation) |
| **Singleton** | Token validator | Single instance with cached JWKS keys |
| **Transactional Outbox** | Event publishing | Reliable delivery without dual-write problem |
| **Domain Events** | EventBus | Decouple business logic from event persistence |
| **Topic Exchange** | RabbitMQ routing | Pattern-based routing to consumer queues |

---

## Summary

The Turumba 2.0 architecture delivers:

- **Scalability** — Microservices scale independently; outbox workers support horizontal scaling
- **Reliability** — Transactional Outbox guarantees zero event loss; DLQ for failed messages
- **Maintainability** — Clean separation of concerns with generic CRUD patterns
- **Security** — Multi-layer security with managed authentication and multi-tenant isolation
- **Flexibility** — Database-agnostic patterns, pluggable components, extensible channel types
- **Developer Experience** — Automated tooling, shared frontend packages, comprehensive documentation

---

## Related Documentation

- [What is Turumba?](./WHAT_IS_TURUMBA.md) — High-level platform overview and feature list
- [Turumba Messaging](./TURUMBA_MESSAGING.md) — Detailed messaging system spec
- [Turumba Delivery Channels](./TURUMBA_DELIVERY_CHANNELS.md) — Delivery channel types, credentials, and lifecycle
- [Full Architecture Spec](../ARCHITECTURE.md) — Complete technical architecture with diagrams and code examples

---

*Document Version: 1.0*
*Last Updated: February 2026*
*Architecture Owner: Turumba2 Organization*
