# Turumba 2.0 Overview Presentation Plan

> **Format:** PowerPoint (.pptx)
> **Duration:** ~20 minutes
> **Audience:** Technical / stakeholder overview
> **Focus:** What is Turumba, its microservices, each service's responsibilities, overall architecture, and evolution path
> **Theme:** Dark navy with color-coded accent cards

---

## Slide Structure (18 slides)

### Intro (Slides 1-3)

| # | Slide | Content | ~Time |
|---|-------|---------|-------|
| 1 | **Title** | "Turumba 2.0 — Multi-Channel Message Automation Platform" + tagline: "Send the right message, to the right person, through the right channel, at the right time." | 0:30 |
| 2 | **What is Turumba Today?** | One-paragraph definition (multi-tenant message automation platform). Right side or below: what's built NOW — accounts & auth, contacts & groups, 6 delivery channel types (SMS, SMPP, Telegram, WhatsApp, Messenger, Email), messages with template variable rendering, group messaging with progress tracking, scheduled messages with recurring support, transactional outbox event infrastructure. Emphasis: this is a working platform with 50+ API endpoints, not a concept. | 2:00 |
| 3 | **How Turumba Evolves** | Layered growth diagram — current foundation at the base, then 3 evolution layers stacked on top: **(1) High-Scale Dispatch** — channel adapter framework, per-channel dispatch workers, webhook receivers for inbound messages, Redis rate limiting, designed for 1M+ messages/day. **(2) Conversations & Customer Support** — omnichannel conversation inbox, bot-first routing with intelligent agent assignment, real-time WebSocket service (turumba_realtime), canned responses. **(3) AI & Analytics** — intent classification, smart replies, message translation, sentiment detection, dashboards & reporting. Key point: the architecture supports all of this without rewrites — each layer builds on what's already there. | 2:00 |

### Architecture (Slides 4-6)

| # | Slide | Content | ~Time |
|---|-------|---------|-------|
| 4 | **Section Divider: Architecture** | "System Architecture — Microservices, API gateway, and event-driven design" | — |
| 5 | **System Overview** | Full architecture diagram from `WHAT_IS_TURUMBA.md`: Client (Next.js apps) > KrakenD Gateway (port 8080) > Account API (FastAPI, Python 3.11) + Messaging API (FastAPI, Python 3.12) > PostgreSQL / MongoDB / RabbitMQ > Outbox Worker + Schedule Trigger. Show Docker network (`gateway-network`), internal container names, single exposed port. Badge callouts: 51 endpoints, 12 entities, 4 services. | 2:00 |
| 6 | **How It All Works Together** | The end-to-end flow (9 steps): (1) User signs up via web app > (2) Gateway routes to Account API > Cognito creates user > (3) On login, user receives JWT > (4) Every authenticated request: gateway calls `/context/basic`, resolves accounts + roles, injects as headers > (5) User creates contacts and groups > (6) Single message: API renders template variables, delivers through selected channel > (7) Group/scheduled message: API emits domain events via EventBus, flushed to outbox in same DB transaction > (8) Outbox Worker publishes to RabbitMQ, consumers process in background > (9) All activity recorded with full status tracking. | 1:30 |

### The Microservices (Slides 7-11)

