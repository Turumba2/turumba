# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Turumba 2.0 is a multi-tenant **message automation platform** built on microservices. It enables organizations to automate communication across SMS, SMPP, Telegram, WhatsApp, Messenger, Email, and other channels — with features like group messaging, scheduled messages, contextualized template messages, and delivery channel management.

Each service is a **separate git repository** within this codebase directory:

- **turumba_account_api** - FastAPI backend for accounts, users, contacts, and authentication (Python 3.11)
- **turumba_gateway** - KrakenD 2.12.1 API Gateway (single entry point on port 8080)
- **turumba_messaging_api** - FastAPI messaging service (Python 3.12) — channels, messages, templates, group messages, scheduled messages, and outbox event infrastructure
- **turumba_web_core** - Turborepo monorepo for Next.js 16 frontend applications

## Documentation

Key platform documentation in `docs/`:
- `WHAT_IS_TURUMBA.md` — High-level platform overview, architecture diagram, technology stack
- `TURUMBA_MESSAGING.md` — Detailed messaging system spec (Messages, Templates, Group Messaging, Scheduled Messages, Event Infrastructure)
- `TURUMBA_DELIVERY_CHANNELS.md` — Delivery channel types, credentials, configuration, lifecycle, API reference

Task specifications organized under `docs/tasks/`:
- `tasks/messaging/` — Backend (BE-001, BE-003–BE-006) and Frontend (FE-001, FE-004–FE-010) tasks for messaging features
- `tasks/delivery-channels/` — Backend (BE-002) and Frontend (FE-002–FE-003) tasks for delivery channels

## Architecture

```
Client → KrakenD Gateway (port 8080)
           ├─→ Account API (gt_turumba_account_api:8000)
           └─→ Messaging API (gt_turumba_messaging_api:8000)
```

The gateway uses Docker container names for internal routing on a shared `gateway-network`. All endpoints are prefixed with `/v1/`. All containers require `platform: linux/amd64` (important for Apple Silicon).

### Gateway Context Enrichment (Critical Pattern)

For every authenticated request, the gateway's context-enricher Go plugin (`plugins/context-enricher/main.go`) intercepts the request, calls `/context/basic` on the Account API, and injects `x-account-ids` and `x-role-ids` as headers. **These headers are trusted system values** — the gateway strips any user-provided values for these headers before injection. Backend services must never trust these headers from external sources; they are only valid because the gateway controls them.

Pattern matching in `config/partials/configs/plugin.json`:
- `"POST /v1/accounts"` - Exact method and path
- `"* /v1/accounts/*"` - Any method, single wildcard segment
- `"GET /v1/**"` - Double wildcard matches multiple segments

### Backend Architecture (Account & Messaging APIs)

Clean architecture with four layers:
1. **Routers** (`src/routers/`) - HTTP request handlers
2. **Controllers** (`src/controllers/`) - Business logic coordination, generic CRUD base
3. **Services** (`src/services/`) - Domain logic, external integrations (Cognito)
4. **Models** (`src/models/`) - Data access (postgres/ and mongodb/ subdirectories)

Key patterns:
- Generic `CRUDController` base class (`src/controllers/base.py`) with pluggable filter/sort strategies
- Filter syntax: `?filter=email:contains:@example.com&sort=created_at:desc`
- Filter operations: eq, ne, lt, le, gt, ge, contains, icontains, in, like, range, is_null, startswith, endswith
- Database-agnostic operations via strategy pattern (`src/filters/`, `src/sorters/`)
- All settings via `pydantic-settings` in `src/config/config.py` — no hardcoded config values

### CRUDController Advanced Patterns

The base controller has non-obvious behaviors critical for multi-tenancy:

- **Default filters bypass validation** — Default filters (e.g., `account_id:eq:tenant123`) are "trusted system filters" that skip user-provided filter validation. They enforce tenant isolation and cannot be overridden by user query parameters.
- **Header context injection** — `set_header_context(headers)` extracts `x-account-ids`, `x-role-ids`, `x-advanced-context` from gateway-injected headers. These drive tenant scoping.
- **Filter merge strategy** — Provided filters can override defaults only if they share the same field+operation. Defaults are applied first, then provided filters merge in.
- **Response schema context** — `model_to_response()` accepts a `context` parameter ("single" or "list") that can conditionally include/exclude fields based on whether it's a detail view or list view.

