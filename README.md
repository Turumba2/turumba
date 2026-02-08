# Turumba 2.0 Platform

A modern, production-ready multi-tenant platform built with microservices architecture. The platform provides account management, user authentication, messaging capabilities, and web applications through a unified API gateway.

## Table of Contents

- [Overview](#overview)
- [Repositories](#repositories)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Technology Stack](#technology-stack)
- [Development](#development)
- [Deployment](#deployment)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)

---

## Overview

Turumba 2.0 is a comprehensive platform designed for:

- **Multi-tenant Account Management** - Organizations can manage multiple accounts with role-based access control
- **User Authentication** - Secure JWT-based authentication via AWS Cognito
- **API Gateway** - Single entry point for all backend services with request enrichment
- **Web Applications** - Multiple Next.js frontend applications with shared components

### Key Features

- AWS Cognito JWT authentication with RS256 signature verification
- Role-based access control (RBAC) with Cognito Groups
- Multi-database support (PostgreSQL + MongoDB)
- API Gateway with custom Go plugins for request enrichment
- Turborepo monorepo for frontend applications
- Docker-based development and deployment
- GitHub Actions CI/CD pipelines

---

## Repositories

| Repository | Description | Tech Stack |
|------------|-------------|------------|
| [turumba_account_api](#turumba-account-api) | Account and user management API | FastAPI, PostgreSQL, MongoDB, AWS Cognito |
| [turumba_gateway](#turumba-gateway) | API Gateway | KrakenD 2.12.1, Go plugins, Lua |
| [turumba_messaging_api](#turumba-messaging-api) | Messaging service | FastAPI |
| [turumba_web_core](#turumba-web-core) | Frontend applications | Next.js, Turborepo, TypeScript, React |

---

### Turumba Account API

Production-ready FastAPI-based account management API with comprehensive CRUD operations.

**Features:**
- User registration, authentication, and profile management
- Account creation and management with multi-tenancy support
- Role-based access control
- AWS Cognito JWT token validation
- PostgreSQL for relational data (users, accounts, roles)
- MongoDB for document storage (contacts)
- Database migrations with Alembic
- Comprehensive filtering, sorting, and pagination

**Key Endpoints:**
- `POST /auth/register` - User registration
- `POST /auth/login` - Authentication
- `GET /users/me` - Current user profile
- `GET /users` - List users (paginated, filtered)
- `GET /accounts` - List accounts
- `GET /context/basic` - User context (roles, accounts)

**Documentation:** See [turumba_account_api/README.md](./turumba_account_api/README.md)

---

### Turumba Gateway

KrakenD-based API Gateway serving as the single entry point for all backend services.

**Features:**
- Request routing to backend microservices
- CORS handling
- Authentication header passthrough
- Custom Go plugins for request enrichment
- Lua scripting for request/response modification
- Template-based modular configuration

**API Routes (prefixed with /v1/):**
- `/v1/auth/*` - Authentication endpoints
- `/v1/accounts/*` - Account management
- `/v1/users/*` - User management
- `/v1/context` - User context retrieval

**Documentation:** See [turumba_gateway/README.md](./turumba_gateway/README.md)

---

### Turumba Messaging API

FastAPI-based messaging service (currently a placeholder/skeleton).

**Current Endpoints:**
- `GET /` - Welcome message
- `GET /health` - Health check

**Documentation:** In development

---

### Turumba Web Core

Turborepo monorepo containing multiple Next.js frontend applications and shared packages.

**Applications:**
- `turumba` - Main Turumba web application
- `negarit` - Negarit web application
- `web` - Additional web application
- `docs` - Documentation application

**Shared Packages:**
- `@repo/ui` - Shared React component library
- `@repo/eslint-config` - ESLint configurations
- `@repo/typescript-config` - TypeScript configurations

**Documentation:** See [turumba_web_core/README.md](./turumba_web_core/README.md)

---

## Architecture

```
                                    External Clients
                                          │
                                          ▼
                          ┌───────────────────────────────┐
                          │     KrakenD API Gateway       │
                          │         Port: 8080            │
                          │                               │
                          │  Features:                    │
                          │  • Request/Response Routing   │
                          │  • CORS Handling              │
                          │  • Auth Header Passthrough    │
                          │  • Go Plugins                 │
                          │  • Lua Scripting              │
                          └───────────┬───────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
         ┌──────────────────┐ ┌──────────────┐ ┌──────────────┐
         │  Account API     │ │ Messaging API│ │ Future APIs  │
         │  Port: 8000      │ │ Port: 8000   │ │              │
         │                  │ │              │ │              │
         │  • /auth/*       │ │ • /messaging │ │              │
         │  • /accounts/*   │ │              │ │              │
         │  • /users/*      │ │              │ │              │
         │  • /context/*    │ │              │ │              │
         └────────┬─────────┘ └──────────────┘ └──────────────┘
                  │
      ┌───────────┼───────────┐
      │           │           │
      ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│PostgreSQL│ │ MongoDB  │ │AWS Cognito│
│          │ │          │ │          │
│ Users    │ │ Contacts │ │ Auth     │
│ Accounts │ │ Documents│ │ Users    │
│ Roles    │ │          │ │ Groups   │
└──────────┘ └──────────┘ └──────────┘
```

For detailed architecture documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Python 3.11+ (for Account API local development)
- Node.js 22+ and pnpm (for Web Core)
- AWS Account with Cognito User Pool configured
- Git

### 1. Clone the Repositories

```bash
# If repositories are separate
git clone git@github.com:Turumba2/turumba_account_api.git
git clone git@github.com:Turumba2/turumba_gateway.git
git clone git@github.com:Turumba2/turumba_messaging_api.git
git clone git@github.com:Turumba2/turumba_web_core.git
```

### 2. Configure Environment

Create `.env` files in each repository:

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
COGNITO_CLIENT_ID=your-client-id
AWS_REGION=us-east-1
```

### 3. Start Services with Docker Compose

**Option A: Start Gateway (includes all backend services):**
```bash
cd turumba_gateway
docker-compose up -d
```

**Option B: Start individual services for development:**
```bash
# Account API
cd turumba_account_api
docker-compose up -d

# Web Core
cd turumba_web_core
pnpm install
pnpm dev
```

### 4. Access Services

- **API Gateway:** http://localhost:8080
- **Account API (direct):** http://localhost:8000
- **API Documentation:** http://localhost:8000/docs (Swagger UI)
- **Web Applications:** http://localhost:3000 (default Next.js port)

### 5. Test Authentication

```bash
# Register a user
curl -X POST http://localhost:8080/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "full_name": "John Doe",
    "account_name": "My Account"
  }'

# Login
curl -X POST http://localhost:8080/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'

# Use the token for authenticated requests
curl -X GET http://localhost:8080/v1/context \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Technology Stack

### Backend

| Component | Technology | Version |
|-----------|------------|---------|
| Web Framework | FastAPI | 0.104.1 |
| ASGI Server | Uvicorn | 0.24.0 |
| Language | Python | 3.11+ |
| ORM | SQLAlchemy | 2.0+ |
| Database (Relational) | PostgreSQL | 12+ |
| Database (Document) | MongoDB | 4.4+ |
| Migrations | Alembic | 1.12.1 |
| Authentication | AWS Cognito, PyJWT | 2.8.0 |
| Validation | Pydantic | 2.9.0+ |

### API Gateway

| Component | Technology | Version |
|-----------|------------|---------|
| Gateway | KrakenD | 2.12.1 |
| Plugins | Go | 1.21+ |
| Scripting | Lua | 5.4 |

### Frontend

| Component | Technology | Version |
|-----------|------------|---------|
| Monorepo | Turborepo | 2.7.2 |
| Framework | Next.js | 16.1.x |
| Language | TypeScript | 5.9.x |
| UI Library | React | 19.x |
| Package Manager | pnpm | 9.0.0 |
| Runtime | Node.js | 22+ |

### DevOps

| Component | Technology |
|-----------|------------|
| Containerization | Docker, Docker Compose |
| CI/CD | GitHub Actions |
| Code Quality | Ruff, ESLint, Prettier |
| Testing | Pytest, Jest |

---

## Development

### Code Quality

**Account API:**
```bash
cd turumba_account_api
source .venv/bin/activate
ruff check .          # Linting
ruff format .         # Formatting
pytest                # Testing
pre-commit run --all-files  # All checks
```

**Web Core:**
```bash
cd turumba_web_core
pnpm lint            # Linting
pnpm format          # Formatting
pnpm check-types     # Type checking
```

### Database Migrations

```bash
cd turumba_account_api
source .venv/bin/activate

# Create migration
alembic revision --autogenerate -m "Description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

### Testing

```bash
# Account API
cd turumba_account_api
pytest                    # All tests
pytest --cov=src          # With coverage
pytest -m "not slow"      # Fast tests only

# Web Core
cd turumba_web_core
pnpm test                 # All apps
turbo test --filter=turumba  # Specific app
```

---

## Deployment

### CI/CD Pipelines

All repositories use GitHub Actions for automated deployment:

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

### Manual Deployment

```bash
# On deployment server
cd ~/Turumba2.0/dev/turumba_gateway
git pull
docker-compose down
docker-compose pull
docker-compose up -d
```

---

## API Documentation

### Interactive Documentation

When the Account API is running, access:
- **Swagger UI:** http://localhost:8000/docs
- **ReDoc:** http://localhost:8000/redoc

### Gateway Endpoints

All public API endpoints are available through the gateway at `http://localhost:8080/v1/`:

| Category | Endpoints |
|----------|-----------|
| Authentication | `/v1/auth/login`, `/v1/auth/register`, `/v1/auth/verify-email` |
| Users | `/v1/users`, `/v1/users/{id}`, `/v1/users/me` |
| Accounts | `/v1/accounts`, `/v1/accounts/{id}` |
| Context | `/v1/context` |

### Authentication

Protected endpoints require the `Authorization` header:
```
Authorization: Bearer <access_token>
```

Tokens are obtained from `/v1/auth/login` and are valid for 1 hour.

---

## Contributing

### Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all tests pass
4. Run linting and formatting
5. Submit a pull request

### Code Standards

- Follow PEP 8 for Python code
- Use TypeScript strict mode for frontend
- Write tests for new features
- Document API changes
- Use conventional commits

### Pre-commit Hooks

All repositories use pre-commit hooks for code quality:
```bash
pip install pre-commit
pre-commit install
```

---

## Support

For issues, questions, or contributions:
- Open an issue on the relevant GitHub repository
- Review existing documentation in each repository's `docs/` folder

---

## License

(To be confirmed)
