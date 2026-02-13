# Building a Multi-Service SaaS Platform With an Agentic AI Workflow

*How I used Claude Code as my development partner to architect, plan, and ship Turumba 2.0 — a multi-tenant message automation platform — with a small team in record time.*

---

## The Challenge

I set out to build **Turumba 2.0**, a multi-tenant message automation platform that lets organizations send SMS, Telegram, WhatsApp, Email, and other channel messages at scale — with group messaging, scheduled delivery, and template-based personalization.

The platform is not a single app. It is four separate repositories working together:

- **Account API** — FastAPI service for users, accounts, roles, contacts, and authentication (Python, PostgreSQL, MongoDB, AWS Cognito)
- **Messaging API** — FastAPI service for channels, messages, templates, group messages, scheduled messages, and an event-driven outbox (Python, PostgreSQL, RabbitMQ)
- **API Gateway** — KrakenD gateway with a custom Go plugin for context enrichment (51 endpoints, request-level tenant isolation)
- **Web Core** — Turborepo monorepo with Next.js 16 frontend applications (TypeScript, React 19, Tailwind CSS 4)

Building this with a team of 3-4 developers under tight timelines would normally require a senior architect doing weeks of upfront design, writing hundreds of Jira tickets, and constantly context-switching between services. Instead, I tried something different.

---

## The Agentic Approach

I used **Claude Code** — Anthropic's CLI-based AI agent — as a persistent development partner throughout the entire lifecycle: architecture design, documentation, task specification, code review guidance, and project coordination. Not as a chatbot I ask questions to, but as an agent that operates directly in my codebase.

Here is what that looks like in practice.

### 1. A Central Codebase as a Command Center

All four repositories live under a single parent directory. I created a `CLAUDE.md` file at the root — a structured instruction file that Claude Code reads automatically — containing:

- The full architecture (gateway routing, context enrichment, backend patterns, frontend stack)
- Database models and conventions across services
- Common commands for every service (run, test, lint, migrate)
- Code quality standards and CI/CD configuration
- The CRUDController pattern with its non-obvious multi-tenancy behaviors

This file is not documentation for humans. It is a **system prompt for the agent**. When I open Claude Code in this directory, it immediately understands the entire platform — how services talk to each other, what patterns to follow, what conventions exist.

### 2. Architecture-First Documentation

Before writing any code, I worked with Claude Code to produce detailed platform documentation:

- **WHAT_IS_TURUMBA.md** — A complete product specification: every feature, every channel type, every user workflow, the full architecture diagram, and the technology stack
- **TURUMBA_MESSAGING.md** — The messaging system spec covering messages, templates, group messaging, scheduled messages, and the event infrastructure with transactional outbox
- **TURUMBA_DELIVERY_CHANNELS.md** — Channel types, credential schemas, configuration lifecycle, and the full API reference

These documents serve a dual purpose. They are the **product spec** that developers reference, and they are the **context** that the AI agent uses when generating task specifications later. The agent does not hallucinate features because the features are precisely defined in documents it can read.

### 3. AI-Generated Task Specifications

This is where the agentic approach delivers the most value.

Instead of manually writing Jira tickets or GitHub issues, I describe what I need at a high level and let Claude Code generate detailed task specifications. Each spec follows a consistent format:

```
Task ID | Title | Service | Assignee | GitHub Issue Link
─────────────────────────────────────────────────────────
Summary (what and why)
Database model (exact column definitions, types, constraints)
Schema definitions (create, update, response, list)
Controller configuration (filters, sorts, schema mapping)
Router endpoints (HTTP methods, paths, request/response)
Step-by-step implementation checklist
Testing requirements
Definition of done
```

For example, **BE-001: Implement Messages CRUD API** is not a vague ticket that says "build the messages endpoint." It includes the exact SQLAlchemy model with every column, type, and index; the Pydantic schemas for creation, update, and response; the filter/sort configuration; the router with all five endpoints; and a precise implementation checklist.

