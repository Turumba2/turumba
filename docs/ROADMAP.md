# Turumba 2.0 — Roadmap & Sprint Plan

> **Last updated:** 2026-02-08
> **Planning horizon:** 12 weeks (6 × 2-week sprints)
> **Team assumption:** 3–4 developers (2 backend, 1–2 frontend)

---

## 1. Platform Vision

Turumba 2.0 is a multi-tenant SaaS platform that unifies **CRM**, **Customer Support / Helpdesk**, and **Messaging** into a single product. Organizations create accounts, invite team members with role-based permissions, manage contacts and conversations, and communicate with customers across email, SMS, and in-app channels — all behind a single API gateway and a modern Next.js dashboard.

---

## 2. Current State Summary

| Repository | Maturity | What Exists | Key Gaps |
|---|---|---|---|
| **turumba_account_api** | Production-ready | Full CRUD for Users, Accounts, Roles, Contacts, Persons; Cognito JWT auth; generic CRUDController with filter/sort; 26 service classes; Alembic migrations; 50%+ test coverage | Password reset flow, 2FA/MFA, invitation system, audit logging, account-level settings |
| **turumba_gateway** | Production-ready | 25 endpoints across auth/accounts/users/persons/groups/context; context-enricher Go plugin; Docker Compose orchestration; CI/CD pipeline | CORS too permissive (`*`), no rate limiting, Lua scripts available but not activated, no messaging endpoints routed, DEBUG logging in prod |
| **turumba_messaging_api** | Skeleton only | CRUDController base, filter/sort strategies, database config, test infrastructure, Alembic setup | Zero domain models, zero routers, zero services, zero middleware, zero migrations, zero tests |
| **turumba_web_core** | Scaffold only | Turborepo monorepo with 4 apps (turumba, negarit, web, docs); ESLint/Prettier/TypeScript configs; 3 placeholder UI components | Zero auth pages, zero dashboard UI, zero API integration, no UI library, no state management, no navigation |

---

## 3. Per-Repository Feature Plans

### 3.1 turumba_account_api

#### Authentication & Authorization

- [x] User registration (email + password via Cognito)
- [x] Email verification & resend verification
- [x] Login with JWT RS256 token
- [x] Token validation middleware (`get_current_user`, `get_current_user_id`, `get_current_user_email`)
- [x] Role-based access control (`require_role()` decorator)
- [ ] Password reset / forgot password flow
- [ ] Change password (authenticated)
- [ ] Multi-factor authentication (MFA/2FA via Cognito)
- [ ] Refresh token rotation
- [ ] Account invitation system (invite users by email)
- [ ] Social login support (Google OAuth via Cognito)
- [ ] Session management (list active sessions, revoke)

#### CRUD & Domain Logic

- [x] Accounts — full CRUD with filtering, sorting, pagination
- [x] Users — full CRUD with field-level permissions
- [x] Roles — full CRUD with JSON permissions
- [x] Account-Users — M:N association management
- [x] Contacts (MongoDB) — full CRUD with duplicate prevention
- [x] Persons (MongoDB) — full CRUD
- [x] Context endpoint (`/context/basic`) for gateway enrichment
- [ ] Account settings / preferences model
- [ ] Audit log (track who changed what, when)
- [ ] Soft-delete support for Accounts and Users
- [ ] Bulk operations (batch create/update/delete contacts)
- [ ] Contact import (CSV upload) & export
- [ ] Contact tags and custom fields
- [ ] Contact segments / saved filters

#### Infrastructure

- [x] Alembic migrations (initial schema)
- [x] Pydantic-settings configuration
- [x] Ruff linting + formatting
- [x] Pre-commit hooks
- [x] Pytest with 50% coverage enforcement
- [x] CI/CD via GitHub Actions (lint + Docker build)
- [ ] Structured logging (JSON format for log aggregation)
- [ ] Request ID correlation across services
- [ ] Database connection pooling tuning
- [ ] API versioning strategy
- [ ] OpenAPI schema export for gateway consumption

### 3.2 turumba_gateway

#### Routing

- [x] Auth endpoints (login, register, verify-email, resend-verification)
- [x] Account CRUD endpoints
- [x] User CRUD endpoints
- [x] Person CRUD endpoints
- [x] Group CRUD endpoints
- [x] Context endpoint
- [ ] Messaging API endpoints (conversations, messages, channels)
- [ ] File upload proxy endpoint
- [ ] WebSocket proxy for real-time messaging
- [ ] Account API docs passthrough (`/v1/docs/account-api`)
- [ ] Messaging API docs passthrough (`/v1/docs/messaging-api`)

#### Security & DevOps