| # | Slide | Content | ~Time |
|---|-------|---------|-------|
| 7 | **Section Divider: The 4 Services** | "The Microservices — Each service's role and responsibilities" | — |
| 8 | **turumba_gateway** | KrakenD 2.12.1. Single entry point for the entire platform (port 8080). **Context enrichment flow:** user hits endpoint > gateway calls `/v1/context/basic` on Account API > extracts account IDs + role IDs > injects as `x-account-ids`, `x-role-ids` headers > strips any user-provided values (anti-spoofing) > forwards enriched request to target service. Go plugin for context enrichment, Lua scripts for request/response modification, template-based config with file composition. 51 endpoints across accounts, users, auth, contacts, channels, messages, templates, group messages, scheduled messages. | 2:00 |
| 9 | **turumba_account_api** | FastAPI, Python 3.11. The identity and access backbone. **Current:** Users (registration, auth via AWS Cognito, JWT RS256), Accounts (multi-tenant organizations), Roles (account-specific with JSON permissions), Account Users (M:N user-account-role mapping), Contacts (MongoDB, flexible metadata), Persons (MongoDB). 7 routers, 18 service classes. PostgreSQL + MongoDB. The `/context/basic` endpoint that powers gateway enrichment. **Evolution:** AgentPreference model for conversation routing (available channels, topics, hours, languages, max concurrent conversations). | 2:00 |
| 10 | **turumba_messaging_api** | FastAPI, Python 3.12. The messaging core. **Current:** Channels (6 types with JSONB credentials, write-only security), Messages (status lifecycle: queued > sending > sent > delivered/failed), Templates (variable placeholders with 6-source resolution + fallback strategies), Group Messages (bulk send with progress tracking, auto-template creation), Scheduled Messages (one-time/recurring with timezone awareness), Outbox Events (transactional outbox for reliable event publishing). 5 routers, 15+ service classes. PostgreSQL + RabbitMQ. **Evolution:** Conversations + ContactIdentifier + CannedResponse + BotRule models, Channel Adapter framework (pluggable per-provider adapters), Dispatch Workers (per-channel-type), Webhook Receivers (inbound messages + delivery status), SMPP Gateway. | 2:00 |
| 11 | **turumba_web_core** | Turborepo monorepo, Next.js 16, TypeScript, Tailwind v4. **Apps:** Turumba (port 3600) — full-featured dashboard for message automation; Negarit (port 3500) — streamlined messaging-focused app. **Shared packages:** `@repo/ui` component library (24 Radix-based components), `@repo/eslint-config`, `@repo/typescript-config`. **Built:** Auth (Amplify + Cognito, email + optional TOTP 2FA), org management, user management, generic table builder with pagination. **Planned:** 10 messaging feature pages (channels, messages, templates, group messages, scheduled messages), conversation inbox UI, agent dashboard. | 1:00 |

### Deep Dives (Slides 12-13)

| # | Slide | Content | ~Time |
|---|-------|---------|-------|
| 12 | **Section Divider: Deep Dives** | "Under the Hood — Multi-tenancy and event-driven architecture" | — |
| 13 | **Multi-Tenancy & Event Architecture** | **Left half — 3-Layer Tenant Isolation:** (1) Gateway: context-enricher Go plugin resolves user > account, injects `x-account-ids` + `x-role-ids` headers, STRIPS user-provided values (anti-spoofing). (2) Controller: default filter `account_id:eq:{header_value}` — "trusted system filter" that bypasses user validation, cannot be overridden by query params. (3) Service: `set_header_context(headers)` extracts IDs, all DB queries scoped to injected account. **Right half — Transactional Outbox Pipeline:** (1) Controller emits domain events via EventBus (in-memory, request-scoped). (2) OutboxMiddleware flushes events to `outbox_events` table in SAME DB transaction as entity. (3) `db.commit()` — atomic: entity + outbox events succeed or fail together. (4) `pg_notify` wakes Outbox Worker instantly (5s poll fallback). (5) Worker publishes to RabbitMQ `messaging` exchange with `routing_key = event_type`. (6) Consumers process events (group message expansion, schedule triggers). Solves dual-write problem, zero event loss. | 2:00 |

### Evolution (Slides 14-16)

