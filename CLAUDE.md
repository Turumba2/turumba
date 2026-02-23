# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Turumba 2.0 is a multi-tenant **message automation platform** built on microservices. It enables organizations to automate communication across SMS, SMPP, Telegram, WhatsApp, Messenger, Email, and other channels — with features like group messaging, scheduled messages, contextualized template messages, and delivery channel management.

Each service is a **separate git repository** within this codebase directory. Each has its own `CLAUDE.md` with service-specific details — consult those when working inside a particular service.

- **turumba_account_api** - FastAPI backend for accounts, users, contacts, groups, and authentication (Python 3.11)
- **turumba_gateway** - KrakenD 2.12.1 API Gateway (single entry point on port 8080)
- **turumba_messaging_api** - FastAPI messaging service (Python 3.12) — channels, messages, templates, group messages, scheduled messages, channel adapter framework, and outbox event infrastructure
- **turumba_web_core** - Turborepo monorepo for Next.js 16 frontend applications

## Documentation

Key platform documentation in `docs/`:
- `WHAT_IS_TURUMBA.md` — High-level platform overview, architecture diagram, technology stack
- `TURUMBA_MESSAGING.md` — Detailed messaging system spec (Messages, Templates, Group Messaging, Scheduled Messages, Event Infrastructure)
- `TURUMBA_DELIVERY_CHANNELS.md` — Delivery channel types, credentials, configuration, lifecycle, API reference
- `HIGH_SCALE_MESSAGING_ARCHITECTURE.md` — Architecture proposal for millions of messages/day, dispatch pipeline design
- `guidelines/API_RESPONSE_STANDARDS.md` — Standard response envelope format for all API endpoints across services

Task specifications organized under `docs/tasks/`:
- `tasks/messaging/` — Backend (BE-001, BE-003–BE-007) and Frontend (FE-001, FE-004–FE-010) tasks for messaging features
- `tasks/delivery-channels/` — Backend (BE-002) and Frontend (FE-002–FE-003) tasks for delivery channels

## Architecture

```
Client → KrakenD Gateway (port 8080)
           ├─→ Account API (gt_turumba_account_api:8000)
           └─→ Messaging API (gt_turumba_messaging_api:8000)
```

The gateway uses Docker container names for internal routing on a shared `gateway-network`. All endpoints are prefixed with `/v1/`. All containers require `platform: linux/amd64` (important for Apple Silicon).

### Gateway Context Enrichment (Critical Pattern)

For every authenticated request, the gateway's context-enricher Go plugin (`plugins/context-enricher/main.go`) intercepts the request, calls `/context/basic` on the Account API, and injects `x-account-ids` and `x-role-ids` as headers. Results are cached in an in-memory LRU cache to reduce calls to the Account API. **These headers are trusted system values** — the gateway strips any user-provided values for these headers before injection. Backend services must never trust these headers from external sources; they are only valid because the gateway controls them.

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
- Controllers are created via FastAPI `Depends()` factory functions — never instantiated manually inside route handlers
- Use `PATCH` for partial updates, not `PUT`. Return the created/updated resource (except DELETE → 204)

### CRUDController Advanced Patterns

The base controller has non-obvious behaviors critical for multi-tenancy:

- **Default filters bypass validation** — Default filters (e.g., `account_id:eq:tenant123`) are "trusted system filters" that skip user-provided filter validation. They enforce tenant isolation and cannot be overridden by user query parameters.
- **Header context injection** — `set_header_context(headers)` extracts `x-account-ids`, `x-role-ids`, `x-advanced-context` from gateway-injected headers. These drive tenant scoping.
- **Filter merge strategy** — Provided filters can override defaults only if they share the same field+operation. Defaults are applied first, then provided filters merge in.
- **Response schema context** — `model_to_response()` accepts a `context` parameter ("single" or "list") that can conditionally include/exclude fields based on whether it's a detail view or list view.

### API Response Envelope Standard

All API endpoints across both services use a standard response envelope (see `docs/guidelines/API_RESPONSE_STANDARDS.md`):

