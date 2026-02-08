# Turumba 2.0 Platform

A multi-tenant **message automation platform** built on microservices. Turumba enables organizations to automate communication with their contacts across multiple instant messaging channels — SMS, SMPP, Telegram, WhatsApp, Messenger, Email, and more.

## Table of Contents

- [Overview](#overview)
- [Repositories](#repositories)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Technology Stack](#technology-stack)
- [Development](#development)
- [Deployment](#deployment)
- [API Documentation](#api-documentation)
- [Documentation](#documentation)
- [Contributing](#contributing)

---

## Overview

Turumba 2.0 gives users powerful messaging tools:

- **Messages** — Send and receive messages across every delivery channel in one place
- **Group Messaging** — Send a single message to an entire contact group at once
- **Scheduled Messages** — Compose messages now and schedule them for delivery at a specific future date and time, with support for recurring schedules
- **Template Messages** — Create message templates with placeholders like `Hi {FIRST_NAME}, your code is {CODE}` that get personalized for each recipient
- **Delivery Channels** — Connect and manage messaging platforms (SMS providers, Telegram bots, WhatsApp Business, SMPP connections, email accounts, etc.)
- **Contacts & Segmentation** — Organize contacts into groups, tag them, and manage custom attributes
- **Multi-Tenant Accounts** — Create accounts, invite team members, define roles with granular permissions

### Key Features

- Multi-channel messaging: SMS, SMPP, Telegram, WhatsApp, Facebook Messenger, Email
- Event-driven architecture with Transactional Outbox pattern and RabbitMQ
- AWS Cognito JWT authentication with RS256 signature verification
- Role-based access control (RBAC) with account-specific permissions
- Multi-database support (PostgreSQL + MongoDB)
- API Gateway with custom Go plugins for context enrichment
- Turborepo monorepo for frontend applications with shared UI components
- Docker-based development and deployment
- GitHub Actions CI/CD pipelines

---

## Repositories

Each service is a **separate git repository** within this codebase directory:

| Repository | Description | Tech Stack |
|------------|-------------|------------|
| [turumba_account_api](#turumba-account-api) | Account, user, and contact management API | FastAPI (Python 3.11), PostgreSQL, MongoDB, AWS Cognito |
| [turumba_gateway](#turumba-gateway) | API Gateway — single entry point | KrakenD 2.12.1, Go plugins, Lua |
| [turumba_messaging_api](#turumba-messaging-api) | Messaging service — channels, messages, templates, group & scheduled messages | FastAPI (Python 3.12), PostgreSQL, RabbitMQ |
| [turumba_web_core](#turumba-web-core) | Frontend applications | Next.js 16, React 19, TypeScript, Turborepo |

---

### Turumba Account API

FastAPI-based service managing identity, access, and contact management — the backbone that every other part of the platform relies on.

**What it handles:**
- User registration, authentication, and profile management (via AWS Cognito)
- Account creation with multi-tenancy support and sub-accounts
- Role-based access control with granular JSON permissions per account
- Contact management with flexible metadata, tags, and custom fields (MongoDB)
- Context endpoint (`/context/basic`) that powers the gateway's request enrichment
- Multi-account membership — a single user can belong to multiple accounts with different roles

**Key Endpoints:**
- `POST /auth/register` — User registration
- `POST /auth/login` — Authentication
- `GET /users/me` — Current user profile
- `GET /users` — List users (paginated, filtered, sorted)
- `GET /accounts` — List accounts
- `GET /contacts` — List contacts (MongoDB)
- `GET /context/basic` — User context (roles, accounts)

**Documentation:** See [turumba_account_api/README.md](./turumba_account_api/README.md) and [turumba_account_api/ARCHITECTURE.md](./turumba_account_api/ARCHITECTURE.md)

---

### Turumba Gateway

KrakenD-based API Gateway serving as the single entry point (port 8080) for all backend services.

**What it handles:**
- Request routing to backend microservices via Docker container names
- Context enrichment — custom Go plugin fetches user context from `/context/basic` and injects `x-account-ids`, `x-role-ids` headers into every authenticated request
- CORS handling, authentication header passthrough
- Lua scripting for request/response modification
- Template-based modular configuration with file composition

**API Routes (prefixed with /v1/):**
- `/v1/auth/*` — Authentication endpoints
- `/v1/accounts/*` — Account management
- `/v1/users/*` — User management
- `/v1/contacts/*` — Contact management
- `/v1/channels/*` — Delivery channel management
- `/v1/messages/*` — Message operations
- `/v1/templates/*` — Template management
- `/v1/group-messages/*` — Group messaging
- `/v1/scheduled-messages/*` — Scheduled messages
- `/v1/context` — User context retrieval

**Documentation:** See [turumba_gateway/README.md](./turumba_gateway/README.md) and [turumba_gateway/ARCHITECTURE.md](./turumba_gateway/ARCHITECTURE.md)

---

### Turumba Messaging API

FastAPI-based service that powers the core messaging capabilities. Currently in **skeleton stage** — base architecture is in place (dual database support, generic CRUD patterns, filter/sort strategies) but domain entities and routers are not yet implemented.

**Planned features (documented, not yet built):**
- **Delivery Channels** — Connect and manage SMS, SMPP, Telegram, WhatsApp, Messenger, and Email channels with encrypted credential storage
- **Messages** — Send, receive, and track messages across channels with full status lifecycle
- **Template Messages** — Reusable templates with `{VARIABLE}` placeholders, auto-extraction, and fallback strategies
- **Group Messaging** — Bulk send to contact groups with progress tracking and auto-template creation
- **Scheduled Messages** — One-time and recurring schedules with timezone support and pause/resume
- **Event Infrastructure** — EventBus + Transactional Outbox + RabbitMQ for reliable async processing

**Documentation:** See [turumba_messaging_api/ARCHITECTURE.md](./turumba_messaging_api/ARCHITECTURE.md)

---

### Turumba Web Core

Turborepo monorepo containing multiple Next.js frontend applications and shared packages.

**Applications:**
- **turumba** (port 3600) — Main dashboard for account management, messaging, and channel configuration
- **negarit** (port 3500) — Streamlined messaging-focused application
- **web** (port 3000) — Reference template app
- **docs** (port 3001) — Documentation app

**Shared Packages:**
- **@repo/ui** — Shared React component library built on Radix UI primitives, styled with Tailwind CSS v4 and CVA variants
- **@repo/eslint-config** — Shared ESLint 9 flat configs
- **@repo/typescript-config** — Shared TypeScript configs (strict mode)

**Documentation:** See [turumba_web_core/ARCHITECTURE.md](./turumba_web_core/ARCHITECTURE.md)

---

## Architecture

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

For detailed architecture documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Python 3.11+ (Account API) / Python 3.12+ (Messaging API)
- Node.js 22+ and pnpm 9 (Web Core)
- AWS Account with Cognito User Pool configured

### 1. Clone the Repositories

```bash
git clone git@github.com:Turumba2/turumba_account_api.git
git clone git@github.com:Turumba2/turumba_gateway.git
git clone git@github.com:Turumba2/turumba_messaging_api.git
git clone git@github.com:Turumba2/turumba_web_core.git
```

### 2. Configure Environment

Copy `.env.example` to `.env` in each repository and fill in the values.

**turumba_gateway/.env:**
```env
APP_PORT=8080
ACCOUNT_API_PORT=5002
MESSAGING_API_PORT=5001
ACCOUNT_API_IMAGE=bengeos/turumba-account-api:main
MESSAGING_API_IMAGE=bengeos/turumba-messaging-api:main
```

**turumba_account_api/.env:**
```env
DATABASE_URL=postgresql://admin:password@localhost:5432/turumba_account
MONGODB_URL=mongodb://admin:password@localhost:27017/turumba_account?authSource=admin
MONGODB_DB_NAME=turumba_account
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_IDS=backend-client-id,web-client-id
COGNITO_CLIENT_SECRET=your-client-secret
AWS_REGION=us-east-1
```

### 3. Start Services

**Full stack via Docker Compose (from gateway):**
```bash
cd turumba_gateway
docker-compose up -d

# Gateway: http://localhost:8080
# API Docs (via gateway): http://localhost:8080/v1/docs/account-api
```

**Individual service development:**
```bash
# Account API
cd turumba_account_api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload    # http://localhost:8000/docs

# Messaging API
cd turumba_messaging_api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload

# Web Core
cd turumba_web_core
pnpm install
pnpm dev                          # All apps
turbo dev --filter=turumba        # Just turumba (port 3600)
```

### 4. Test Authentication

```bash
# Register
curl -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "SecurePass123!", "full_name": "John Doe", "account_name": "My Account"}'

# Login
curl -X POST http://localhost:8080/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "SecurePass123!"}'

# Use the token
curl -X GET http://localhost:8080/v1/context \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

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

## Development

### Account API (Python 3.11)

```bash
cd turumba_account_api
source .venv/bin/activate

ruff check .                          # Lint
ruff format .                         # Format
pytest                                # All tests
pytest --cov=src                      # With coverage (50% minimum)
pytest tests/routers/test_auth.py     # Single file
pre-commit run --all-files            # All pre-commit hooks

alembic revision --autogenerate -m "Description"   # Create migration
alembic upgrade head                               # Apply migrations
```

### Messaging API (Python 3.12)

```bash
cd turumba_messaging_api
source .venv/bin/activate

ruff check . && ruff format .
pytest --cov=src --cov-fail-under=80  # 80% coverage enforced in CI

alembic revision --autogenerate -m "Description"
alembic upgrade head
```

### Web Core (TypeScript/Next.js)

```bash
cd turumba_web_core

pnpm dev                              # All apps
turbo dev --filter=turumba            # Specific app
pnpm build                            # Build all
pnpm lint                             # ESLint (max-warnings=0)
pnpm check-types                      # TypeScript
pnpm format                           # Prettier
```

### Gateway (Docker)

```bash
cd turumba_gateway

docker-compose up -d                  # Start all services
docker-compose logs -f krakend        # View logs
docker-compose restart krakend        # After config changes

cd plugins && ./build.sh              # Build Go plugins (linux/amd64)
```

---

## Deployment

### CI/CD Pipelines

All repositories use GitHub Actions:

| Branch | Environment |
|--------|-------------|
| `main` | Development |
| `stage` | Staging |
| `release/*` | Production |

### Docker Images

Images are automatically built and pushed to Docker Hub:
- `bengeos/turumba-account-api`
- `bengeos/turumba-gateway`
- `bengeos/turumba-messaging-api`

---

## API Documentation

### Interactive Documentation

When running locally, access FastAPI's auto-generated docs:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Gateway Endpoints

All public API endpoints are available through the gateway at `http://localhost:8080/v1/`:

| Category | Endpoints |
|----------|-----------|
| Authentication | `/v1/auth/login`, `/v1/auth/register`, `/v1/auth/verify-email` |
| Users | `/v1/users`, `/v1/users/{id}` |
| Accounts | `/v1/accounts`, `/v1/accounts/{id}` |
| Contacts | `/v1/contacts`, `/v1/contacts/{id}` |
| Channels | `/v1/channels`, `/v1/channels/{id}` |
| Messages | `/v1/messages`, `/v1/messages/{id}` |
| Templates | `/v1/templates`, `/v1/templates/{id}` |
| Group Messages | `/v1/group-messages`, `/v1/group-messages/{id}` |
| Scheduled Messages | `/v1/scheduled-messages`, `/v1/scheduled-messages/{id}` |
| Context | `/v1/context` |

Protected endpoints require `Authorization: Bearer <access_token>`.

---

## Documentation

Detailed platform documentation lives in `docs/`:

| Document | Description |
|----------|-------------|
| [WHAT_IS_TURUMBA.md](./docs/WHAT_IS_TURUMBA.md) | High-level platform overview, architecture diagram, technology stack |
| [TURUMBA_MESSAGING.md](./docs/TURUMBA_MESSAGING.md) | Messaging system spec — messages, templates, group messaging, scheduled messages, event infrastructure |
| [TURUMBA_DELIVERY_CHANNELS.md](./docs/TURUMBA_DELIVERY_CHANNELS.md) | Delivery channel types, credentials, configuration, lifecycle, API reference |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Comprehensive technical architecture document |

### Task Specifications

Task specs for development are organized under `docs/tasks/`:

- **`tasks/messaging/`** — Backend (BE-001, BE-003–BE-006) and Frontend (FE-001, FE-004–FE-010) tasks
- **`tasks/delivery-channels/`** — Backend (BE-002) and Frontend (FE-002–FE-003) tasks

---

## Contributing

### Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass and linting is clean
4. Submit a pull request

### Pre-commit Hooks

All Python repositories use pre-commit hooks:
```bash
pip install pre-commit
pre-commit install
```

Web Core uses Husky for Prettier formatting on staged files.

---

## License

(To be confirmed)