### Adding a New Domain Entity (Backend)

Follow the seven-step process defined in `ARCHITECTURE.md`:
1. Create model in `src/models/postgres/` or `src/models/mongodb/`
2. Create schemas in `src/schemas/`
3. Create controller extending `CRUDController`
4. Define `FilterSortConfig` for validation
5. Define `SchemaConfig` for response transformation
6. Create router in `src/routers/`
7. Register router in `src/main.py`

### Authentication

AWS Cognito with JWT RS256 validation. Key dependencies in `src/middleware/auth.py`:
- `get_current_user` - Full token payload
- `get_current_user_id` - Just user ID (sub)
- `get_current_user_email` - User email
- `require_role("admin")` - Role-based access control decorator

### Frontend Architecture (Web Core)

Turborepo monorepo with four apps: `turumba` (port 3600), `negarit` (port 3500), `web` (port 3000), `docs` (port 3001).

Key patterns:
- AWS Amplify + Cognito for frontend auth (email + optional TOTP 2FA)
- API integration via Axios against KrakenD gateway
- React Hook Form + Zod for form handling and validation
- UI components built on Radix UI primitives + Tailwind v4 with CVA variants
- `@repo/ui` shared component library with Field composition system
- Tailwind v4 with oklch color tokens and light/dark theme support
- Path aliases: `@/*` maps to app source root
- URL state management with `nuqs`
- Requires Node.js >= 22 and pnpm 9.0.0

### Gateway Configuration

- Template-based: `config/krakend.tmpl` imports partials via Go templates
- `FC_ENABLE=1` and `FC_PARTIALS` env vars enable file composition in Docker
- Endpoint definitions in `config/partials/endpoints/` (auth, accounts, users, context, channels, messages, templates, group-messages, scheduled-messages, groups, persons)
- Go plugin output: `config/plugins/context-enricher.so`
- Lua scripts for request/response modification in `config/lua/`
- Uses `no-op` encoding for response passthrough

## Common Commands

### Account API (Python 3.11)

```bash
cd turumba_account_api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run locally
uvicorn src.main:app --reload

# Linting & Formatting
ruff check .                          # Check for issues
ruff check --fix .                    # Auto-fix issues
ruff format .                         # Format code
pre-commit run --all-files            # All pre-commit hooks (includes pytest)

# Testing
pytest                                # All tests
pytest --cov=src                      # With coverage (50% minimum enforced)
pytest -m "not slow"                  # Exclude slow tests
pytest tests/routers/test_auth.py     # Single file
pytest tests/routers/test_auth.py::test_login  # Single test

# Database migrations
alembic revision --autogenerate -m "Description"
alembic upgrade head
alembic downgrade -1
```

### Messaging API (Python 3.12)

```bash
cd turumba_messaging_api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Run locally
uvicorn src.main:app --reload

# Linting & Formatting
ruff check .                          # Check for issues
ruff check --fix .                    # Auto-fix issues
ruff format .                         # Format code
pre-commit run --all-files            # Pre-commit hooks (Ruff only, no pytest)

# Testing
pytest                                # All tests with coverage
pytest -m unit                        # Unit tests only
pytest -m integration                 # Integration tests only
pytest tests/integration/test_messages.py           # Single file
pytest tests/integration/test_messages.py -k create # Single test by keyword
pytest --cov=src --cov-fail-under=80  # With CI coverage gate (80%)

# Database migrations
alembic revision --autogenerate -m "Description"
alembic upgrade head
alembic downgrade -1

# Outbox worker (standalone process, publishes events to RabbitMQ)
python -m src.workers.outbox_worker
```

### Web Core (TypeScript/Next.js)

```bash
cd turumba_web_core
pnpm install

pnpm dev                              # All apps
turbo dev --filter=turumba            # Specific app (turumba, negarit, web, docs)

pnpm build
pnpm lint
pnpm check-types
pnpm format                           # Prettier formatting
```

### Gateway (Docker)