- **Single item** (`SuccessResponse[T]`): `{ "success": true, "data": {...}, "message": null }`
- **List** (`ListResponse[T]`): `{ "success": true, "data": [...], "meta": { "total": N, "skip": 0, "limit": 100 } }`
- **Error** (`ErrorResponse`): `{ "success": false, "error": "not_found", "message": "...", "details": {} }`
- **Delete**: Returns `204 No Content` with no body

Schemas defined in `src/schemas/responses.py` in each API service. Exception handlers in `src/exceptions/handlers.py` (Messaging API) format all errors into the envelope.

### Channel Adapter Framework (Messaging API)

Pluggable interface (`src/adapters/`) for dispatching messages through external providers using the Strategy pattern:

- **Abstract base** (`src/adapters/base.py`): `ChannelAdapter` ABC with `send()`, `verify_credentials()`, `check_health()`, `parse_inbound()`, `parse_status_update()`, `verify_webhook_signature()`
- **Registry** (`src/adapters/registry.py`): Decorator-based — `@register_adapter("telegram")`. Resolves at runtime via `get_adapter(channel_type, provider)`
- **Data types**: `DispatchPayload`, `DispatchResult`, `ChannelHealth`, `InboundMessage`, `StatusUpdate` (dataclasses in `base.py`)
- **Exceptions** (`src/adapters/exceptions.py`): `AdapterError` base with subclasses — `AdapterNotFoundError`, `AdapterConnectionError`, `AdapterAuthError`, `AdapterRateLimitError`, `AdapterPayloadError`
- **Implemented**: `TelegramAdapter` (`src/adapters/telegram/`)

### Event Infrastructure (Messaging API)

Transactional Outbox Pattern for reliable domain event publishing. Events are written to the `outbox_events` table in the same DB transaction as domain data, then published to RabbitMQ by a standalone worker process.

Key modules: `src/events/` (`DomainEvent`, `EventBus`, `EventType`, `OutboxMiddleware`), `src/workers/outbox_worker.py`.

Integration pattern: router injects `EventBus` via `Depends(get_event_bus)` → passes to controller → controller passes to `CreationService` → service emits events, calls `OutboxMiddleware.flush()`, `db.commit()`, and `send_pg_notify()` — all within a single atomic transaction. Events emitted: `message.created`, `group_message.created`, `scheduled_message.created`.

RabbitMQ topology: `messaging` topic exchange → `group_message_processing` and `scheduled_message_processing` queues → `messaging.dlx`/`messaging.dlq` for dead letters.

### Adding a New Domain Entity (Backend)

Follow the eight-step process defined in `ARCHITECTURE.md`:
1. Create model in `src/models/postgres/` or `src/models/mongodb/` (re-export in `__init__.py` for Alembic)
2. Create schemas in `src/schemas/` (Create, Update, Response with `from_attributes = True`)
3. Create service classes in `src/services/<entity>/` (CreationService, RetrievalService, UpdateService)
4. Create controller extending `CRUDController` with `_FILTER_SORT_CONFIG` and `_SCHEMA_CONFIG` class attributes
5. Define `FilterSortConfig` with allowed filters/sorts
6. Define `SchemaConfig` with field permissions and transformations
7. Create router in `src/routers/`
8. Register router in `src/main.py`

### Authentication

AWS Cognito with JWT RS256 validation. Key dependencies in `src/middleware/auth.py`:
- `get_current_user` - Full token payload
- `get_current_user_id` - Just user ID (sub)
- `get_current_user_email` - User email
- `require_role("admin")` - Role-based access control decorator

### Router Factory (Account API)

`create_crud_routes(router, get_controller_dep, config)` in `src/routers/helpers.py` auto-generates standard CRUD endpoints. Every generated handler calls `controller.set_header_context(request.headers)` and `controller.set_current_user(user)` before delegation. Auth routes (`src/routers/auth.py`) are hand-written.

For sub-resource endpoints (e.g., `accounts/{id}/users`, `groups/{id}/persons`), define custom routes **before** calling `create_crud_routes()` so they take precedence over the generated `/{id}` catch-all. These custom routes still call `set_header_context()` and use the response envelope.

### Frontend Architecture (Web Core)

