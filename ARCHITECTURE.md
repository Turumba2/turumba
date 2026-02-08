# Turumba 2.0 Platform - Architecture Document

This document provides a comprehensive technical overview of the Turumba 2.0 platform architecture, including system design, component interactions, data flows, and design patterns.

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Service Components](#3-service-components)
4. [Data Architecture](#4-data-architecture)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [API Gateway Architecture](#6-api-gateway-architecture)
7. [Backend API Architecture](#7-backend-api-architecture)
8. [Event-Driven Architecture](#8-event-driven-architecture)
9. [Frontend Architecture](#9-frontend-architecture)
10. [Communication Patterns](#10-communication-patterns)
11. [Security Architecture](#11-security-architecture)
12. [Deployment Architecture](#12-deployment-architecture)
13. [Design Patterns](#13-design-patterns)

---

## 1. Executive Summary

Turumba 2.0 is a multi-tenant **message automation platform** built on microservices. It enables organizations to automate communication across SMS, SMPP, Telegram, WhatsApp, Messenger, Email, and other channels — with features like group messaging, scheduled messages, contextualized template messages, and delivery channel management.

The platform follows industry best practices including:

- **Microservices Architecture**: Loosely coupled services communicating via HTTP/REST
- **API Gateway Pattern**: Single entry point with context enrichment for all client requests
- **Domain-Driven Design**: Services organized around business domains (accounts, messaging)
- **Event-Driven Architecture**: Transactional Outbox pattern with RabbitMQ for reliable async processing
- **Cloud-Native**: Containerized with Docker, orchestrated via Docker Compose

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| KrakenD API Gateway | High performance, plugin extensibility, template-based configuration |
| FastAPI for Backend | Async support, automatic OpenAPI docs, Pydantic validation |
| AWS Cognito | Managed authentication, JWT tokens, user pool groups for RBAC |
| PostgreSQL + MongoDB | Relational data for core entities, document storage for flexible schemas |
| RabbitMQ | Reliable message broker with topic routing, DLX/DLQ, and management UI |
| Transactional Outbox | Solves dual-write problem — entity + event in same DB transaction |
| Turborepo | Efficient monorepo builds, shared configurations, parallel execution |

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │   Turumba Web   │  │   Negarit Web   │  │   Mobile Apps   │              │
│  │    (Next.js)    │  │    (Next.js)    │  │     (Future)    │              │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│           │                    │                    │                        │
└───────────┼────────────────────┼────────────────────┼────────────────────────┘
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            API GATEWAY LAYER                                 │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     KrakenD API Gateway                              │    │
│  │                        Port: 8080                                    │    │
│  │                                                                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │    │
│  │  │    CORS     │  │   Routing   │  │  Go Plugins │  │Lua Scripts │ │    │
│  │  │   Handler   │  │   Engine    │  │ (Enrichment)│  │ (Modifier) │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SERVICE LAYER                                      │
│                                                                              │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐   │
│  │   Account API        │  │   Messaging API      │  │   Future APIs    │   │
│  │   (FastAPI)          │  │   (FastAPI)          │  │                  │   │
│  │                      │  │                      │  │                  │   │
│  │   • Authentication   │  │   • Messages         │  │   • Payments     │   │
│  │   • User Management  │  │   • Templates        │  │   • Analytics    │   │
│  │   • Account Mgmt     │  │   • Group Messages   │  │   • Reporting    │   │
│  │   • Role Management  │  │   • Scheduled Msgs   │  │                  │   │
│  │   • Contact Mgmt     │  │   • Delivery Channels│  │                  │   │
│  │   • Context Service  │  │   • Event Outbox     │  │                  │   │
│  └──────────┬───────────┘  └──────────┬───────────┘  └──────────────────┘   │
│             │                         │                                      │
└─────────────┼─────────────────────────┼──────────────────────────────────────┘
              │                         │
              ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                        │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │    PostgreSQL    │  │     MongoDB      │  │     AWS Cognito          │   │
│  │                  │  │                  │  │                          │   │
│  │  Account API:    │  │  Account API:    │  │  • User Pool             │   │
│  │  • users         │  │  • contacts      │  │  • Groups (Roles)        │   │
│  │  • accounts      │  │                  │  │  • App Clients           │   │
│  │  • roles         │  │                  │  │                          │   │
│  │  • account_users │  │                  │  └──────────────────────────┘   │
│  │  • account_roles │  │                  │                                  │
│  │                  │  └──────────────────┘  ┌──────────────────────────┐   │
│  │  Messaging API:  │                        │       RabbitMQ           │   │
│  │  • channels      │                        │                          │   │
│  │  • messages      │                        │  • messaging exchange    │   │
│  │  • templates     │                        │  • group_message queue   │   │
│  │  • group_messages│                        │  • scheduled_msg queue   │   │
│  │  • scheduled_msgs│                        │  • dead letter queue     │   │
│  │  • outbox_events │                        │                          │   │
│  └──────────────────┘                        └──────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Network Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     Docker Network: gateway-network               │
│                                                                   │
│   External Access                                                 │
│   ┌─────────────────┐                                            │
│   │ Port 8080       │ ←── Only exposed port                      │
│   └────────┬────────┘                                            │
│            │                                                      │
│            ▼                                                      │
│   ┌─────────────────┐                                            │
│   │ krakend-gateway │                                            │
│   │ (KrakenD)       │                                            │
│   └────────┬────────┘                                            │
│            │                                                      │
│      Internal DNS                                                 │
│   ┌────────┼────────────────────────┐                            │
│   │        │                        │                            │
│   ▼        ▼                        ▼                            │
│ ┌─────────────────────┐  ┌──────────────────────────┐           │
│ │gt_turumba_account_api│  │gt_turumba_messaging_api  │           │
│ │ Internal: 8000      │  │ Internal: 8000           │           │
│ │ External: 5002      │  │ External: 5001           │           │
│ └─────────────────────┘  └──────────┬───────────────┘           │
│                                      │                           │
│                           ┌──────────┼──────────┐               │
│                           ▼                     ▼               │
│                  ┌─────────────────┐   ┌──────────────────┐     │
│                  │   RabbitMQ      │   │  Outbox Worker   │     │
│                  │   Port: 5672    │   │  (Python)        │     │
│                  │   Mgmt: 15672   │   │                  │     │
│                  └─────────────────┘   └──────────────────┘     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Service Components

### 3.1 Service Registry

| Service | Container Name | Internal Port | External Port | Image |
|---------|----------------|---------------|---------------|-------|
| API Gateway | `krakend-gateway` | 8080 | 8080 | `bengeos/turumba-gateway:latest` |
| Account API | `gt_turumba_account_api` | 8000 | 5002 | `bengeos/turumba-account-api:main` |
| Messaging API | `gt_turumba_messaging_api` | 8000 | 5001 | `bengeos/turumba-messaging-api:main` |
| PostgreSQL | `postgres` | 5432 | 5432 | `postgres:15` |
| MongoDB | `mongodb` | 27017 | 27017 | `mongo:6` |
| RabbitMQ | `rabbitmq` | 5672 | 5672 | `rabbitmq:3-management` |
| Outbox Worker | `outbox_worker` | — | — | (Python process) |

### 3.2 Service Responsibilities

#### Account API Service

```
Account API (FastAPI)
├── Controllers
│   ├── AuthController        # Authentication flows
│   ├── UserController        # User CRUD operations
│   ├── AccountController     # Account management
│   └── ContextController     # User context retrieval
│
├── Services
│   ├── CognitoService        # AWS Cognito integration
│   ├── UserCreationService   # User registration logic
│   ├── AccountCreationService # Account setup logic
│   └── ContextService        # Role/account context
│
├── Models
│   ├── PostgreSQL            # Users, Accounts, Roles
│   └── MongoDB               # Contacts, Documents
│
└── Middleware
    └── AuthMiddleware        # JWT validation
```

#### Messaging API Service

```
Messaging API (FastAPI)
├── Controllers
│   ├── ChannelController       # Delivery channel CRUD
│   ├── MessageController       # Message CRUD and status tracking
│   ├── TemplateController      # Template message CRUD
│   ├── GroupMessageController  # Group message CRUD with event emission
│   └── ScheduledMessageController # Scheduled message CRUD with event emission
│
├── Services
│   ├── ChannelService          # Channel verification, credential masking
│   ├── TemplateService         # Variable extraction, rendering
│   └── AutoTemplateService     # Auto-create template from message_body
│
├── Event Infrastructure
│   ├── DomainEvent             # Event dataclass (type, aggregate, payload)
│   ├── EventBus                # Request-scoped in-memory event collector
│   └── OutboxMiddleware        # Flush events to outbox table in same transaction
│
├── Models (PostgreSQL)
│   ├── Channel                 # Delivery channel connections
│   ├── Message                 # Individual message records
│   ├── Template                # Reusable message templates
│   ├── GroupMessage            # Bulk send campaigns
│   ├── ScheduledMessage        # Time-delayed messages
│   └── OutboxEvent             # Transactional outbox for event publishing
│
└── Background Workers
    └── OutboxWorker            # Publishes outbox events to RabbitMQ
```

#### API Gateway Service

```
KrakenD Gateway
├── Configuration
│   ├── krakend.tmpl          # Main template
│   └── partials/             # Endpoint definitions
│       ├── auth.json
│       ├── accounts.json
│       ├── users.json
│       └── context.json
│
├── Plugins
│   └── context-enricher.so   # Request enrichment
│
└── Lua Scripts
    ├── request_enricher.lua
    └── error_passthrough.lua
```

---

## 4. Data Architecture

### 4.1 PostgreSQL Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                           users                                  │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ email           │ VARCHAR(255)      │ UNIQUE, NOT NULL          │
│ phone           │ VARCHAR(20)       │ UNIQUE, nullable          │
│ given_name      │ VARCHAR(100)      │ First name                │
│ family_name     │ VARCHAR(100)      │ Last name                 │
│ cognito_user_id │ VARCHAR(255)      │ UNIQUE, Cognito reference │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
│ updated_at      │ TIMESTAMP         │ Auto-updated              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ account_users (M:N)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          accounts                                │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ name            │ VARCHAR(255)      │ Account name, NOT NULL    │
│ status          │ VARCHAR(50)       │ active, suspended, etc.   │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
│ updated_at      │ TIMESTAMP         │ Auto-updated              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ account_roles (1:N)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                           roles                                  │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ name            │ VARCHAR(100)      │ Role name, NOT NULL       │
│ permissions     │ JSON              │ Permission definitions    │
│ account_id      │ UUID (FK)         │ Reference to accounts     │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
│ updated_at      │ TIMESTAMP         │ Auto-updated              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       account_users                              │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ account_id      │ UUID (FK)         │ Reference to accounts     │
│ user_id         │ UUID (FK)         │ Reference to users        │
│ role_id         │ UUID (FK)         │ Reference to roles        │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Messaging API PostgreSQL Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                         channels                                  │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ account_id      │ UUID              │ Tenant isolation          │
│ name            │ VARCHAR(255)      │ User-defined name         │
│ channel_type    │ VARCHAR(50)       │ sms, smpp, telegram, etc. │
│ status          │ VARCHAR(50)       │ connected, error, etc.    │
│ is_enabled      │ BOOLEAN           │ Active toggle             │
│ credentials     │ JSONB             │ Provider-specific (write-only) │
│ sender_name     │ VARCHAR(255)      │ Display name              │
│ rate_limit      │ INTEGER           │ Max msgs/minute           │
│ priority        │ INTEGER           │ Selection priority        │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
│ updated_at      │ TIMESTAMP         │ Auto-updated              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         messages                                  │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ account_id      │ UUID              │ Tenant isolation          │
│ channel_id      │ UUID (FK)         │ Delivery channel used     │
│ contact_id      │ UUID              │ Recipient or sender       │
│ group_message_id│ UUID (FK)         │ Parent group message      │
│ template_id     │ UUID              │ Template used             │
│ direction       │ VARCHAR(50)       │ outbound, inbound, system │
│ status          │ VARCHAR(50)       │ queued → sent → delivered │
│ delivery_address│ VARCHAR(255)      │ Phone, email, username    │
│ message_body    │ TEXT              │ Rendered content          │
│ metadata        │ JSONB             │ Channel-specific data     │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         templates                                 │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ account_id      │ UUID              │ Tenant isolation          │
│ name            │ VARCHAR(255)      │ Template name             │
│ body            │ TEXT              │ Template with {VARIABLES} │
│ category        │ VARCHAR(100)      │ Organizational category   │
│ variables       │ JSONB             │ Auto-extracted var names  │
│ default_values  │ JSONB             │ Fallback per variable     │
│ fallback_strategy│ VARCHAR(50)      │ keep/use_default/skip     │
│ is_active       │ BOOLEAN           │ Available for use         │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       group_messages                              │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ account_id      │ UUID              │ Tenant isolation          │
│ channel_id      │ UUID (FK)         │ Delivery channel          │
│ template_id     │ UUID (FK)         │ Message template          │
│ status          │ VARCHAR(50)       │ draft → processing → done │
│ contact_group_ids│ JSONB            │ Target group UUIDs        │
│ total_recipients│ INTEGER           │ Total contacts targeted   │
│ sent_count      │ INTEGER           │ Progress tracking         │
│ delivered_count │ INTEGER           │ Progress tracking         │
│ failed_count    │ INTEGER           │ Progress tracking         │
│ custom_values   │ JSONB             │ Template var overrides    │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     scheduled_messages                             │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ account_id      │ UUID              │ Tenant isolation          │
│ channel_id      │ UUID (FK)         │ Delivery channel          │
│ template_id     │ UUID (FK)         │ Message template          │
│ send_type       │ VARCHAR(50)       │ single or group           │
│ status          │ VARCHAR(50)       │ pending, triggered, etc.  │
│ scheduled_at    │ TIMESTAMP         │ First trigger time        │
│ is_recurring    │ BOOLEAN           │ One-time or recurring     │
│ recurrence_rule │ VARCHAR(255)      │ daily, weekly:mon,wed,fri │
│ next_trigger_at │ TIMESTAMP         │ When next trigger is due  │
│ trigger_count   │ INTEGER           │ Times triggered so far    │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       outbox_events                               │
├─────────────────────────────────────────────────────────────────┤
│ id              │ UUID (PK)         │ Primary identifier        │
│ event_type      │ VARCHAR(100)      │ group_message.queued, etc │
│ aggregate_type  │ VARCHAR(100)      │ group_message, etc.       │
│ aggregate_id    │ UUID              │ The entity ID             │
│ payload         │ JSONB             │ Event data envelope       │
│ status          │ VARCHAR(50)       │ pending, published, failed│
│ retry_count     │ INTEGER           │ Publish attempts          │
│ published_at    │ TIMESTAMP         │ When published to broker  │
│ created_at      │ TIMESTAMP         │ Auto-generated            │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 MongoDB Collections

```
Database: turumba_account
├── contacts
│   ├── _id: ObjectId
│   ├── account_id: UUID
│   ├── name: String
│   ├── email: String
│   ├── phone: String
│   ├── metadata: Object
│   ├── created_at: DateTime
│   └── updated_at: DateTime
│
└── audit_logs (future)
    ├── _id: ObjectId
    ├── user_id: UUID
    ├── action: String
    ├── resource: String
    ├── changes: Object
    └── timestamp: DateTime
```

### 4.4 Database Connection Management

```python
# PostgreSQL (Synchronous with SQLAlchemy)
postgres_engine = create_engine(POSTGRES_DATABASE_URL)
PostgresSessionLocal = sessionmaker(bind=postgres_engine)

def get_postgres_db():
    db = PostgresSessionLocal()
    try:
        yield db
    finally:
        db.close()

# MongoDB (Asynchronous with Motor)
mongodb_client = AsyncIOMotorClient(MONGODB_URL)
mongodb_db = mongodb_client[MONGODB_DB_NAME]

async def get_mongodb():
    yield mongodb_db
```

---

## 5. Authentication & Authorization

### 5.1 Authentication Flow

```
┌─────────────┐                                    ┌─────────────┐
│   Client    │                                    │ AWS Cognito │
└──────┬──────┘                                    └──────┬──────┘
       │                                                  │
       │  1. POST /v1/auth/login                         │
       │     {email, password}                           │
       ├─────────────────────────────────────────────────►
       │                                                  │
       │  2. Validate credentials                        │
       │     (Cognito User Pool)                         │
       │◄─────────────────────────────────────────────────
       │                                                  │
       │  3. JWT Tokens (access, id, refresh)            │
       │◄─────────────────────────────────────────────────
       │                                                  │
       │  4. GET /v1/users/me                            │
       │     Authorization: Bearer <access_token>        │
       ├─────────────────────────────────────────────────►
       │                                                  │
       │  5. Validate token signature (RS256)            │
       │     using Cognito JWKS                          │
       │                                                  │
       │  6. Extract claims (sub, email, groups)         │
       │                                                  │
       │  7. Return user data                            │
       │◄─────────────────────────────────────────────────
       │                                                  │
```

### 5.2 JWT Token Structure

**Access Token Claims:**
```json
{
  "sub": "cognito-user-uuid",
  "token_use": "access",
  "scope": "openid profile email",
  "auth_time": 1234567890,
  "iss": "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXX",
  "exp": 1234567890,
  "iat": 1234567890,
  "jti": "jwt-id",
  "client_id": "app-client-id",
  "username": "user@example.com",
  "cognito:groups": ["admin", "user"]
}
```

### 5.3 Authorization Model

```
                    ┌─────────────────┐
                    │   AWS Cognito   │
                    │   User Pool     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  admin   │  │  manager │  │   user   │
        │  Group   │  │  Group   │  │  Group   │
        └──────────┘  └──────────┘  └──────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  JWT Token      │
                    │  cognito:groups │
                    │  ["admin"]      │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  API Endpoint   │
                    │  @require_role  │
                    │  ("admin")      │
                    └─────────────────┘
```

### 5.4 FastAPI Authentication Dependencies

```python
# Full token payload
async def get_current_user(credentials) -> dict:
    # Returns all JWT claims

# User ID only
async def get_current_user_id(current_user) -> str:
    return current_user["sub"]

# Email only
async def get_current_user_email(current_user) -> str:
    return current_user["email"]

# Role-based access
def require_role(required_role: str):
    async def checker(current_user):
        if required_role not in current_user.get("cognito:groups", []):
            raise HTTPException(403, "Access denied")
        return current_user
    return checker
```

---

## 6. API Gateway Architecture

### 6.1 KrakenD Configuration Architecture

```
krakend.tmpl (Main Template)
│
├── Global Settings
│   ├── timeout: 30s
│   ├── cache_ttl: 300s
│   └── output_encoding: json
│
├── Extra Config
│   ├── {{ include "plugin.json" }}      # Plugin configuration
│   ├── {{ include "logging.json" }}     # Logging settings
│   └── {{ include "cors.json" }}        # CORS policy
│
└── Endpoints Array
    ├── {{ include "auth.json" }}        # /v1/auth/*
    ├── {{ include "accounts.json" }}    # /v1/accounts/*
    ├── {{ include "users.json" }}       # /v1/users/*
    └── {{ include "context.json" }}     # /v1/context
```

### 6.2 Request Processing Pipeline

```
Incoming Request
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PRE-PROCESSING                             │
│                                                                  │
│  1. CORS Preflight Check                                        │
│     └─► OPTIONS → Return CORS headers                           │
│                                                                  │
│  2. Route Matching                                               │
│     └─► Match endpoint pattern and method                       │
│                                                                  │
│  3. Header Extraction                                            │
│     └─► Extract Authorization, Content-Type, etc.               │
│                                                                  │
│  4. Plugin Execution (if configured)                            │
│     └─► context-enricher: Fetch user context, inject headers    │
│                                                                  │
│  5. Lua Script Execution (if configured)                        │
│     └─► request_enricher: Add trace IDs, modify headers         │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                       BACKEND PROXY                              │
│                                                                  │
│  • Forward request to backend service                           │
│  • Apply timeout settings                                       │
│  • Handle retries (if configured)                               │
└─────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      POST-PROCESSING                             │
│                                                                  │
│  1. Response Encoding                                            │
│     └─► no-op: Pass through unchanged                           │
│                                                                  │
│  2. Lua Script Execution (if configured)                        │
│     └─► post_proxy: Add response headers                        │
│                                                                  │
│  3. Return to Client                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Context Enrichment Plugin

```
POST /v1/accounts Request
       │
       ▼
┌─────────────────────────────────────────┐
│       context-enricher Plugin           │
│                                         │
│  1. Extract Authorization header        │
│                                         │
│  2. Fetch context from backend:         │
│     GET /context/basic                  │
│     Authorization: Bearer <token>       │
│                                         │
│  3. Parse response:                     │
│     {                                   │
│       "role_ids": ["uuid1", "uuid2"],   │
│       "account_ids": ["uuid3"]          │
│     }                                   │
│                                         │
│  4. Inject headers:                     │
│     x-role-ids: uuid1,uuid2            │
│     x-account-ids: uuid3               │
└─────────────────────────────────────────┘
       │
       ▼
  Backend Request (enriched)
```

---

## 7. Backend API Architecture

### 7.1 Clean Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                         ROUTERS LAYER                            │
│                    (HTTP Request Handlers)                       │
│                                                                  │
│  • Define API endpoints                                          │
│  • Request/Response validation with Pydantic                    │
│  • Dependency injection                                          │
│  • No business logic                                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CONTROLLERS LAYER                           │
│                    (Business Logic Coordination)                 │
│                                                                  │
│  • Orchestrate service calls                                     │
│  • Handle CRUD operations                                        │
│  • Apply filtering, sorting, pagination                         │
│  • Schema transformations                                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SERVICES LAYER                             │
│                    (Domain Business Logic)                       │
│                                                                  │
│  • Complex business rules                                        │
│  • External API integrations (Cognito)                          │
│  • Data transformations                                          │
│  • Validation logic                                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        MODELS LAYER                              │
│                    (Data Access & Persistence)                   │
│                                                                  │
│  • Database models (SQLAlchemy, Motor)                          │
│  • Repository patterns                                           │
│  • Query building                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 Generic CRUD Controller Pattern

```python
CRUDController[T, C, U, R]
│
├── Type Parameters
│   ├── T: ModelType (SQLAlchemy/Motor model)
│   ├── C: CreateSchemaType (Pydantic input)
│   ├── U: UpdateSchemaType (Pydantic input)
│   └── R: ResponseSchemaType (Pydantic output)
│
├── Abstract Methods (implemented by subclasses)
│   ├── create(obj_in: C) -> T
│   ├── get_by_id(id) -> T | None
│   ├── get_all(skip, limit, filters, sort) -> list[T]
│   ├── update(id, obj_in: U) -> T | None
│   ├── delete(id) -> bool
│   └── count(filters) -> int
│
├── Concrete Methods (shared implementation)
│   ├── exists(id) -> bool
│   ├── get_or_create(filters, obj_in) -> (T, bool)
│   ├── bulk_create(objs_in) -> list[T]
│   ├── bulk_delete(ids) -> int
│   └── model_to_response(instance) -> R
│
└── Configuration
    ├── filter_strategy: FilterStrategy
    ├── sort_strategy: SortStrategy
    ├── filter_sort_config: FilterSortConfig
    └── schema_config: SchemaConfig
```

### 7.3 Filtering & Sorting System

```
Query Parameters:
?filter=email:contains:@example.com&filter=created_at:ge:2024-01-01&sort=created_at:desc

                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     QueryParamsExtractor                         │
│                                                                  │
│  Input: ["email:contains:@example.com", "created_at:ge:2024"]   │
│                                                                  │
│  Output:                                                         │
│    filters: [                                                    │
│      FilterCondition(field="email", op=CONTAINS, value="@ex")   │
│      FilterCondition(field="created_at", op=GE, value="2024")   │
│    ]                                                             │
│    sorts: [                                                      │
│      SortCondition(field="created_at", order=DESC)              │
│    ]                                                             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FilterSortConfig                             │
│                                                                  │
│  Validation:                                                     │
│    allowed_filters: [email, created_at, status]                 │
│    allowed_sorts: [email, created_at]                           │
│    strict_mode: True (reject invalid filters)                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FilterStrategy                              │
│                                                                  │
│  PostgresFilterStrategy:                                         │
│    → SQLAlchemy: query.filter(User.email.contains("@ex"))       │
│                                                                  │
│  MongoDBFilterStrategy:                                          │
│    → MongoDB: {"email": {"$regex": "@ex"}}                      │
└─────────────────────────────────────────────────────────────────┘
```

**Supported Filter Operations:**

| Operation | Description | Example |
|-----------|-------------|---------|
| `eq` | Equals | `status:eq:active` |
| `ne` | Not equals | `status:ne:deleted` |
| `lt` / `le` | Less than / Less or equal | `age:lt:30` |
| `gt` / `ge` | Greater than / Greater or equal | `created_at:ge:2024-01-01` |
| `contains` | Case-sensitive contains | `name:contains:John` |
| `icontains` | Case-insensitive contains | `email:icontains:@gmail` |
| `like` / `ilike` | SQL LIKE pattern | `name:like:%son` |
| `in` | Value in list | `status:in:active,pending` |
| `range` | Between two values | `age:range:18,65` |
| `is_null` / `is_not_null` | Null checks | `phone:is_null` |
| `startswith` / `endswith` | String prefix/suffix | `email:endswith:@company.com` |

---

## 8. Event-Driven Architecture

Group messaging and scheduled message delivery are powered by an event-driven architecture that decouples the API layer from background processing. This uses a three-layer pipeline: EventBus → Transactional Outbox → RabbitMQ.

### 8.1 Three-Layer Event Pipeline

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

### 8.2 Why Transactional Outbox

The **dual-write problem** occurs when an application writes to a database AND publishes to a message broker — if either fails, the system is inconsistent. The Transactional Outbox solves this:

| Concern | How It's Handled |
|---------|-----------------|
| **Atomicity** | Entity + outbox event in one DB transaction |
| **No event loss** | Events persist in outbox even if RabbitMQ is down |
| **Separation of concerns** | Controllers emit events without knowing about outbox or RabbitMQ |
| **Idempotency** | Events carry unique IDs — consumers handle at-least-once delivery |
| **Scalability** | Multiple outbox workers with `FOR UPDATE SKIP LOCKED` |

### 8.3 Router Pattern

```python
# Controller → Flush → Commit → Notify
result = await controller.create(data, db, event_bus=event_bus)
await outbox.flush(db, event_bus, user_id=current_user_id)
await db.commit()                          # atomic: entity + outbox events
await pg_notify('outbox_channel')          # wake up worker (fire-and-forget)
```

### 8.4 Event Types

| Event Type | Trigger |
|------------|---------|
| `group_message.created` | GroupMessage created |
| `group_message.queued` | Status → queued |
| `group_message.cancelled` | Status → cancelled |
| `scheduled_message.created` | ScheduledMessage created |
| `scheduled_message.updated` | Schedule config changed |
| `scheduled_message.cancelled` | Status → cancelled |
| `scheduled_message.paused` | Status → paused |
| `scheduled_message.resumed` | Status paused → pending |

### 8.5 RabbitMQ Topology

```
                     ┌──────────────────────┐
                     │  Exchange: messaging  │
                     │  Type: topic          │
                     │  Durable: yes         │
                     └──────────┬───────────┘
                                │
             Routing by event_type pattern
                                │
         ┌──────────────────────┼──────────────────────┐
         │                      │                      │
         ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ group_message    │  │ scheduled_message│  │ messaging_audit  │
│ _processing      │  │ _processing      │  │ (optional)       │
│                  │  │                  │  │                  │
│ Bind: group_     │  │ Bind: scheduled_ │  │ Bind: # (all)    │
│ message.*        │  │ message.*        │  │                  │
└──────────────────┘  └──────────────────┘  └──────────────────┘
         │                      │
         ▼                      ▼
  Group Message          Schedule Trigger
  Processor              Service
```

Dead letter exchange (`messaging.dlx`) and dead letter queue (`messaging.dlq`) handle failed consumer messages for investigation.

### 8.6 Outbox Worker

The outbox worker is a standalone Python process:

1. Listens on `pg_notify('outbox_channel')` for instant wake-up (5-second poll fallback)
2. Reads pending events in batches of 100 using `FOR UPDATE SKIP LOCKED`
3. Publishes each event to the `messaging` exchange with `routing_key = event_type`
4. Marks published events as `published`
5. Retries with exponential backoff (max 10 retries before marking `failed`)
6. Cleans up published events older than 7 days

> For detailed event infrastructure documentation, see [TURUMBA_MESSAGING.md — Section 5: Event Infrastructure](./docs/TURUMBA_MESSAGING.md#5-event-infrastructure).

---

## 9. Frontend Architecture

### 9.1 Turborepo Monorepo Structure

```
turumba_web_core/
├── apps/
│   ├── turumba/              # Main Turumba web application
│   │   ├── app/              # Next.js App Router
│   │   ├── components/       # App-specific components
│   │   ├── lib/              # Utilities
│   │   └── package.json
│   │
│   ├── negarit/              # Negarit web application
│   │   └── (similar structure)
│   │
│   ├── web/                  # Additional web app
│   │   └── (similar structure)
│   │
│   └── docs/                 # Documentation app
│       └── (similar structure)
│
├── packages/
│   ├── ui/                   # Shared component library
│   │   ├── src/
│   │   │   ├── components/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── eslint-config/        # Shared ESLint configs
│   │   ├── base.js
│   │   ├── next.js
│   │   └── react.js
│   │
│   └── typescript-config/    # Shared TypeScript configs
│       ├── base.json
│       ├── nextjs.json
│       └── react.json
│
├── turbo.json                # Turborepo configuration
├── pnpm-workspace.yaml       # Workspace definition
└── package.json              # Root package
```

### 9.2 Tech Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | Next.js (App Router) | 16.1.x |
| UI Library | React | 19.2.x |
| Language | TypeScript | 5.9.2 (strict mode) |
| Styling | Tailwind CSS v4 | oklch color tokens, light/dark themes |
| Build System | Turbo | 2.7.2 |
| Package Manager | pnpm | 9.0.0 |
| Node.js | Required | >=22 |

### 9.3 Authentication (apps/turumba)

AWS Amplify + Cognito with email-based auth and optional TOTP 2FA:
- `components/AmplifyConfig.tsx` — Client-side Amplify setup
- `lib/amplifyUtils.ts` — Server-side auth context
- `lib/proxy.ts` — Middleware redirecting unauthenticated users to `/auth/sign-in`
- Auth routes: `/auth/sign-in`, `/auth/sign-up`, `/auth/verify-email`, `/auth/forgot-password`, `/auth/2fa`

### 9.4 API Integration

- Axios client at `lib/api/client.ts` with `NEXT_PUBLIC_API_URL` as baseURL
- Backend accessed through KrakenD gateway (port 8080), all endpoints prefixed `/v1/`

### 9.5 Key Patterns

- **React Hook Form + Zod** for form handling and validation (`@hookform/resolvers`)
- **UI Components** (`@repo/ui`) built on Radix UI primitives + Tailwind v4 with CVA variants
- **Field composition system**: `<Field>`, `<FieldLabel>`, `<FieldContent>`, `<FieldError>`
- **URL state management** with `nuqs` for shareable/bookmarkable table views
- **Path aliases**: `@/*` maps to app source root
- **`cn()` utility** from `@repo/ui/lib/utils` (clsx + tailwind-merge)

### 9.6 Build Pipeline

```
turbo build
    │
    ├── Dependency Graph Analysis
    │   └── Build packages first, then apps
    │
    ├── Parallel Execution
    │   ├── Build @repo/ui
    │   ├── Build @repo/eslint-config
    │   └── Build @repo/typescript-config
    │       │
    │       ▼
    │   ├── Build apps/turumba
    │   ├── Build apps/negarit
    │   ├── Build apps/web
    │   └── Build apps/docs
    │
    └── Caching
        ├── Local cache: .turbo/
        └── Remote cache: Vercel (optional)
```

---

## 10. Communication Patterns

### 10.1 Synchronous Communication

```
Client → Gateway → Backend Service → Database

Features:
• Request-Response model
• HTTP/REST protocol
• JSON payload format
• Timeout handling (30s default)
• Error propagation
```

### 10.2 Asynchronous Communication (Event-Driven)

```
Messaging API → EventBus → Outbox → RabbitMQ → Consumers

Features:
• Transactional Outbox pattern (no dual-write problem)
• Topic exchange with pattern-based routing
• At-least-once delivery with idempotent consumers
• Dead letter exchange for failed messages
• pg_notify for instant outbox worker wake-up
```

### 10.3 Request Enrichment Pattern

```
┌────────────────────────────────────────────────────────────────┐
│                    POST /v1/accounts                            │
│                                                                 │
│  Original Request:                                              │
│    Headers: { Authorization: Bearer <token> }                   │
│    Body: { name: "ACME Corp" }                                  │
│                                                                 │
│  After Enrichment:                                              │
│    Headers: {                                                   │
│      Authorization: Bearer <token>,                             │
│      x-account-ids: uuid1,uuid2,                               │
│      x-role-ids: role1,role2                                   │
│    }                                                            │
│    Body: { name: "ACME Corp" }                                  │
└────────────────────────────────────────────────────────────────┘
```

### 10.4 Error Handling Pattern

```
Backend Error Response:
{
  "detail": "User with this email already exists",
  "code": "DUPLICATE_EMAIL"
}
        │
        ▼
Gateway Passthrough (no-op encoding):
{
  "detail": "User with this email already exists",
  "code": "DUPLICATE_EMAIL"
}
        │
        ▼
Client Error Handling:
- Parse error response
- Display user-friendly message
- Log for debugging
```

---

## 11. Security Architecture

### 11.1 Security Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                      NETWORK SECURITY                            │
│                                                                  │
│  • Docker network isolation                                      │
│  • Only gateway exposed externally (port 8080)                  │
│  • Internal services communicate via Docker DNS                  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TRANSPORT SECURITY                           │
│                                                                  │
│  • HTTPS termination (at load balancer/CDN)                     │
│  • CORS policy enforcement                                       │
│  • Request size limits                                           │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AUTHENTICATION SECURITY                        │
│                                                                  │
│  • AWS Cognito managed authentication                           │
│  • JWT RS256 signature verification                             │
│  • Token expiration validation                                   │
│  • Audience (aud) claim validation                              │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AUTHORIZATION SECURITY                         │
│                                                                  │
│  • Role-based access control (RBAC)                             │
│  • Cognito Groups for role membership                           │
│  • Endpoint-level permission checks                             │
│  • Field-level permissions in schemas                           │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DATA SECURITY                               │
│                                                                  │
│  • Password hashing (handled by Cognito)                        │
│  • Sensitive fields excluded from responses                     │
│  • Database credentials in environment variables                │
│  • No secrets in Docker images or code                          │
└─────────────────────────────────────────────────────────────────┘
```

### 11.2 CORS Configuration

```json
{
  "allow_origins": ["*"],
  "allow_methods": ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
  "allow_headers": ["Accept-Language", "Authorization", "Content-Type"],
  "expose_headers": [],
  "allow_credentials": false,
  "max_age": "12h"
}
```

---

## 12. Deployment Architecture

### 12.1 CI/CD Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                        GITHUB ACTIONS                            │
│                                                                  │
│  Triggers:                                                       │
│    • Push to main → Development environment                     │
│    • Push to stage → Staging environment                        │
│    • Push to release/* → Production environment                 │
│                                                                  │
│  Jobs:                                                           │
│    1. Build & Test                                               │
│       ├── Lint code (Ruff/ESLint)                               │
│       ├── Run tests (Pytest/Jest)                               │
│       └── Build Docker images                                    │
│                                                                  │
│    2. Push Images                                                │
│       └── Push to Docker Hub                                     │
│          ├── bengeos/turumba-account-api:{tag}                  │
│          ├── bengeos/turumba-gateway:{tag}                      │
│          └── bengeos/turumba-messaging-api:{tag}                │
│                                                                  │
│    3. Deploy                                                     │
│       ├── SSH to deployment server                              │
│       ├── Pull latest code                                       │
│       ├── Pull latest images                                     │
│       └── Restart services                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 Environment Configuration

| Environment | Branch | Directory | Purpose |
|-------------|--------|-----------|---------|
| Development | `main` | `~/Turumba2.0/dev/` | Development testing |
| Staging | `stage` | `~/Turumba2.0/stage/` | Pre-production testing |
| Production | `release/*` | `~/Turumba2.0/prod/` | Live environment |

### 12.3 Container Orchestration

```yaml
# docker-compose.yml structure
services:
  krakend:
    image: bengeos/turumba-gateway:latest
    depends_on:
      - turumba_account_api
      - turumba_messaging_api

  turumba_account_api:
    image: bengeos/turumba-account-api:main
    depends_on:
      - postgres
      - mongodb

  turumba_messaging_api:
    image: bengeos/turumba-messaging-api:main
    depends_on:
      - postgres
      - rabbitmq

  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"

  postgres:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data

  mongodb:
    image: mongo:6
    volumes:
      - mongodb_data:/data/db

networks:
  gateway-network:
    driver: bridge

volumes:
  postgres_data:
  mongodb_data:
```

---

## 13. Design Patterns

### 13.1 Patterns Used

| Pattern | Application | Benefit |
|---------|-------------|---------|
| **API Gateway** | KrakenD routing | Single entry point, cross-cutting concerns |
| **Repository** | Controllers/Services | Data access abstraction |
| **Strategy** | Filter/Sort strategies | Database-agnostic operations |
| **Factory** | Dependency injection | Flexible object creation |
| **Builder** | Filter/Sort builders | Complex object construction |
| **Singleton** | Token validator | Single instance, cached keys |
| **Template Method** | CRUDController | Shared behavior with customization |
| **Decorator** | FastAPI dependencies | Cross-cutting concerns (auth) |
| **Transactional Outbox** | Event publishing | Reliable event delivery without dual-write |
| **Domain Events** | EventBus | Decouple business logic from event persistence |
| **Topic Exchange** | RabbitMQ routing | Pattern-based routing to consumer queues |

### 13.2 Dependency Injection Pattern

```python
# Dependency Provider
async def get_user_controller(
    db: Session = Depends(get_postgres_db)
) -> UserController:
    return UserController(
        db=db,
        filter_strategy=PostgresFilterStrategy(),
        sort_strategy=PostgresSortStrategy(),
    )

# Route Usage
@router.get("/users")
async def list_users(
    controller: UserController = Depends(get_user_controller),
    current_user: dict = Depends(get_current_user)
):
    return await controller.get_all()
```

### 13.3 Strategy Pattern for Database Operations

```python
# Abstract Strategy
class FilterStrategy(ABC):
    @abstractmethod
    def apply(self, query, condition, model):
        pass

# PostgreSQL Implementation
class PostgresFilterStrategy(FilterStrategy):
    def apply(self, query, condition, model):
        field = getattr(model, condition.field)
        if condition.operation == FilterOperation.EQ:
            return query.filter(field == condition.value)
        # ... other operations

# MongoDB Implementation
class MongoDBFilterStrategy(FilterStrategy):
    def apply(self, query, condition, model):
        if condition.operation == FilterOperation.EQ:
            return {condition.field: condition.value}
        # ... other operations
```

---

## Summary

The Turumba 2.0 platform architecture provides:

- **Scalability**: Microservices can scale independently; outbox workers support horizontal scaling
- **Reliability**: Transactional Outbox guarantees zero event loss; DLQ for failed messages
- **Maintainability**: Clean separation of concerns across layers with generic CRUD patterns
- **Security**: Multi-layer security with managed authentication and multi-tenant isolation
- **Flexibility**: Database-agnostic patterns, pluggable components, extensible channel types
- **Developer Experience**: Automated tooling, comprehensive documentation, shared frontend packages

## Related Documentation

- [What is Turumba?](./docs/WHAT_IS_TURUMBA.md) — High-level platform overview
- [Turumba Messaging](./docs/TURUMBA_MESSAGING.md) — Detailed messaging system spec
- [Turumba Delivery Channels](./docs/TURUMBA_DELIVERY_CHANNELS.md) — Delivery channel types, credentials, lifecycle

---

*Document Version: 2.0*
*Last Updated: February 2026*
*Architecture Owner: Turumba2 Organization*
