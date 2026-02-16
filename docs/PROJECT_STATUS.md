# Turumba 2.0 — Project Status

> Last updated: 2026-02-16

Quick navigation:
- [Implementation Status by Service](#implementation-status-by-service)
- [Task Spec vs Implementation Matrix](#task-spec-vs-implementation-matrix)
- [What's Next](#whats-next)

Related documents:
- [GitHub Issues Reference](./GITHUB_ISSUES.md) — All issues across repositories
- [TURUMBA_MESSAGING.md](./TURUMBA_MESSAGING.md) — Messaging system spec
- [TURUMBA_DELIVERY_CHANNELS.md](./TURUMBA_DELIVERY_CHANNELS.md) — Delivery channels spec
- Task specs: [docs/tasks/messaging/](./tasks/messaging/) | [docs/tasks/delivery-channels/](./tasks/delivery-channels/)

---

## Implementation Status by Service

### turumba_account_api — COMPLETE (Active Development)

All core entities are fully implemented end-to-end (model → schema → service → controller → router → tests).

| Entity | Model | Schema | Controller | Service | Router | Tests |
|--------|:-----:|:------:|:----------:|:-------:|:------:|:-----:|
| User | done | done | done | done (3) | done | done |
| Account | done | done | done | done (3) | done | done |
| Role | done | done | done | done (3) | done | done |
| AccountUser | done | done | done | done (5) | done | done |
| Contact (MongoDB) | done | done | done | done (3) | done | done |
| Person (MongoDB) | done | done | done | done (3) | done | done |
| Auth (Cognito) | — | done | done | done | done | done |
| Context | — | — | done | — | done | — |

**Endpoints registered:** `/v1/auth`, `/v1/users`, `/v1/accounts`, `/v1/roles`, `/v1/contacts`, `/v1/persons`, `/v1/context`

**Database:** 1 Alembic migration (init_db — all tables)

**Coverage:** 50% minimum enforced (pre-commit + CI)

**Recent changes (since 2026-02-13):**
- **PR #60 merged:** Custom filter resolvers for cross-table filtering and sorting (e.g., filter users by account name)
- **PR #59 merged:** Cursor plan formatting fixes
- **WIP on main (uncommitted):** AccountUser entity rework — new controllers (`account_user`, `account_user_by_account`), schemas, services, routers, and tests for managing users within accounts from both the account and user perspectives. 10 new files + 5 modified files.
- **New bugs:** #62 Unauthorized Access to Organization (2026-02-15), #63 Creating new org returns 500 (2026-02-15)

---

### turumba_messaging_api — CRUD COMPLETE, Events Integration Pending

All five domain entities have full CRUD implemented. Event infrastructure is built but **not yet wired into the service layer**.

| Entity | Model | Schema | Controller | Service | Router | Tests |
|--------|:-----:|:------:|:----------:|:-------:|:------:|:-----:|
| Channel | done | done | done | done (3) | done | done |
| Message | done | done | done | done (3) | done | done |
| Template | done | done | done | done (3) | done | done |
| GroupMessage | done | done | done | done (3) | done | done |
| ScheduledMessage | done | done | done | done (3) | done | done |
| OutboxEvent | done | — | — | — | — | done |
| EventBus | — | — | — | done | — | done |
| OutboxMiddleware | — | — | — | done | — | done |
| OutboxWorker | — | — | — | done | — | — |

**Endpoints registered:** `/v1/channels`, `/v1/messages`, `/v1/templates`, `/v1/group-messages`, `/v1/scheduled-messages`

**Database:** 7 Alembic migrations (one per entity + constraints)

**Coverage:** 80% minimum enforced in CI

**Gap:** Event emission is not integrated — services create entities but do not publish domain events to EventBus. The EventBus, OutboxMiddleware, and OutboxWorker are all implemented and tested individually, but the routers/services don't inject or use them yet. This is the remaining work in [BE-006](./tasks/messaging/BE-006-event-outbox-rabbitmq.md).

---

### turumba_gateway — FULLY CONFIGURED (PR #14 Pending Merge)

| Component | Status | Details |
|-----------|--------|---------|
| KrakenD config | done | Template-based with file composition |
| Context-enricher plugin | done | Go plugin with wildcard pattern matching |
| Account API endpoints | done | auth (4), accounts (5), users (5), persons (5), groups (5), context (1) = **25 endpoints** |
| Messaging API endpoints | done | channels (5), messages (5), templates (5), group-messages (5), scheduled-messages (5) = **25 endpoints** |
| Lua scripts | done | request_enricher, error_passthrough, header_modifier, http_client |
| Docker Compose | done | 3 services (krakend, account_api, messaging_api) on gateway-network |

**Total: 51 gateway endpoints configured**

**Plugin patterns:** 10 wildcard patterns covering all entity routes for context enrichment

**Note:** The repo is currently checked out on `feature/add-messaging-api-endpoints` branch. PR #14 adds messaging API endpoint routes with rate limiting, circuit breakers, and `role_ids` mapping — aligned with the accounts.json pattern. This PR has been reviewed but **not yet merged to main**.

**New issue:** #16 — Add query parameter validation plugin for list endpoints

---

### turumba_web_core — Auth Complete, Feature Pages Pending

| Feature | App | Status | Notes |
|---------|-----|--------|-------|
| Sign In (email/password) | turumba | done | Amplify + Cognito |
| Sign Up + Registration | turumba | done | Calls POST /auth/register |
| Email Verification (OTP) | turumba | done | 6-digit code input |
| 2FA / TOTP | turumba | UI only | Form built, not wired to auth flow |
| Forgot Password | turumba | UI only | Form structure ready |
| Reset Password | turumba | UI only | Form structure ready |
| Google SSO | turumba | UI only | Button present, backend pending |
| Server-side Auth Guard | turumba | done | Middleware redirects unauthenticated users |
| Dashboard | turumba | skeleton | Protected route, placeholder content |
| Shared UI Library | @repo/ui | done | 24 Radix-based components, Field system |
| Generic Table Builder | @repo/ui | done | Pagination + API integration |
| Organization Management | turumba | done | Org page, empty state, inactive org handling |
| User Management | turumba | done | User management feature |
| Contacts (initial) | turumba | partial | Empty state + filters, page header |
| Advanced Table Filter | turumba | in progress | Issue #5 open |
| negarit app | negarit | skeleton | Boilerplate only |
| web app | web | skeleton | Boilerplate only |
| docs app | docs | skeleton | Boilerplate only |

**New bugs (2026-02-16):**
- [web#21](https://github.com/Turumba2/turumba_web_core/issues/21) — Inactive User Redirection
- [web#22](https://github.com/Turumba2/turumba_web_core/issues/22) — Switching between organization issue

**Note:** Issue #1 (Core Auth Pages) is still open despite implementation being complete — may need to be closed or has remaining sub-tasks.

---

## Task Spec vs Implementation Matrix

### Backend Tasks (Messaging API)

| Task ID | Title | Issue | Assignee | Spec Status | Implementation |
|---------|-------|-------|----------|-------------|----------------|
| [BE-001](./tasks/messaging/BE-001-messages-crud.md) | Messages CRUD API | [messaging#8](https://github.com/Turumba2/turumba_messaging_api/issues/8) | tesfayegirma-116 | Complete | **DONE** — Closed 2026-02-11 |
| [BE-002](./tasks/delivery-channels/BE-002-delivery-channels-crud.md) | Delivery Channels CRUD API | [messaging#9](https://github.com/Turumba2/turumba_messaging_api/issues/9) | tesfayegirma-116 | Complete | **DONE** — Closed 2026-02-11 |
| [BE-003](./tasks/messaging/BE-003-template-messages-crud.md) | Template Messages CRUD API | [messaging#10](https://github.com/Turumba2/turumba_messaging_api/issues/10) | tesfayegirma-116 | Complete | **DONE** — Closed 2026-02-12 |
| [BE-004](./tasks/messaging/BE-004-group-messages-crud.md) | Group Messages CRUD API | [messaging#11](https://github.com/Turumba2/turumba_messaging_api/issues/11) | tesfayegirma-116 | Complete | **DONE** — Closed 2026-02-12 |
| [BE-005](./tasks/messaging/BE-005-scheduled-messages-crud.md) | Scheduled Messages CRUD API | [messaging#12](https://github.com/Turumba2/turumba_messaging_api/issues/12) | tesfayegirma-116 | Complete | **DONE** — Closed 2026-02-12 |
| [BE-006](./tasks/messaging/BE-006-event-outbox-rabbitmq.md) | Event Infrastructure (EventBus + Outbox + RabbitMQ) | [messaging#13](https://github.com/Turumba2/turumba_messaging_api/issues/13) | bengeos, tesfayegirma-116 | Complete | **PARTIAL** — Infrastructure built, not integrated into services |

### Frontend Tasks (Web Core)

| Task ID | Title | Issue | Assignee | Spec Status | Implementation |
|---------|-------|-------|----------|-------------|----------------|
| [FE-001](./tasks/messaging/FE-001-create-new-message.md) | Create New Message Page | [web#7](https://github.com/Turumba2/turumba_web_core/issues/7) | nahomfix | Complete | **NOT STARTED** |
| [FE-002](./tasks/delivery-channels/FE-002-delivery-channels-table.md) | Delivery Channels Table View | [web#8](https://github.com/Turumba2/turumba_web_core/issues/8) | nahomfix | Complete | **NOT STARTED** |
| [FE-003](./tasks/delivery-channels/FE-003-create-delivery-channel.md) | Create New Delivery Channel | [web#9](https://github.com/Turumba2/turumba_web_core/issues/9) | nahomfix | Complete | **NOT STARTED** |
| [FE-004](./tasks/messaging/FE-004-messages-table.md) | Messages Table View | [web#10](https://github.com/Turumba2/turumba_web_core/issues/10) | nahomfix | Complete | **NOT STARTED** |
| [FE-005](./tasks/messaging/FE-005-template-messages-table.md) | Template Messages Table View | [web#11](https://github.com/Turumba2/turumba_web_core/issues/11) | nahomfix | Complete | **NOT STARTED** |
| [FE-006](./tasks/messaging/FE-006-create-edit-template.md) | Create/Edit Template Message | [web#12](https://github.com/Turumba2/turumba_web_core/issues/12) | nahomfix | Complete | **NOT STARTED** |
| [FE-007](./tasks/messaging/FE-007-group-messages-table.md) | Group Messages Table View | [web#13](https://github.com/Turumba2/turumba_web_core/issues/13) | nahomfix | Complete | **NOT STARTED** |
| [FE-008](./tasks/messaging/FE-008-create-group-message.md) | Create Group Message Page | [web#14](https://github.com/Turumba2/turumba_web_core/issues/14) | nahomfix | Complete | **NOT STARTED** |
| [FE-009](./tasks/messaging/FE-009-scheduled-messages-table.md) | Scheduled Messages Table View | [web#15](https://github.com/Turumba2/turumba_web_core/issues/15) | nahomfix | Complete | **NOT STARTED** |
| [FE-010](./tasks/messaging/FE-010-create-edit-scheduled-message.md) | Create/Edit Scheduled Message | [web#16](https://github.com/Turumba2/turumba_web_core/issues/16) | nahomfix | Complete | **NOT STARTED** |

### Infrastructure / Shared Tasks (from GitHub Issues, no task spec docs)

| Title | Repo | Issue | Assignee | Status |
|-------|------|-------|----------|--------|
| Generic Table Builder component | web_core | [web#4](https://github.com/Turumba2/turumba_web_core/issues/4) | nahomfix | **DONE** — Closed 2026-02-12 |
| Advanced Table Filter component | web_core | [web#5](https://github.com/Turumba2/turumba_web_core/issues/5) | nahomfix | **OPEN** |
| Messages Page (multi-channel) | web_core | [web#6](https://github.com/Turumba2/turumba_web_core/issues/6) | nahomfix | **OPEN** |
| Core Auth Pages (Sign In/Up/Verify) | web_core | [web#1](https://github.com/Turumba2/turumba_web_core/issues/1) | nahomfix | **DONE** — Closed 2026-02-11 |
| Extended Auth Pages (Forgot/Reset/2FA) | web_core | [web#2](https://github.com/Turumba2/turumba_web_core/issues/2) | nahomfix | **DONE** — Closed 2026-02-11 |
| Dual Database Support setup | messaging_api | [messaging#3](https://github.com/Turumba2/turumba_messaging_api/issues/3) | tesfayegirma-116 | **DONE** — Closed 2026-02-08 |
| Alembic + Pre-commit + Pytest setup | messaging_api | [messaging#2](https://github.com/Turumba2/turumba_messaging_api/issues/2) | tesfayegirma-116 | **DONE** — Closed 2026-02-09 |
| Core Architecture Components | messaging_api | [messaging#1](https://github.com/Turumba2/turumba_messaging_api/issues/1) | tesfayegirma-116 | **DONE** — Closed 2026-02-08 |
| Migrate sync SQLAlchemy to async | messaging_api | [messaging#20](https://github.com/Turumba2/turumba_messaging_api/issues/20) | — | **DONE** — Closed 2026-02-11 |
| Doppler Integration | account_api | [account#61](https://github.com/Turumba2/turumba_account_api/issues/61) | bengeos | **OPEN** — Created today |
| Doppler Integration | messaging_api | [messaging#26](https://github.com/Turumba2/turumba_messaging_api/issues/26) | bengeos | **OPEN** — Created today |
| Doppler Integration | web_core | [web#20](https://github.com/Turumba2/turumba_web_core/issues/20) | bengeos | **OPEN** — Created today |

---

## What's Next

### Urgent bugs

1. **Account API #63** — Creating a new organization returns 500 Internal Server Error (2026-02-15)
2. **Account API #62** — Unauthorized Access to Organization (2026-02-15)
3. **Web Core #22** — Switching between organization issue (2026-02-16)
4. **Web Core #21** — Inactive User Redirection (2026-02-16)

### Pending merges

1. **Gateway PR #14** — Merge messaging API endpoint routes to main (reviewed, ready)
2. **Account API** — Commit and PR the AccountUser entity rework (currently uncommitted on main)

### Immediate priorities (blocking frontend work)

1. **BE-006 completion** — Wire EventBus into GroupMessage and ScheduledMessage service layers so domain events flow through the outbox to RabbitMQ. [messaging#13](https://github.com/Turumba2/turumba_messaging_api/issues/13)

2. **Advanced Table Filter component** — Prerequisite for all table view pages (FE-002, FE-004, FE-005, FE-007, FE-009). [web#5](https://github.com/Turumba2/turumba_web_core/issues/5)

### Frontend feature pages (all assigned to nahomfix, backend APIs ready)

Recommended build order following dependency chain:
1. FE-002 → FE-003 (Delivery Channels table → Create channel) — No FE dependencies
2. FE-005 → FE-006 (Templates table → Create/Edit template) — No FE dependencies
3. FE-004 → FE-001 (Messages table → New message compose) — Needs channels
4. FE-007 → FE-008 (Group messages table → Create group message) — Needs templates + channels
5. FE-009 → FE-010 (Scheduled messages table → Create/Edit scheduled) — Needs all above

### Account API backlog (30 open issues)

The account_api repo has a large backlog of high-level epic/feature issues. Many overlap with messaging task specs or represent future phases. See [GITHUB_ISSUES.md](./GITHUB_ISSUES.md#turumba_account_api) for the full list.

### Cross-cutting

- Doppler integration across all services (3 issues open: account#61, messaging#26, web#20)
- Dashboard analytics (account#43, account#42)
- Real-time messaging via WebSocket (account#41)
- RabbitMQ event-driven architecture (account#40)
- WhatsApp API integration (account#38)

### Repository hygiene

- **Account API:** ~10 stale local branches from merged PRs can be cleaned up
- **Messaging API:** ~6 stale local branches from merged features
- **Gateway:** ~3 stale branches from merged PRs
- **Web Core:** Remote `feat/auth` branch can be deleted (all auth PRs merged)
- **Account API issues:** #18, #19, #21 are test/duplicate entries that should be closed