| # | Slide | Content | ~Time |
|---|-------|---------|-------|
| 14 | **Section Divider: Evolution** | "Platform Evolution — High-scale dispatch and customer support" | — |
| 15 | **High-Scale Messaging Architecture** | Designed for 1M+ messages/day (~120 msg/sec peak). **Channel Adapter Layer:** pluggable adapter per channel type (SMS/Twilio, SMS/Africa's Talking, Telegram, WhatsApp, SMPP, Messenger, Email). Common interface: `send()`, `verify_credentials()`, `check_health()`, `parse_webhook()`. Adapter registry maps `channel_type + provider` to implementation. **Two-Stage Dispatch Pipeline:** Stage 1 (Fan-out) — Group Message Processor fetches contacts in batches of 1000, renders templates, batch-inserts Message records, publishes N dispatch events. Stage 2 (Per-Channel Dispatch) — channel-specific workers consume from dedicated queues (`message.dispatch.sms`, `message.dispatch.telegram`, etc.), load credentials from Redis cache, check rate limiter, call adapter, update status. **Webhook Receivers:** inbound messages + delivery status updates from providers. Verify HMAC signature, return 200 immediately, enqueue to RabbitMQ for async processing. **Rate Limiting:** 3 levels — per-channel instance (Redis token bucket), per-provider global, per-tenant quota. **SMPP Gateway:** persistent TCP connections to SMSCs, separate from REST-based channels. **Infrastructure additions:** Redis (rate limiting, credential cache, progress counters, dedup), read replicas, table partitioning by month for messages table at scale. | 2:00 |
| 16 | **Conversations & Customer Support** | **New service: turumba_realtime** — standalone Node.js + Socket.IO service. Subscribes to RabbitMQ conversation events, pushes to connected browser clients via WebSocket. Redis adapter for horizontal scaling, presence tracking, typing indicators. Two namespaces: `/agents` (support dashboard) and `/customers` (embeddable widget, future). **Conversation Model:** status lifecycle `open > bot > assigned > pending > resolved > closed`. ContactIdentifier for cross-platform contact resolution (same customer on WhatsApp AND Telegram maps to one contact). CannedResponses with `/shortcode` trigger. **Bot-First Routing (3 phases):** Phase 1 (MVP): rule-based — keyword matching, time-based routing, channel routing, fallback. BotRules evaluated in priority order with auto-reply templates + team assignment. Phase 2: AI-powered intent classification with confidence thresholds. Phase 3: multi-turn conversational bot with knowledge base + handoff to human. **Agent Routing Algorithm:** filter eligible agents by availability + hours + channels + topics + capacity > sort by least active + longest idle > assign. **Inbound Flow:** customer sends message on WhatsApp > webhook > verify signature > enqueue > lookup/create ContactIdentifier > find/create Conversation > create Message > bot router evaluates rules > auto-reply + assign agent > real-time push to agent inbox. | 2:00 |

### Closing (Slides 17-18)

| # | Slide | Content | ~Time |
|---|-------|---------|-------|
| 17 | **Technology Stack** | Compact grid covering all tech: **Gateway** — KrakenD 2.12.1 (Go plugins, Lua scripts). **Backend** — FastAPI (Python 3.11/3.12), SQLAlchemy (async ORM), Motor (MongoDB async). **Auth** — AWS Cognito (JWT RS256), Amplify 6.16. **Databases** — PostgreSQL (relational), MongoDB (documents). **Message Broker** — RabbitMQ (transactional outbox). **Frontend** — Next.js 16 (App Router), TypeScript (strict), Tailwind v4 (oklch tokens). **UI** — Radix UI (accessible primitives), React Hook Form + Zod. **DevOps** — Docker + Compose, GitHub Actions CI/CD, Turborepo. **Quality** — Ruff (Python), ESLint + Prettier (TS), pytest (50-80% coverage). **Planned additions** — Redis (rate limiting, caching, presence), Socket.IO (real-time), Jasmin (SMPP gateway). | 1:00 |
| 18 | **Thank You / Q&A** | Summary: 4 microservices (evolving to 5 with turumba_realtime), 51 API endpoints, 12 data entities, 6 messaging channels, multi-tenant SaaS with 3-layer security, event-driven architecture, designed to scale to millions of messages/day. Questions & discussion. | — |

---

## Visual Design Notes

- **Theme:** Dark navy background (`#0F172A`), section backgrounds (`#141F38`)
- **Accent colors:** Blue (`#389CF7`) for gateway, Teal (`#06B6D4`) for general, Green (`#22C55E`) for account API, Orange (`#F59E0B`) for messaging API, Purple (`#A78BFA`) for patterns, Red (`#EF4444`) for alerts/urgency
- **Cards:** Rounded rectangles with colored borders on dark background
- **Architecture diagrams:** Box-and-arrow style using shapes and text, not images
- **Section dividers:** Number + title + subtitle on dark background with accent bar
- **Consistent layout:** Title bar at top with accent line, content below

## Source Documents

- `docs/WHAT_IS_TURUMBA.md` — Platform overview, architecture diagram, service descriptions, end-to-end flow
- `docs/TURUMBA_MESSAGING.md` — Messages, templates, group messaging, scheduled messages, event infrastructure
- `docs/TURUMBA_DELIVERY_CHANNELS.md` — Channel types, credentials, configuration, lifecycle, API reference
- `docs/HIGH_SCALE_MESSAGING_ARCHITECTURE.md` — Channel adapters, dispatch pipeline, webhook receivers, rate limiting, SMPP, database strategy
- `docs/plans/conversations/ARCHITECTURE.md` — Conversation model, bot routing, agent assignment, turumba_realtime service
- `docs/tasks/conversations/README.md` — Conversation task specs and dependency graph
- `CLAUDE.md` — Architecture patterns, backend conventions, multi-tenancy enforcement
