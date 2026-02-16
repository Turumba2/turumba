# GitHub Issues Reference

> Last updated: 2026-02-16
> Organization: [Turumba2](https://github.com/Turumba2)

Quick navigation:
- [turumba_messaging_api](#turumba_messaging_api) (2 open / 10 closed)
- [turumba_web_core](#turumba_web_core) (16 open / 3 closed)
- [turumba_account_api](#turumba_account_api) (30 open / 2 closed)
- [turumba_gateway](#turumba_gateway) (2 open / 1 closed)
- [Summary](#summary)

Related: [Project Status](./PROJECT_STATUS.md) | [Task Specs](./tasks/)

---

## turumba_messaging_api

**Repo:** [Turumba2/turumba_messaging_api](https://github.com/Turumba2/turumba_messaging_api)
**Team:** bengeos (lead), tesfayegirma-116 (developer)

### Open Issues

| # | Title | Assignee | Created | Task Spec |
|---|-------|----------|---------|-----------|
| [26](https://github.com/Turumba2/turumba_messaging_api/issues/26) | Integrate Doppler for environment variable management | bengeos | 2026-02-13 | — |
| [13](https://github.com/Turumba2/turumba_messaging_api/issues/13) | BE-006: Event Infrastructure — EventBus + Transactional Outbox + RabbitMQ | bengeos, tesfayegirma-116 | 2026-02-08 | [BE-006](./tasks/messaging/BE-006-event-outbox-rabbitmq.md) |

### Closed Issues

| # | Title | Assignee | Closed | Task Spec |
|---|-------|----------|--------|-----------|
| [20](https://github.com/Turumba2/turumba_messaging_api/issues/20) | refactor: migrate synchronous SQLAlchemy calls to async in all controllers | — | 2026-02-11 | — |
| [12](https://github.com/Turumba2/turumba_messaging_api/issues/12) | Implement Scheduled Messages CRUD API | tesfayegirma-116 | 2026-02-12 | [BE-005](./tasks/messaging/BE-005-scheduled-messages-crud.md) |
| [11](https://github.com/Turumba2/turumba_messaging_api/issues/11) | Implement Group Messages CRUD API | tesfayegirma-116 | 2026-02-12 | [BE-004](./tasks/messaging/BE-004-group-messages-crud.md) |
| [10](https://github.com/Turumba2/turumba_messaging_api/issues/10) | Implement Template Messages CRUD API | tesfayegirma-116 | 2026-02-12 | [BE-003](./tasks/messaging/BE-003-template-messages-crud.md) |
| [9](https://github.com/Turumba2/turumba_messaging_api/issues/9) | [Feature] Implement Delivery Channels CRUD API | tesfayegirma-116 | 2026-02-11 | [BE-002](./tasks/delivery-channels/BE-002-delivery-channels-crud.md) |
| [8](https://github.com/Turumba2/turumba_messaging_api/issues/8) | [Feature] Implement Messages CRUD API | tesfayegirma-116 | 2026-02-11 | [BE-001](./tasks/messaging/BE-001-messages-crud.md) |
| [3](https://github.com/Turumba2/turumba_messaging_api/issues/3) | [Setup] Implement Dual Database Support (PostgreSQL + MongoDB) | tesfayegirma-116 | 2026-02-08 | — |
| [2](https://github.com/Turumba2/turumba_messaging_api/issues/2) | [Setup] Configure Alembic, Pre-commit Hooks, and Pytest Test Environment | tesfayegirma-116 | 2026-02-09 | — |
| [1](https://github.com/Turumba2/turumba_messaging_api/issues/1) | [Setup] Implement Core Architecture Components (Controllers, Schemas, Filters, Sorters) | tesfayegirma-116 | 2026-02-08 | — |

---

## turumba_web_core

**Repo:** [Turumba2/turumba_web_core](https://github.com/Turumba2/turumba_web_core)
**Team:** bengeos (lead), nahomfix (developer)

### Open Issues — Bugs

| # | Title | Assignee | Created | Task Spec |
|---|-------|----------|---------|-----------|
| [22](https://github.com/Turumba2/turumba_web_core/issues/22) | Switching between organization issue | — | 2026-02-16 | — |
| [21](https://github.com/Turumba2/turumba_web_core/issues/21) | Inactive User Redirection | — | 2026-02-16 | — |

### Open Issues — Infrastructure

| # | Title | Assignee | Created | Task Spec |
|---|-------|----------|---------|-----------|
| [20](https://github.com/Turumba2/turumba_web_core/issues/20) | Integrate Doppler for environment variable management | bengeos | 2026-02-13 | — |

### Open Issues — Feature Pages

| # | Title | Assignee | Created | Task Spec |
|---|-------|----------|---------|-----------|
| [16](https://github.com/Turumba2/turumba_web_core/issues/16) | FE-010: Create / Edit Scheduled Message Page | nahomfix | 2026-02-08 | [FE-010](./tasks/messaging/FE-010-create-edit-scheduled-message.md) |
| [15](https://github.com/Turumba2/turumba_web_core/issues/15) | FE-009: Scheduled Messages Table View | nahomfix | 2026-02-08 | [FE-009](./tasks/messaging/FE-009-scheduled-messages-table.md) |
| [14](https://github.com/Turumba2/turumba_web_core/issues/14) | FE-008: Create Group Message Page | nahomfix | 2026-02-08 | [FE-008](./tasks/messaging/FE-008-create-group-message.md) |
| [13](https://github.com/Turumba2/turumba_web_core/issues/13) | FE-007: Group Messages Table View | nahomfix | 2026-02-08 | [FE-007](./tasks/messaging/FE-007-group-messages-table.md) |
| [12](https://github.com/Turumba2/turumba_web_core/issues/12) | Create / Edit Template Message Page | nahomfix | 2026-02-08 | [FE-006](./tasks/messaging/FE-006-create-edit-template.md) |
| [11](https://github.com/Turumba2/turumba_web_core/issues/11) | Template Messages Table View | nahomfix | 2026-02-08 | [FE-005](./tasks/messaging/FE-005-template-messages-table.md) |
| [10](https://github.com/Turumba2/turumba_web_core/issues/10) | Messages Table View | nahomfix | 2026-02-08 | [FE-004](./tasks/messaging/FE-004-messages-table.md) |
| [9](https://github.com/Turumba2/turumba_web_core/issues/9) | Create New Delivery Channel Page | nahomfix | 2026-02-08 | [FE-003](./tasks/delivery-channels/FE-003-create-delivery-channel.md) |
| [8](https://github.com/Turumba2/turumba_web_core/issues/8) | Delivery Channels Table View | nahomfix | 2026-02-08 | [FE-002](./tasks/delivery-channels/FE-002-delivery-channels-table.md) |
| [7](https://github.com/Turumba2/turumba_web_core/issues/7) | Create New Message Compose UI (Page/Popup) | nahomfix | 2026-02-08 | [FE-001](./tasks/messaging/FE-001-create-new-message.md) |
| [6](https://github.com/Turumba2/turumba_web_core/issues/6) | Build Messages Page with multi-channel messaging, filters, and paginated table | nahomfix | 2026-02-08 | — |
| [5](https://github.com/Turumba2/turumba_web_core/issues/5) | Build Advanced Table Filter component with configurable column types and operations | nahomfix | 2026-02-08 | — |
| [1](https://github.com/Turumba2/turumba_web_core/issues/1) | Implement Core Authentication Pages (Sign Up, Sign In, Email Verify) | nahomfix | 2026-01-29 | — |

### Closed Issues

| # | Title | Assignee | Closed | Task Spec |
|---|-------|----------|--------|-----------|
| [4](https://github.com/Turumba2/turumba_web_core/issues/4) | Implement Generic Table Builder component with pagination and API request functionality | nahomfix | 2026-02-12 | — |
| [2](https://github.com/Turumba2/turumba_web_core/issues/2) | feat: Implement Extended Authentication Pages (Forgot Password, Reset Password, 2FA) | nahomfix | 2026-02-11 | — |
| [1](https://github.com/Turumba2/turumba_web_core/issues/1) | feat: Implement Core Authentication Pages (Sign Up, Sign In, Email Verify) | nahomfix | 2026-02-11 | — |

---

## turumba_account_api

**Repo:** [Turumba2/turumba_account_api](https://github.com/Turumba2/turumba_account_api)
**Team:** bengeos (lead), nahomfix (developer), NardosKb (developer)

### Open Issues — Bugs

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [63](https://github.com/Turumba2/turumba_account_api/issues/63) | Creating a new organization returns a 500 Internal Server Error | — | 2026-02-15 |
| [62](https://github.com/Turumba2/turumba_account_api/issues/62) | Unauthorized Access to Organization | — | 2026-02-15 |
| [57](https://github.com/Turumba2/turumba_account_api/issues/57) | Switching between organization issue | nahomfix | 2026-02-06 |
| [56](https://github.com/Turumba2/turumba_account_api/issues/56) | Inactive User Redirection | nahomfix | 2026-02-06 |

### Open Issues — Infrastructure & DevOps

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [61](https://github.com/Turumba2/turumba_account_api/issues/61) | Integrate Doppler for environment variable management | bengeos | 2026-02-13 |
| [23](https://github.com/Turumba2/turumba_account_api/issues/23) | Establish CI/CD Pipelines | bengeos | 2026-01-29 |
| [22](https://github.com/Turumba2/turumba_account_api/issues/22) | Infrastructure & API Gateway Setup | bengeos | 2026-01-29 |
| [20](https://github.com/Turumba2/turumba_account_api/issues/20) | Provision Cloud Infrastructure | — | 2026-01-29 |
| [19](https://github.com/Turumba2/turumba_account_api/issues/19) | Provision Cloud Infrastructure (duplicate) | — | 2026-01-29 |

### Open Issues — Authentication & User Management

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [53](https://github.com/Turumba2/turumba_account_api/issues/53) | Multi-Org Switcher & Dashboard Access [FE] | bengeos | 2026-02-03 |
| [29](https://github.com/Turumba2/turumba_account_api/issues/29) | [BE] User Management & Invitation Service (RBAC) | bengeos | 2026-01-29 |
| [28](https://github.com/Turumba2/turumba_account_api/issues/28) | User Management & Invitations | bengeos | 2026-01-29 |
| [27](https://github.com/Turumba2/turumba_account_api/issues/27) | Organization Creation & Multi-Tenant Mapping [BE] | bengeos | 2026-01-29 |
| [26](https://github.com/Turumba2/turumba_account_api/issues/26) | Auth UI & API Integration | bengeos | 2026-01-29 |
| [25](https://github.com/Turumba2/turumba_account_api/issues/25) | Auth: JWT Authentication & Security Service | bengeos | 2026-01-29 |
| [24](https://github.com/Turumba2/turumba_account_api/issues/24) | Project Initialization & Navigation Shell [FE] | bengeos | 2026-01-29 |

### Open Issues — Contacts

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [31](https://github.com/Turumba2/turumba_account_api/issues/31) | Contact CRUD / Import & Export [FE] | bengeos | 2026-01-29 |
| [30](https://github.com/Turumba2/turumba_account_api/issues/30) | Contact CRUD & Grouping [BE] | bengeos | 2026-01-29 |

### Open Issues — Enhancements & Messaging

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [58](https://github.com/Turumba2/turumba_account_api/issues/58) | Implement Sorting and Filtering mechanisms across all data tables | nahomfix | 2026-02-06 |
| [55](https://github.com/Turumba2/turumba_account_api/issues/55) | [FE] Message Automation & Scheduling Tools | — | 2026-02-03 |
| [54](https://github.com/Turumba2/turumba_account_api/issues/54) | [BE] Scheduling & Bulk Messaging Engine | bengeos | 2026-02-03 |
| [36](https://github.com/Turumba2/turumba_account_api/issues/36) | [BE] Messaging Service & Multi-Platform Normalization | bengeos | 2026-01-30 |
| [38](https://github.com/Turumba2/turumba_account_api/issues/38) | WhatsApp API & Webhook Integration | bengeos | 2026-01-30 |

### Open Issues — Real-time & Dashboard

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [43](https://github.com/Turumba2/turumba_account_api/issues/43) | Build Dashboard Analytics: Visual counters, status indicators, conversation lists | bengeos | 2026-01-30 |
| [42](https://github.com/Turumba2/turumba_account_api/issues/42) | Backend Dashboard APIs: Message counters (Sent/Received/Failed) | bengeos | 2026-01-30 |
| [41](https://github.com/Turumba2/turumba_account_api/issues/41) | Implement WebSocket client for real-time message updates in Inbox | bengeos | 2026-01-30 |
| [40](https://github.com/Turumba2/turumba_account_api/issues/40) | Set up RabbitMQ (AMQP) for Event-Driven Architecture | bengeos | 2026-01-30 |
| [39](https://github.com/Turumba2/turumba_account_api/issues/39) | Interactive Inbox Integration | — | 2026-01-30 |
| [37](https://github.com/Turumba2/turumba_account_api/issues/37) | [FE] Unified Team Inbox & Real-Time Interaction | bengeos | 2026-01-30 |

### Open Issues — Documentation & Test

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [50](https://github.com/Turumba2/turumba_account_api/issues/50) | Feature Request Template & Guidelines for Creating Technical Issues | NardosKb | 2026-01-30 |
| [21](https://github.com/Turumba2/turumba_account_api/issues/21) | Test Task 01 | NardosKb | 2026-01-29 |
| [18](https://github.com/Turumba2/turumba_account_api/issues/18) | test | — | 2026-01-29 |

### Closed Issues

| # | Title | Assignee | Closed |
|---|-------|----------|--------|
| [33](https://github.com/Turumba2/turumba_account_api/issues/33) | Task: Implement Python Test Coverage Enforcement | bengeos | 2026-01-30 |
| [14](https://github.com/Turumba2/turumba_account_api/issues/14) | auth | — | 2026-01-29 |

---

## turumba_gateway

**Repo:** [Turumba2/turumba_gateway](https://github.com/Turumba2/turumba_gateway)
**Team:** bengeos (lead)

### Open Issues

| # | Title | Assignee | Created |
|---|-------|----------|---------|
| [16](https://github.com/Turumba2/turumba_gateway/issues/16) | Add query parameter validation plugin for list endpoints | — | 2026-02-13 |
| [5](https://github.com/Turumba2/turumba_gateway/issues/5) | Test task 0111 | — | 2026-01-29 |

### Closed Issues

| # | Title | Assignee | Closed |
|---|-------|----------|--------|
| [6](https://github.com/Turumba2/turumba_gateway/issues/6) | CORS preflight requests failing on deployed instance | bengeos | 2026-01-30 |

---

## Summary

| Repository | Open | Closed | Total |
|------------|:----:|:------:|:-----:|
| turumba_messaging_api | 2 | 10 | 12 |
| turumba_web_core | 16 | 3 | 19 |
| turumba_account_api | 30 | 2 | 32 |
| turumba_gateway | 2 | 1 | 3 |
| **Total** | **50** | **16** | **66** |

### Changes since 2026-02-13

- **+3 web_core issues:** #21 (Inactive User Redirection bug), #22 (Org switching bug), #1 (still open — auth pages implemented but issue not closed)
- **+2 account_api issues:** #62 (Unauthorized Access to Organization), #63 (Creating org returns 500 error)
- **-1 account_api:** Issue count dropped from 31 to 30 (one issue may have been closed or reassigned)
- **+1 gateway issue:** #16 (Query parameter validation plugin)

### Notes

- The **account_api** repo has many high-level epic/feature issues (e.g., #36, #37, #54, #55) that overlap with the detailed task specs in `docs/tasks/`. These were created as early planning issues before the detailed specs were written. Consider closing or linking them to the specific task specs.
- Issues #18, #19, #21 in account_api appear to be test/duplicate entries that could be cleaned up.
- Three Doppler integration issues (#61, #26, #20) were created on 2026-02-13 across account_api, messaging_api, and web_core.
- **New urgent bugs:** Account API #62 and #63 (org access/creation), Web Core #21 and #22 (org switching/inactive user) — all filed 2026-02-15/16.