- [x] CORS configuration (needs tightening)
- [x] Authorization header passthrough
- [x] Context-enricher plugin (injects x-account-ids, x-role-ids)
- [x] Docker Compose with 3-service orchestration
- [x] CI/CD for Docker image builds
- [ ] Restrict CORS to specific origins
- [ ] Rate limiting (global + per-endpoint)
- [ ] Request body size limits
- [ ] Activate Lua error-passthrough script
- [ ] Activate request-enricher Lua script (X-Trace-ID, X-Request-Time)
- [ ] Switch logging from DEBUG to INFO/WARN
- [ ] Health check endpoint for load balancer
- [ ] Circuit breaker for backend services
- [ ] Response caching strategy (short TTL for lists)

### 3.3 turumba_messaging_api

> **Note:** This service reuses the Account API architecture — CRUDController, filter/sort strategies, auth middleware patterns. No new architectural patterns needed.

#### Domain Models (PostgreSQL)

- [ ] **Channels** — communication channels (email, SMS, in-app, webhook)
- [ ] **Conversations** — threads tied to account + contact + channel
- [ ] **Messages** — individual messages within a conversation (inbound/outbound, sender, body, metadata)
- [ ] **Templates** — reusable message templates with variable interpolation
- [ ] **Canned Responses** — quick reply snippets for support agents
- [ ] **Tags** — conversation/contact tagging for organization
- [ ] **Automation Rules** — trigger-action rules (e.g., auto-assign, auto-tag)

#### Domain Models (MongoDB)

- [ ] **Message Attachments** — file metadata and references
- [ ] **Conversation Metadata** — flexible custom fields per conversation
- [ ] **Activity Log** — per-conversation event timeline

#### Services & Business Logic

- [ ] Conversation lifecycle (open → assigned → pending → resolved → closed)
- [ ] Message sending pipeline (validate → enqueue → deliver → confirm)
- [ ] Agent assignment logic (round-robin, manual, load-based)
- [ ] SLA tracking (first-response time, resolution time)
- [ ] Notification dispatch (in-app, email digest)
- [ ] Template rendering with variable substitution
- [ ] Conversation merging and splitting

#### API Endpoints

- [ ] `POST/GET/PUT/DELETE /v1/conversations` — full CRUD with filtering
- [ ] `POST/GET /v1/conversations/{id}/messages` — messages within conversation
- [ ] `POST/GET/PUT/DELETE /v1/channels` — channel management
- [ ] `POST/GET/PUT/DELETE /v1/templates` — template CRUD
- [ ] `POST/GET/PUT/DELETE /v1/canned-responses` — canned response CRUD
- [ ] `POST/GET/PUT/DELETE /v1/tags` — tag CRUD
- [ ] `GET /v1/conversations/{id}/activity` — activity timeline
- [ ] `POST /v1/conversations/{id}/assign` — agent assignment
- [ ] `POST /v1/conversations/{id}/status` — status transitions
- [ ] `GET /v1/inbox` — agent inbox (assigned + unassigned conversations)

#### Infrastructure

- [ ] Auth middleware (port from Account API — Cognito JWT validation)
- [ ] Alembic initial migration
- [ ] Database connection setup (PostgreSQL + MongoDB)
- [ ] Health check and readiness endpoints
- [ ] Test suite (80% coverage target per CI config)
- [ ] WebSocket support for real-time message delivery
- [ ] Background task queue (Celery or ARQ) for async operations
- [ ] File storage integration (S3) for attachments

### 3.4 turumba_web_core

#### Foundation

- [ ] Install and configure AWS Amplify for Cognito auth
- [ ] Install UI component library (shadcn/ui or equivalent)
- [ ] Install state management (Zustand)
- [ ] Create API client utility with auth header injection
- [ ] Create shared layout components (Sidebar, Header, Breadcrumbs)
- [ ] Configure environment variables for API base URL
- [ ] Set up form validation (react-hook-form + zod)

#### Authentication Pages (turumba app)

- [ ] Sign Up page with email/password
- [ ] Email verification page (code entry)
- [ ] Sign In page
- [ ] Forgot password page
- [ ] Reset password page
- [ ] Social login (Google) button
- [ ] Auth context provider with token management
- [ ] Protected route wrapper (redirect unauthenticated users)
- [ ] Auth state persistence (refresh on page reload)

#### Dashboard

- [ ] Dashboard layout (sidebar + header + content area)
- [ ] Account switcher (multi-tenant — user may belong to multiple accounts)
- [ ] Overview page (key metrics: open conversations, contacts, team members)
- [ ] Quick actions (new conversation, add contact)

#### CRM / Contacts

