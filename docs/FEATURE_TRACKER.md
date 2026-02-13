# Turumba 2.0 — Feature Tracker

> **Last updated:** 2026-02-13
> **Source:** GitHub issues across all 4 repositories

---

## At a Glance

| | Completed | In Progress | Planned | Total |
|---|:-:|:-:|:-:|:-:|
| **Account API** | 3 | 0 | 28 | 31 |
| **Messaging API** | 9 | 1 | 1 | 11 |
| **Web Core** | 3 | 0 | 13 | 16 |
| **Gateway** | 1 | 0 | 1 | 2 |
| **Total** | **16** | **1** | **43** | **60** |

---

## Completed Features

### Infrastructure & Setup

| Feature | Repo | Issue |
|---------|------|-------|
| Core architecture (controllers, schemas, filters, sorters) | messaging_api | [#1](https://github.com/Turumba2/turumba_messaging_api/issues/1) |
| Alembic migrations, pre-commit hooks, pytest | messaging_api | [#2](https://github.com/Turumba2/turumba_messaging_api/issues/2) |
| Dual database support (PostgreSQL + MongoDB) | messaging_api | [#3](https://github.com/Turumba2/turumba_messaging_api/issues/3) |
| Migrate sync SQLAlchemy calls to async | messaging_api | [#20](https://github.com/Turumba2/turumba_messaging_api/issues/20) |
| Python test coverage enforcement | account_api | [#33](https://github.com/Turumba2/turumba_account_api/issues/33) |
| CORS preflight fix on deployed instance | gateway | [#6](https://github.com/Turumba2/turumba_gateway/issues/6) |

### Authentication (Backend + Frontend)

| Feature | Repo | Issue |
|---------|------|-------|
| Core auth pages (sign up, sign in, email verify) | web_core | [#1](https://github.com/Turumba2/turumba_web_core/issues/1) |
| Extended auth pages (forgot password, reset, 2FA UI) | web_core | [#2](https://github.com/Turumba2/turumba_web_core/issues/2) |
| Auth backend (JWT, Cognito) | account_api | [#14](https://github.com/Turumba2/turumba_account_api/issues/14) |

### Messaging Backend (CRUD APIs)

| Feature | Repo | Issue |
|---------|------|-------|
| Messages CRUD API | messaging_api | [#8](https://github.com/Turumba2/turumba_messaging_api/issues/8) |
| Delivery Channels CRUD API | messaging_api | [#9](https://github.com/Turumba2/turumba_messaging_api/issues/9) |
| Template Messages CRUD API | messaging_api | [#10](https://github.com/Turumba2/turumba_messaging_api/issues/10) |
| Group Messages CRUD API | messaging_api | [#11](https://github.com/Turumba2/turumba_messaging_api/issues/11) |
| Scheduled Messages CRUD API | messaging_api | [#12](https://github.com/Turumba2/turumba_messaging_api/issues/12) |

### Frontend Components

| Feature | Repo | Issue |
|---------|------|-------|
| Generic Table Builder with pagination | web_core | [#4](https://github.com/Turumba2/turumba_web_core/issues/4) |

---

## In Progress

| Feature | Repo | Issue | Notes |
|---------|------|-------|-------|
| Event infrastructure (EventBus + Outbox + RabbitMQ) | messaging_api | [#13](https://github.com/Turumba2/turumba_messaging_api/issues/13) | Infrastructure built but not wired into services |

---

## Planned — Next Up (Frontend Messaging Pages)

These are the immediate priority. All backend APIs are ready.

| Feature | Repo | Issue | Task Spec |
|---------|------|-------|-----------|
| Delivery Channels table view | web_core | [#8](https://github.com/Turumba2/turumba_web_core/issues/8) | FE-002 |
| Create new delivery channel page | web_core | [#9](https://github.com/Turumba2/turumba_web_core/issues/9) | FE-003 |
| Template Messages table view | web_core | [#11](https://github.com/Turumba2/turumba_web_core/issues/11) | FE-005 |
| Create/edit template message page | web_core | [#12](https://github.com/Turumba2/turumba_web_core/issues/12) | FE-006 |
| Messages table view | web_core | [#10](https://github.com/Turumba2/turumba_web_core/issues/10) | FE-004 |
| Create new message compose UI | web_core | [#7](https://github.com/Turumba2/turumba_web_core/issues/7) | FE-001 |
| Group Messages table view | web_core | [#13](https://github.com/Turumba2/turumba_web_core/issues/13) | FE-007 |
| Create group message page | web_core | [#14](https://github.com/Turumba2/turumba_web_core/issues/14) | FE-008 |
| Scheduled Messages table view | web_core | [#15](https://github.com/Turumba2/turumba_web_core/issues/15) | FE-009 |
| Create/edit scheduled message page | web_core | [#16](https://github.com/Turumba2/turumba_web_core/issues/16) | FE-010 |

**Recommended build order:** FE-002 → FE-003 → FE-005 → FE-006 → FE-004 → FE-001 → FE-007 → FE-008 → FE-009 → FE-010

---

## Planned — Frontend Platform Features

| Feature | Repo | Issue |
|---------|------|-------|
| Advanced table filter component | web_core | [#5](https://github.com/Turumba2/turumba_web_core/issues/5) |
| Messages page with multi-channel messaging | web_core | [#6](https://github.com/Turumba2/turumba_web_core/issues/6) |
| Multi-org switcher & dashboard access | account_api | [#53](https://github.com/Turumba2/turumba_account_api/issues/53) |
| Project initialization & navigation shell | account_api | [#24](https://github.com/Turumba2/turumba_account_api/issues/24) |
| Auth UI & API integration | account_api | [#26](https://github.com/Turumba2/turumba_account_api/issues/26) |
| Contact CRUD / import & export UI | account_api | [#31](https://github.com/Turumba2/turumba_account_api/issues/31) |
| Unified team inbox & real-time interaction | account_api | [#37](https://github.com/Turumba2/turumba_account_api/issues/37) |
| Message automation & scheduling tools UI | account_api | [#55](https://github.com/Turumba2/turumba_account_api/issues/55) |
| Dashboard analytics UI | account_api | [#43](https://github.com/Turumba2/turumba_account_api/issues/43) |
| Sorting and filtering across all data tables | account_api | [#58](https://github.com/Turumba2/turumba_account_api/issues/58) |

---

## Planned — Backend Services

### Authentication & User Management

| Feature | Repo | Issue |
|---------|------|-------|
| JWT authentication & security service | account_api | [#25](https://github.com/Turumba2/turumba_account_api/issues/25) |
| Organization creation & multi-tenant mapping | account_api | [#27](https://github.com/Turumba2/turumba_account_api/issues/27) |
| User management & invitations | account_api | [#28](https://github.com/Turumba2/turumba_account_api/issues/28) |
| User management & invitation service (RBAC) | account_api | [#29](https://github.com/Turumba2/turumba_account_api/issues/29) |
| Inactive user redirection | account_api | [#56](https://github.com/Turumba2/turumba_account_api/issues/56) |
| Organization switching issue | account_api | [#57](https://github.com/Turumba2/turumba_account_api/issues/57) |

### Contacts & CRM

| Feature | Repo | Issue |
|---------|------|-------|
| Contact CRUD & grouping | account_api | [#30](https://github.com/Turumba2/turumba_account_api/issues/30) |

### Messaging & Channels

| Feature | Repo | Issue |
|---------|------|-------|
| Messaging service & multi-platform normalization | account_api | [#36](https://github.com/Turumba2/turumba_account_api/issues/36) |
| WhatsApp API & webhook integration | account_api | [#38](https://github.com/Turumba2/turumba_account_api/issues/38) |
| Scheduling & bulk messaging engine | account_api | [#54](https://github.com/Turumba2/turumba_account_api/issues/54) |

### Real-Time & Infrastructure

| Feature | Repo | Issue |
|---------|------|-------|
| Interactive inbox integration | account_api | [#39](https://github.com/Turumba2/turumba_account_api/issues/39) |
| RabbitMQ for event-driven architecture | account_api | [#40](https://github.com/Turumba2/turumba_account_api/issues/40) |
| WebSocket client for real-time message updates | account_api | [#41](https://github.com/Turumba2/turumba_account_api/issues/41) |
| Backend dashboard APIs (message counters) | account_api | [#42](https://github.com/Turumba2/turumba_account_api/issues/42) |

### DevOps & Infrastructure

| Feature | Repo | Issue |
|---------|------|-------|
| Provision cloud infrastructure | account_api | [#19](https://github.com/Turumba2/turumba_account_api/issues/19), [#20](https://github.com/Turumba2/turumba_account_api/issues/20) |
| Infrastructure & API gateway setup | account_api | [#22](https://github.com/Turumba2/turumba_account_api/issues/22) |
| CI/CD pipelines | account_api | [#23](https://github.com/Turumba2/turumba_account_api/issues/23) |
| Doppler environment variable management | account_api [#61](https://github.com/Turumba2/turumba_account_api/issues/61), messaging_api [#26](https://github.com/Turumba2/turumba_messaging_api/issues/26), web_core [#20](https://github.com/Turumba2/turumba_web_core/issues/20) | Cross-repo |

---

## Feature Maturity by Service

```
Account API     ████████████████████░░░░  ~80%  Core complete, needs invitations, RBAC depth, audit log
Messaging API   ██████████████████░░░░░░  ~75%  All CRUD done, events need wiring, no channel integrations yet
Gateway         ████████████████████████  ~95%  51 endpoints, context enricher, CORS fixed
Web Core        ██████░░░░░░░░░░░░░░░░░░  ~25%  Auth + table builder only, 0/10 messaging pages started
```

---

## Critical Path

1. **Wire event infrastructure** into messaging services (BE-006 remaining work)
2. **Build frontend messaging pages** — FE-002 through FE-010 (all backend APIs ready)
3. **Channel integrations** — connect real SMS/WhatsApp/Telegram providers
4. **Real-time** — WebSocket support for inbox and live message updates