A developer — even a junior one — can pick up this spec and implement it without asking a single clarifying question. The spec *is* the clarification.

I generated **16 task specifications** this way (6 backend, 10 frontend), each one referencing the architecture docs and following the patterns established in `CLAUDE.md`. The entire set was produced in a fraction of the time it would take to write manually, and with far more consistency and detail.

### 4. From Spec to Implementation in Days

Here is the timeline that resulted from this workflow:

| Date | Milestone |
|------|-----------|
| Feb 8 | Messaging API core architecture + dual database setup done |
| Feb 9 | Alembic + pre-commit + pytest infrastructure done |
| Feb 11 | BE-001 (Messages) and BE-002 (Channels) CRUD complete and closed |
| Feb 11 | Core auth pages (Sign In, Sign Up, Email Verify) shipped in web core |
| Feb 11 | Async SQLAlchemy migration completed |
| Feb 12 | BE-003 (Templates), BE-004 (Group Messages), BE-005 (Scheduled Messages) all closed |
| Feb 12 | Generic Table Builder component shipped |
| Feb 12 | Extended auth pages (Forgot/Reset/2FA) shipped |
| Feb 13 | Full project audit complete, 51 gateway endpoints configured |

**Five complete CRUD entities** — each with model, schema, controller, service, router, and tests — were implemented and merged in **four days**. The messaging API went from zero domain models to a fully functional service with 80% test coverage.

This speed is not because the developers wrote sloppy code. It is because the specifications were so precise that implementation became an execution task rather than a design task. The thinking was done upfront, by the agent, validated by me.

### 5. Project Auditing and Status Tracking

As the project progressed, I used Claude Code to audit the actual state of every repository — not what we *planned* to build, but what *actually exists* in the code:

- Read every `main.py` to verify which routers are registered
- Check every model file to confirm which database columns exist
- Cross-reference GitHub issues with task specs to build a **task-to-issue-to-implementation matrix**
- Identify gaps (like the event infrastructure being built but not wired into services)

The result is `PROJECT_STATUS.md` — a living document that shows the true state of every entity across every service, with links to the relevant task specs and GitHub issues. This is the kind of document that normally goes stale within a week. With an agentic workflow, regenerating it takes minutes.

### 6. Automated Code Review With Claude Code Action

This is the part that closes the loop. Writing specs is one thing — making sure the implementation *matches* the specs is another. I integrated **Claude Code Action** into GitHub Actions so that every pull request is automatically reviewed against the project's architecture.

#### The Setup: Two Workflows Per Repository

Each backend repository has two GitHub Actions workflows:

**`claude-code-review.yml` — Automatic review on every PR.** When a developer opens or updates a pull request, Claude reads the diff, checks out the full codebase, and posts inline comments and a summary. This runs without any human trigger.

**`claude.yml` — Interactive review via `@claude` mentions.** When I comment `@claude please review` on a PR, Claude performs a targeted review responding to my specific request. This is how I ask follow-up questions, request re-reviews after fixes, or ask Claude to assess whether a specific concern has been addressed.

#### The Review Prompt: Architecture-Aware, Not Generic

The key to making automated review useful is the prompt. A generic "review this code" instruction produces generic feedback. My review prompt is **120+ lines of architecture context** embedded directly in the workflow file. It teaches Claude the ten critical patterns that every PR must follow:

```yaml
prompt: |
  You are a senior code reviewer for the Turumba 2.0 messaging platform...

  ## System Architecture Context
  The messaging API sits behind a KrakenD gateway that enriches every
  authenticated request:
  - Gateway calls Account API /context/basic, injects x-account-ids headers
  - These headers are trusted system values — the gateway strips user-provided values
  - Backend services use these headers for multi-tenant scoping

  ## Critical Patterns to Enforce
  1. CRUDController Base Class — all controllers MUST extend it
  2. Multi-Tenant Account Scoping — every query MUST be scoped to x-account-ids
  3. Filter/Sort Configuration — whitelist of allowed filters per entity
  4. Schema Conventions — PATCH must use exclude_unset=True, NOT exclude_none=True
  5. Async Database Operations — never block the event loop with sync calls
  6. PostgreSQL Models — use sa.Uuid(as_uuid=True), not sa.UUID()
  7. Alembic Migrations — column types must match model definitions exactly
  8. Testing Standards — 80% coverage, shared fixtures in conftest.py
  9. Domain-Specific Rules — status lifecycles, credential handling, template variables
  10. Code Quality — Ruff, proper error chaining, no hardcoded config

  ## Review Checklist
  Prioritize issues as:
  - Critical: Breaks functionality, data leaks, tenant isolation bypass
  - High: Architectural violations, missing validation, code duplication
  - Medium: Missing tests, inconsistent types, missing indexes
  - Low: Style, naming, documentation
```

This prompt evolved over three iterations. The first version was a generic `code-review` plugin. The second added auto-review and `@claude` interactive jobs. The third — the current one — replaced the generic prompt with deep architecture context covering all ten critical patterns. The quality difference was immediate and dramatic.

#### Real Review Interactions: What This Looks Like in Practice

Here are actual examples from our PRs that show the multi-round review loop between the automated reviewer, the developer, and me.