- [ ] Contact list page with search, filter, sort, pagination
- [ ] Contact detail page (info, activity timeline, conversations)
- [ ] Create / edit contact form
- [ ] Contact tags management
- [ ] Contact import (CSV upload)
- [ ] Contact export (CSV download)
- [ ] Contact segments (saved filter views)

#### Inbox / Helpdesk

- [ ] Inbox page — split view (conversation list + message thread)
- [ ] Conversation list with status filters (open, pending, resolved, closed)
- [ ] Message thread view with timestamps, sender info
- [ ] Message composer (text input, attachments, canned responses)
- [ ] Conversation assignment (assign to self, assign to teammate)
- [ ] Conversation status transitions (resolve, reopen, close)
- [ ] Real-time message updates (WebSocket)
- [ ] Typing indicators
- [ ] Unread message count badge

#### Settings & Admin

- [ ] Account settings page (name, logo, timezone)
- [ ] Team members page (list, invite, remove, change role)
- [ ] Roles & permissions page
- [ ] Channel configuration page (connect email, SMS)
- [ ] Notification preferences
- [ ] Template management UI
- [ ] Canned response management UI

#### Profile

- [ ] User profile page (name, email, avatar)
- [ ] Change password
- [ ] Two-factor authentication setup
- [ ] Active sessions list

---

## 4. Overall System Plan — Cross-Cutting Concerns

### Multi-Tenant Isolation

Every API request flows through the gateway, which calls `/context/basic` to resolve the user's account memberships and injects `x-account-ids` into headers. Both backend APIs must:
- Read `x-account-ids` from request headers
- Scope all queries to the current account
- Prevent cross-account data access at the service layer

### Shared Authentication

- Both APIs validate the same Cognito JWT tokens
- The Messaging API should port the Account API's `src/middleware/auth.py` directly
- Gateway handles token passthrough — backends never issue tokens

### Real-Time Messaging

- **Primary plan:** WebSocket connections through KrakenD proxy to Messaging API
- **Fallback:** Direct WebSocket connection from frontend to Messaging API (bypassing gateway) if KrakenD WS proxy proves unreliable
- WebSocket events: new_message, conversation_updated, agent_typing, assignment_changed

### File Storage

- Attachments stored in S3 (or S3-compatible)
- Messaging API generates pre-signed upload/download URLs
- Gateway proxies file upload requests with increased body size limit
- Frontend uses pre-signed URLs for direct S3 upload (large files)

### Observability

- Structured JSON logging across all services
- Request ID correlation: gateway generates X-Trace-ID, backends propagate it
- Health check endpoints: `GET /health` (shallow) and `GET /health/ready` (deep — checks DB)
- Future: OpenTelemetry traces, Prometheus metrics

---

## 5. Sprint Plan

### Sprint 1 — Foundation & Auth Hardening (Weeks 1–2)

**Goal:** Harden auth, stand up messaging API scaffolding, build frontend auth flow.

| Task | Repo | Size | Depends On |
|---|---|---|---|
| Implement password reset / forgot password | account_api | M | — |
| Implement change password endpoint | account_api | S | — |
| Implement refresh token rotation | account_api | M | — |
| Add invitation system (invite user by email) | account_api | L | — |
| Port auth middleware to Messaging API | messaging_api | S | — |
| Create Channels model + migration + CRUD | messaging_api | M | Auth middleware |
| Create Tags model + migration + CRUD | messaging_api | S | Auth middleware |
| Install Amplify, shadcn/ui, Zustand, react-hook-form | web_core | S | — |
| Build API client utility with auth headers | web_core | S | — |
| Build Sign Up, Verify Email, Sign In pages | web_core | L | API client |
| Build Forgot Password, Reset Password pages | web_core | M | API client, account_api password reset |
| Create app shell layout (sidebar, header, breadcrumbs) | web_core | M | Auth pages |
| Restrict CORS to specific origins | gateway | S | — |
| Add rate limiting (global) | gateway | M | — |

**Sprint 1 total:** ~14 tasks, 4 S + 5 M + 2 L (backend), 2 S + 2 M + 1 L (frontend)

---

### Sprint 2 — Core Messaging & Dashboard (Weeks 3–4)

**Goal:** Core messaging domain models, frontend dashboard + contacts.