```bash
cd turumba_gateway
docker-compose up -d                  # Start all services
docker-compose down                   # Stop
docker-compose logs -f krakend        # View logs
docker-compose restart krakend        # After config changes

# Build Go plugins (must be linux/amd64 for KrakenD container)
cd plugins && ./build.sh
```

### Full Stack (from gateway)

```bash
cd turumba_gateway
docker-compose up -d
# Gateway: http://localhost:8080
# API Docs (via gateway): http://localhost:8080/v1/docs/account-api
# API Docs (direct): http://localhost:8000/docs (when running locally)
```

## Environment Variables

Copy `.env.example` to `.env` in each service.

**Account API:**
- `DATABASE_URL` - PostgreSQL connection string
- `MONGODB_URL`, `MONGODB_DB_NAME` - MongoDB connection
- `COGNITO_USER_POOL_ID`, `AWS_REGION` - AWS Cognito
- `COGNITO_CLIENT_IDS` - Comma-separated; first is the backend client (has secret)
- `COGNITO_CLIENT_SECRET` - Backend app client secret

**Messaging API:**
- `DATABASE_URL` - PostgreSQL connection string
- `MONGODB_URL`, `MONGODB_DB_NAME` - MongoDB connection
- `RABBITMQ_URL` - RabbitMQ connection string (for outbox event infrastructure)

**Gateway:**
- `ACCOUNT_API_IMAGE`, `MESSAGING_API_IMAGE` - Docker images
- `APP_PORT` (8080), `ACCOUNT_API_PORT` (5002), `MESSAGING_API_PORT` (5001)

## Code Quality

**Python (Both APIs):**
- Ruff for linting/formatting (config: `ruff.toml`, line length: 100)
- Account API ignores `ARG001` in routers (FastAPI path params appear unused); Messaging API ignores `ARG002` in tests (pytest fixture injection)
- Both ignore `B008` (FastAPI `Depends()` in argument defaults)
- Account API: pre-commit runs Ruff + pytest (50% coverage); Messaging API: pre-commit runs Ruff only (80% coverage is CI-only)
- Test markers: `unit`, `integration`, `slow`, `auth`
- `asyncio_mode = auto` in pytest config — required for FastAPI async test support
- **Conventional Commits** required: `feat(scope):`, `fix:`, `refactor:`, etc. Subject line under 72 chars, imperative mood, lowercase
- **Branch prefixes**: `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, `ci/`

**TypeScript (Web Core):**
- ESLint + Prettier
- Shared configs in `packages/eslint-config/` and `packages/typescript-config/`
- Husky pre-commit runs Prettier formatting only (no lint or tests)

## CI/CD

GitHub Actions workflows per service:
- **lint.yml** - Runs on every push/PR (Ruff, formatting, pytest with coverage)
- **docker-build.yml** - Builds Docker images on main/stage/release branches
- Deployment: main→dev, stage→staging, release/*→prod

## Database Models

**Account API** — PostgreSQL models in `src/models/postgres/`:
- `users` - User accounts with Cognito reference
- `accounts` - Multi-tenant accounts
- `roles` - Account-specific roles with JSON permissions
- `account_users` - M:N user-account-role mapping
- `account_roles` - Account-role associations

**Account API** — MongoDB models in `src/models/mongodb/`:
- `contacts` - Contact management with flexible metadata
- `persons` - Person records

**Messaging API** — PostgreSQL models in `src/models/postgres/`:
- `channels` - Delivery channel configuration (SMS, SMPP, Telegram, WhatsApp, etc.)
- `messages` - Individual messages with status tracking
- `templates` - Reusable message templates
- `group_messages` - Bulk messaging to groups
- `scheduled_messages` - Time-delayed message dispatch
- `outbox_events` - Transactional outbox for reliable event publishing to RabbitMQ

### Key Model Conventions

- **Metadata column**: Models use `metadata_` (avoids Python keyword conflict), schemas use `metadata` with `validation_alias="metadata_"`
- **PostgreSQL models** must be re-exported in `src/models/postgres/__init__.py` for Alembic autogenerate to detect them
- **Service layer pattern**: Three classes per entity — `CreationService`, `RetrievalService`, `UpdateService`. Use `asyncio.to_thread()` for sync SQLAlchemy ops in async context
- Architecture changes require updating the service-level `ARCHITECTURE.md` alongside the code