Turborepo monorepo with four apps: `turumba` (port 3600), `negarit` (port 3500), `web` (port 3000), `docs` (port 3001).

Key patterns:
- AWS Amplify + Cognito for frontend auth (email + optional TOTP 2FA)
- API integration via single Axios instance (`lib/api/client.ts`) against KrakenD gateway — request interceptor adds JWT + `account_id` query param from Zustand store
- React Hook Form + Zod for form handling and validation
- UI components built on Radix UI primitives + Tailwind v4 with CVA variants
- `@repo/ui` shared component library with Field composition system and `DataTable`/`DataTablePagination` generics
- Tailwind v4 with oklch color tokens and light/dark theme support
- Path aliases: `@/*` maps to app source root
- Server state: TanStack React Query v5. Client state: Zustand (org store persisted to localStorage). URL state: `nuqs`
- Requires Node.js >= 22 and pnpm 9.0.0

**Feature module pattern** — features live in `features/<name>/` with barrel exports via `index.ts`:
```
features/<name>/
├── components/   # Feature-specific UI
├── services/     # API calls (typed wrappers around Axios client)
├── store/        # Zustand stores (optional)
├── types/        # TypeScript models (optional)
└── index.ts      # Re-exports public API
```
Import from `@/features/<name>`, not from internal paths. Prefer `packages/*` for cross-app shared logic, `apps/<name>/lib/*` for app-specific utilities.

### Gateway Configuration

- Template-based: `config/krakend.tmpl` imports partials via Go templates
- `FC_ENABLE=1` and `FC_PARTIALS` env vars enable file composition in Docker
- Endpoint definitions in `config/partials/endpoints/` (auth, accounts, users, context, channels, messages, templates, group-messages, scheduled-messages, groups, persons, roles)
- Go plugin output: `config/plugins/context-enricher.so` — includes in-memory LRU cache for context responses
- Lua scripts for request/response modification in `config/lua/`
- Uses `no-op` encoding for response passthrough
- Rate limiting and circuit breakers configured per-endpoint for messaging API routes

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
- Both enable `ERA` (eradicate) — **commented-out code will be flagged**; remove dead code instead of commenting it out
- Account API ignores `ARG002` in tests (pytest fixture injection); Messaging API also ignores `ARG002` in tests
- Both ignore `B008` (FastAPI `Depends()` in argument defaults), `PLR0913` (too many args), `PLR2004` (magic values), `TRY003` (long exception messages)
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

**Account API** — PostgreSQL: `users`, `accounts`, `roles`, `account_users` (M:N user-account-role), `account_roles`, `groups`, `group_contacts`. MongoDB: `contacts` (with dynamic properties), `persons`.

**Messaging API** — PostgreSQL: `channels`, `messages`, `templates`, `group_messages`, `scheduled_messages`, `outbox_events`.

### Key Model Conventions

- **Metadata column**: Models use `metadata_` (avoids Python keyword conflict), schemas use `metadata` with `validation_alias="metadata_"`
- **PostgreSQL models** must be re-exported in `src/models/postgres/__init__.py` for Alembic autogenerate to detect them
- **PostgreSQL base model**: `PostgresBaseModel` provides `id` (UUID), `created_at`, `updated_at` automatically — never redefine these
- **MongoDB base model**: `MongoDBBaseModel` provides `id` (PyObjectId aliased to `_id`), `created_at`, `updated_at`. Call `update_timestamp()` before saving updates
- **Service layer pattern**: Three classes per entity — `CreationService`, `RetrievalService`, `UpdateService`. Use `asyncio.to_thread()` for sync SQLAlchemy ops in async context. A fourth service (e.g., `AccountUserService`) may be added for sub-resource membership operations
- **Resolver pattern** (Account API): For cross-table filtering (e.g., filtering users by `account_id` via junction table), define resolvers in `src/resolvers/<entity>/` and wire via `AllowedFilter(..., resolver=fn)`
- **MongoDB tenant scoping**: MongoDB controllers override `set_header_context()` to call `_apply_default_filters()` directly (no retrieval service delegation). For writes, they manually validate `account_id ∈ self.account_ids`
- Architecture changes require updating the service-level `ARCHITECTURE.md` alongside the code