**Example 1: Claude catches a real authentication bug (Account API, PR #52)**

A developer submitted a PR to support multiple Cognito client IDs. Claude's automatic review found a critical bug:

> **Bug**: AWS Cognito access tokens do not contain an `aud` (audience) claim — they use `client_id` instead. The code at lines 117-120 will reject all valid access tokens when `verify_audience` is `True`.

This was a genuine production bug that would have broken authentication for every user. Claude suggested the fix: `token_audience = payload.get("aud") or payload.get("client_id")`. The developer applied it, and the PR was merged safely.

**Example 2: Multi-tenant security bypass detected (Messaging API, PR #17)**

Claude's inline review flagged a critical issue in the Group Messages controller:

> **CRITICAL**: User-provided `account_id` filter can replace system scope filter via `_merge_filters`. Attack vector: `GET /v1/group-messages/?filter=account_id:eq:<other_tenant_uuid>`.

I confirmed this finding in my own review and requested changes. The developer added `_validate_account_id_in_filters()` to prevent user-provided filters from overriding the system-injected tenant scope. After the fix, I triggered a re-review:

> `@claude what do you say about my last comment about MessageController.get_all() and count() skip filter/sort normalization`

Claude verified the fix was correct and confirmed the security gap was closed.

**Example 3: SQL injection vulnerability caught (Messaging API, PR #24)**

When I submitted the event infrastructure PR (the outbox pattern for RabbitMQ), Claude's automatic review found:

> **CRITICAL**: SQL injection vulnerability in `pg_notify.py` — f-string SQL construction allows arbitrary SQL execution.

Along with several other findings: event loop blocking in `_process_batch()`, `asyncio.get_event_loop()` misuse inside async methods, and blocking `select.select()` calls in async context. All were legitimate issues that I fixed before merging.

**Example 4: The multi-round review loop (Account API, PR #51)**

This PR had the richest review interaction — **seven rounds** between Cursor Bugbot, Claude, and me:

1. **Cursor Bugbot** found a multi-tenant bypass in person-contact retrieval methods
2. **Claude automatic review** found missing type hints
3. **I fixed both**, then commented: `@claude please review`
4. **Claude** verified the fixes and found *additional* issues: a security gap in the delete operation where deletion by ID skipped account filtering
5. **I fixed Claude's findings**, then: `@claude please re-review`
6. **Claude** confirmed the delete operation now enforces tenant isolation
7. **I triggered a final review**: `@claude please review` — Claude responded: "All critical issues addressed. **Recommendation: Approve and merge.**"

This is the pattern I use most: let the automated review catch the first wave of issues, fix them, then use `@claude please review` to verify the fixes and catch anything the first pass missed. Each round goes deeper.

**Example 5: Claude learns from architectural context (Account API, PR #44)**

Claude's initial review flagged a security vulnerability in the role controller — that user-provided filters could override the `account_id` security filter via `_merge_filters`. I responded:

> "This is a microservice application where the `account_id` header is set by KrakenD from a context provider. External users cannot pass this value through the request header — the gateway strips any user-provided values."

Claude acknowledged the correction, updated its assessment, and suggested documentation improvements instead:

> "You're correct that my initial security concern doesn't apply to your deployment model... Consider adding a comment in `src/controllers/base.py` to document that `x-account-ids` is gateway-controlled."

The agent does not stubbornly insist on false positives. It adapts when given architectural context.

#### How I Use Claude Reviews to Make Merge Decisions

My workflow for deciding when to merge a PR:

1. **Automated review fires** when the developer opens the PR — I read Claude's findings in the PR comments
2. **Developer addresses the feedback** — they push new commits fixing the issues
3. **I comment `@claude please review`** — Claude re-reviews the latest code and confirms whether the issues are resolved
4. **Claude provides a summary** — a structured compliance table checking all ten critical patterns, with a clear approve/request-changes recommendation
5. **I read the summary** and make the merge decision — Claude's structured review lets me understand the PR's state without reading every line of diff myself

This is particularly valuable for large PRs. When a developer submits a 1,500-line PR implementing a full CRUD entity, Claude's structured summary tells me: "Multi-tenant scoping: enforced. Async operations: correct. Filter config: present. Test coverage: 85%. Schema conventions: `exclude_unset=True` used correctly." I can focus my human review on the architectural decisions rather than line-by-line syntax checks.

#### The Prompt Evolution: Three Iterations

The review prompt was not good from the start. It evolved:

**Version 1** — Generic `code-review` plugin. Produced surface-level feedback: missing docstrings, unused imports. Not useful for architectural enforcement.

**Version 2** — Custom prompt with auto-review + interactive `@claude` jobs. Better structure, but the prompt lacked codebase-specific context. Claude could not distinguish between intentional patterns and accidental violations.

**Version 3** — 120+ lines of architecture context covering all ten critical patterns, the full directory structure, and domain-specific rules for each entity. This is where the reviews became genuinely useful — Claude now catches multi-tenant bypasses, async violations, and migration inconsistencies because it *knows what correct looks like* for this specific codebase.

The lesson: **the review prompt is as important as `CLAUDE.md`.** Both are instructions that teach the agent your specific patterns. The more precise you are, the more useful the agent becomes.

---

## What Makes This "Agentic" and Not Just "Using AI"

The distinction matters. Using AI means asking ChatGPT "how do I build a messaging API?" and getting a generic tutorial. An agentic workflow means the AI operates *inside your project*, reads your actual code, follows your actual patterns, and produces artifacts that plug directly into your development process.

Specifically:

**Context persistence** — Claude Code reads `CLAUDE.md` and understands the full architecture every time I start a session. It knows that the gateway injects `x-account-ids` headers, that controllers use a `FilterSortConfig`, that metadata columns use `metadata_` to avoid Python keyword conflicts. This is not generic advice; it is advice grounded in *my* codebase.

**Multi-file awareness** — When generating a task spec for "Messages CRUD," the agent references the existing Channel model to ensure foreign key consistency, the existing CRUDController base class for the right inheritance pattern, and the existing router registration in `main.py` to show exactly where to add the new router.

**Artifact production** — The output is not conversation. It is files: markdown specs that get committed to the repo, status documents that get published to the docs site, issue descriptions that get pasted into GitHub. The agent produces *deliverables*, not *responses*.

**Iterative refinement** — I review every artifact. When a task spec misses a database index, I tell the agent and it fixes the spec. When a status audit shows an inconsistency with the actual code, we resolve it together. The agent is a collaborator, not an oracle.

---

## The Team Dynamic

This approach changed how I work with my team:

- **I (tech lead)** work with Claude Code to design the architecture, write documentation, generate task specs, audit progress, and make final merge decisions informed by AI-generated review summaries
- **Backend developer** picks up task specs (BE-001 through BE-006), creates a branch, implements exactly what the spec says, opens a PR, and responds to automated Claude review feedback
- **Frontend developer** picks up frontend specs (FE-001 through FE-010) with the same precision
- **Claude Code Action** reviews every PR automatically, then I trigger targeted re-reviews with `@claude please review` after the developer addresses feedback
- **GitHub Issues** link each task spec to a trackable issue with clear acceptance criteria

The developers do not need to attend lengthy design meetings or ask "what should the schema look like?" The spec answers every question. And when they submit a PR, they get immediate architectural feedback before I even look at it. By the time I review, the obvious issues are already fixed, and I can focus on the design decisions that require human judgment.

---

## Lessons Learned

**Invest heavily in `CLAUDE.md`.** The quality of everything the agent produces is directly proportional to the quality of the instructions you give it. My `CLAUDE.md` is 300+ lines of precise architectural context. That investment pays dividends on every subsequent interaction.

**Documentation is not overhead — it is infrastructure.** The architecture docs I wrote *with* the agent became the foundation for every task spec, every audit, and every status report. When documentation is machine-readable, it compounds.

**Specs should be executable, not descriptive.** The difference between "implement a messages endpoint" and a spec with exact column definitions, schema shapes, and a step-by-step checklist is the difference between a developer spending two days figuring out the design versus spending two days writing code.

**Audit frequently.** Code drifts from plans. Having an agent that can read every file across four repositories and produce an accurate status matrix in minutes means you always know where you actually stand — not where you hope you stand.

**Automated review needs architecture context to be useful.** A generic "review this code" prompt produces generic feedback. When I embedded 120 lines of architecture patterns — multi-tenant scoping rules, async requirements, schema conventions, domain-specific lifecycles — into the review prompt, Claude started catching real security vulnerabilities and architectural violations. The prompt *is* the reviewer's expertise.

**Use `@claude` for multi-round review loops.** The most effective pattern is: automated review catches the first wave, the developer fixes, then I trigger `@claude please review` to verify fixes and catch deeper issues. Each round goes deeper. On one PR, this loop ran seven rounds and caught a tenant isolation gap in the delete operation that neither the automated review nor I had noticed initially.

**The agent is not a replacement for judgment.** Every spec, every architectural decision, every review summary goes through my review. The agent accelerates the *production* of these artifacts by 10x. The *thinking* behind them is still mine. When Claude flagged a false positive about a security concern, I explained the gateway architecture, and it adapted. The agent learns from corrections — but I have to be there to make them.

---

## The Numbers

| Metric | Value |
|--------|-------|
| Services | 4 repositories |
| Backend entities (full CRUD) | 11 (6 account + 5 messaging) |
| Gateway endpoints | 51 |
| Task specifications generated | 16 (6 BE + 10 FE) |
| GitHub issues tracked | 46+ across all repos |
| Pull requests reviewed by Claude | 30+ across all repos |
| Critical bugs caught by automated review | SQL injection, auth bypass, tenant isolation gaps |
| Review prompt iterations | 3 (generic → structured → architecture-aware) |
| Test coverage | 50-80% enforced per service |
| Team size | 3-4 developers |
| Time from zero to functional messaging API | 4 days |

---

## What I Would Tell Other Tech Leads

If you are building a multi-service platform with a small team, the agentic approach is not about replacing developers. It is about removing the bottleneck that *you* represent.

As a tech lead, the most valuable thing you produce is not code — it is clarity. Clear architecture. Clear specs. Clear status. An agentic AI workflow lets you produce that clarity at a pace that matches your team's ability to consume it.

The developers on my team never waited for a spec. The specs were ready before they finished the previous task. That is what changes when your design process runs at the speed of thought rather than the speed of typing.

---

*Built with [Claude Code](https://claude.ai/code) by Anthropic.*