| Task | Repo | Size | Depends On |
|---|---|---|---|
| Create Conversations model + migration + CRUD | messaging_api | L | Sprint 1 |
| Create Messages model + migration + CRUD | messaging_api | L | Conversations |
| Conversation lifecycle service (open → assigned → resolved → closed) | messaging_api | M | Conversations, Messages |
| Create Canned Responses model + CRUD | messaging_api | S | Auth middleware |
| Add messaging endpoints to gateway | gateway | M | Messaging CRUD |
| Activate Lua error-passthrough script | gateway | S | — |
| Switch gateway logging from DEBUG to INFO | gateway | S | — |
| Build Dashboard overview page (metrics cards) | web_core | M | App shell |
| Build Account switcher component | web_core | M | Auth context |
| Build Contact list page (table with filter/sort/pagination) | web_core | L | API client |
| Build Contact detail page | web_core | M | Contact list |
| Build Create/Edit contact form | web_core | M | Contact detail |
| Add soft-delete for Accounts and Users | account_api | M | — |
| Add account settings / preferences model | account_api | M | — |

**Sprint 2 total:** ~14 tasks

---

### Sprint 3 — Inbox & Real-Time (Weeks 5–6)

**Goal:** Inbox / helpdesk UI, WebSocket real-time messaging.

| Task | Repo | Size | Depends On |
|---|---|---|---|
| WebSocket support in Messaging API | messaging_api | L | Conversations, Messages |
| Agent assignment logic (round-robin, manual) | messaging_api | M | Conversations |
| Conversation activity log (MongoDB) | messaging_api | M | Conversations |
| Message attachments model + S3 integration | messaging_api | L | Messages |
| WebSocket proxy or direct connection setup | gateway | M | Messaging WS |
| File upload proxy endpoint with size limits | gateway | M | Attachments |
| Build Inbox page — conversation list (split view) | web_core | L | Dashboard, Messaging endpoints |
| Build Message thread view | web_core | L | Inbox |
| Build Message composer (text, attachments, canned responses) | web_core | M | Thread view |
| Build Conversation assignment UI | web_core | S | Inbox |
| Build Conversation status transition buttons | web_core | S | Inbox |
| Real-time WebSocket integration in frontend | web_core | L | WS endpoint |
| Templates model + CRUD in Messaging API | messaging_api | M | — |

**Sprint 3 total:** ~13 tasks

---

### Sprint 4 — CRM Features (Weeks 7–8)

**Goal:** Contact management depth, tags, segments, import/export.

| Task | Repo | Size | Depends On |
|---|---|---|---|
| Contact tags and custom fields | account_api | M | — |
| Contact segments / saved filters | account_api | M | Tags |
| Bulk operations (batch create/update/delete contacts) | account_api | L | — |
| Contact import (CSV upload endpoint) | account_api | L | Bulk ops |
| Contact export (CSV download endpoint) | account_api | M | — |
| Audit log model + middleware | account_api | L | — |
| Build Contact tags management UI | web_core | M | Tags endpoint |
| Build Contact import UI (CSV upload + mapping) | web_core | L | Import endpoint |
| Build Contact export button | web_core | S | Export endpoint |
| Build Contact segments UI (saved filters) | web_core | M | Segments endpoint |
| SLA tracking service (first-response time, resolution time) | messaging_api | M | Conversations |
| Notification dispatch service (in-app) | messaging_api | M | Conversations |
| Conversation merging | messaging_api | M | Conversations |
| Build typing indicators | web_core | S | WebSocket |

**Sprint 4 total:** ~14 tasks

---

### Sprint 5 — Integrations & Automation (Weeks 9–10)

**Goal:** Channel integrations (email, SMS), automation rules, webhook support.

| Task | Repo | Size | Depends On |
|---|---|---|---|
| Email channel integration (inbound via webhook, outbound via SES/SMTP) | messaging_api | L | Channels, Messages |
| SMS channel integration (Twilio or equivalent) | messaging_api | L | Channels, Messages |
| Automation rules engine (trigger → condition → action) | messaging_api | L | Conversations |
| Webhook receiver endpoint (for external integrations) | messaging_api | M | — |
| Template rendering with variable substitution | messaging_api | M | Templates |
| Email notification digest service | messaging_api | M | Notifications |
| Build Channel configuration page | web_core | L | Channel endpoints |
| Build Automation rules UI | web_core | L | Automation endpoints |
| Build Template management UI | web_core | M | Template CRUD |
| Build Canned response management UI | web_core | M | Canned resp. CRUD |
| Build Notification preferences page | web_core | M | Notification service |
| Build Team members page (invite, remove, change role) | web_core | M | Invitation system |
| Social login support (Google OAuth via Cognito) | account_api | M | — |
| MFA/2FA setup endpoint | account_api | M | — |

**Sprint 5 total:** ~14 tasks

---

### Sprint 6 — Polish, Testing & Documentation (Weeks 11–12)

**Goal:** Harden everything, raise test coverage, performance, accessibility, docs.

| Task | Repo | Size | Depends On |
|---|---|---|---|
| Raise Account API test coverage to 80% | account_api | L | — |
| Raise Messaging API test coverage to 80% | messaging_api | L | All messaging features |
| Structured JSON logging across both APIs | account_api + messaging_api | M | — |
| Request ID correlation (X-Trace-ID propagation) | gateway + both APIs | M | — |
| OpenAPI schema export for both APIs | account_api + messaging_api | S | — |
| API docs passthrough in gateway | gateway | S | OpenAPI export |
| Circuit breaker for backend services in gateway | gateway | M | — |
| Performance audit — N+1 queries, slow endpoints | account_api + messaging_api | M | — |
| Build User profile page (name, email, avatar, change password) | web_core | M | Change password endpoint |
| Build Roles & permissions settings page | web_core | M | Roles CRUD |
| Build 2FA setup page | web_core | M | MFA endpoint |
| Accessibility audit (WCAG 2.1 AA) for key flows | web_core | M | All UI pages |
| End-to-end smoke tests (gateway → API → DB) | gateway | L | All endpoints |
| Write developer onboarding guide | all repos | M | — |

**Sprint 6 total:** ~14 tasks

---

## 6. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | **KrakenD WebSocket proxy unreliable** | High | Medium | Fallback: frontend connects directly to Messaging API for WebSocket; gateway handles REST only |
| 2 | **Cognito rate limits on auth calls** | Medium | Low | Implement token caching; batch context lookups; request throttling at gateway |
| 3 | **Messaging API falls behind schedule** | High | Medium | It reuses Account API's patterns — reduce scope to Conversations + Messages first, defer Templates and Automation to post-roadmap |
| 4 | **Frontend auth complexity with Amplify** | Medium | Medium | Alternative: use backend-only auth (POST to `/v1/auth/login`, store JWT in httpOnly cookie) if Amplify integration stalls |
| 5 | **Multi-tenant data leakage** | Critical | Low | Enforce account scoping at service layer + integration tests that verify cross-account queries return empty; gateway always injects x-account-ids |
| 6 | **Single developer bottleneck on frontend** | Medium | High | Prioritize reusable components early (Sprint 1–2); use shadcn/ui to avoid building from scratch; keep UI minimal-viable, iterate later |
| 7 | **MongoDB and PostgreSQL consistency** | Medium | Low | Keep MongoDB for truly flexible documents (attachments, metadata); all core entities in PostgreSQL; avoid cross-database joins |
| 8 | **File upload size and S3 cost** | Low | Medium | Use pre-signed URLs for direct-to-S3 uploads; set reasonable file size limits (10MB default); implement cleanup for orphaned files |

---

## 7. Definition of Done

A feature is considered **done** when all of the following are met:

- [ ] Code reviewed and merged to `main`
- [ ] Unit/integration tests written and passing
- [ ] Coverage meets service threshold (Account API: 50%, Messaging API: 80%)
- [ ] Ruff linting passes with zero warnings
- [ ] API endpoint documented in OpenAPI schema
- [ ] Gateway endpoint configured (if user-facing)
- [ ] Frontend page functional and responsive (if applicable)
- [ ] No known security vulnerabilities (OWASP top-10 check)
- [ ] Works in multi-tenant context (scoped to account)
- [ ] Tested with at least 2 accounts and 2 roles

---

## 8. Post-Roadmap Backlog (v2.1+)

These items are intentionally **out of scope** for the initial 12-week plan:

- **WhatsApp Business API** channel integration
- **Telegram Bot API** channel integration
- **Facebook Messenger** channel integration
- **AI-powered reply suggestions** (LLM-based, using conversation context)
- **AI conversation summarization** for agent handoff
- **Chatbot / auto-responder** builder (no-code flow editor)
- **Mobile app** (React Native or Flutter)
- **Advanced analytics dashboard** (response times, agent performance, CSAT)
- **Customer satisfaction surveys** (post-resolution CSAT/NPS)
- **Knowledge base / help center** (public-facing articles)
- **Custom domain & white-labeling** per account
- **Multi-language support** (i18n for frontend, translation for messages)
- **Billing & subscription management** (Stripe integration)
- **API rate limiting per account tier** (free vs. pro vs. enterprise)
- **Webhooks for external consumers** (event-driven integrations)
- **Negarit app buildout** (purpose TBD — likely a public-facing portal)
- **SSO / SAML** for enterprise customers
- **Data export & GDPR compliance** tooling
- **Load testing & horizontal scaling** strategy

---

*This roadmap is a living document. Review and adjust at each sprint retrospective.*
