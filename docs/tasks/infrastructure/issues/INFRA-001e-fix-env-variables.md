# INFRA-001e: Fix and Update Environment Variables

**Repo:** `turumba_gateway`
**Type:** Bug Fix + Infrastructure
**Priority:** P0
**Labels:** `bug`, `enhancement`, `P0`
**Depends On:** None (can be done independently)
**Task Spec:** [INFRA-001 — Dockerize Messaging Workers](../INFRA-001-dockerize-messaging-workers.md)

---

## GitHub Issue Title

`[Infra] Fix ACCOUNT_API_BASE_URL and add worker environment variables`

---

## GitHub Issue Body

```markdown
## [Infra] Fix Environment Variables for Docker Deployment

### Business Goal
There is a bug in `.env.messaging-api`: `ACCOUNT_API_BASE_URL` is set to `http://localhost:8001`, which does not resolve inside Docker containers. This breaks cross-service communication (message enrichment, group message processing) in any Docker-based deployment. Additionally, worker-specific tuning variables and the worker image reference need to be added for the new worker services.

### The Bug

In `.env.messaging-api`:
```
ACCOUNT_API_BASE_URL=http://localhost:8001
```

Inside Docker, `localhost` refers to the container itself — not the host machine. The messaging API and workers cannot reach the Account API at this address. The correct value uses the Docker container name on the shared `gateway-network`:

```
ACCOUNT_API_BASE_URL=http://gt_turumba_account_api:8000
```

This bug affects:
- Message list/detail enrichment (account, contact, user embedding)
- Group message processor (resolves contact groups from Account API)
- Any worker or API code that calls `AccountApiClient`

### Acceptance Criteria

**Bug Fix (`.env.messaging-api`):**
- [ ] `ACCOUNT_API_BASE_URL` changed from `http://localhost:8001` to `http://gt_turumba_account_api:8000`

**New Variables (`.env`):**
- [ ] `MESSAGING_WORKER_IMAGE=bengeos/turumba-messaging-worker:main` added
- [ ] `RABBITMQ_PORT=5672` added
- [ ] `RABBITMQ_MGMT_PORT=15672` added
- [ ] `RABBITMQ_USER=guest` added
- [ ] `RABBITMQ_PASS=guest` added

**Worker Tuning (`.env.messaging-api`):**
- [ ] `DISPATCH_MAX_RETRIES=3` added (optional, has default in config.py)
- [ ] `DISPATCH_PREFETCH_COUNT=10` added (optional, has default in config.py)
- [ ] `SCHEDULE_POLL_INTERVAL=10` added (optional, has default in config.py)
- [ ] `SCHEDULE_BATCH_SIZE=50` added (optional, has default in config.py)

**Verification:**
- [ ] `docker compose up -d` — messaging API can reach Account API
- [ ] Message list endpoint returns enriched responses (account/contact/user data populated, not null)

### Implementation

#### `.env` — Add at the end:
```env
# Worker Image
MESSAGING_WORKER_IMAGE=bengeos/turumba-messaging-worker:main

# RabbitMQ
RABBITMQ_PORT=5672
RABBITMQ_MGMT_PORT=15672
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
```

#### `.env.messaging-api` — Fix and add:
```env
## Messaging API Database
DATABASE_URL=${POSTGRES_DB}/turumba_messages_dev?sslmode=require
MONGODB_URL=${MONGO_DB}/turumba_messaging?authSource=admin
MONGODB_DB_NAME=turumba_messages_dev

## RabbitMQ
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/
RABBITMQ_EXCHANGE=messaging
RABBITMQ_PREFETCH_COUNT=10

## Outbox Worker
OUTBOX_POLL_INTERVAL=5
OUTBOX_BATCH_SIZE=100
OUTBOX_CLEANUP_DAYS=7

# Microservices URLs
ACCOUNT_API_BASE_URL=http://gt_turumba_account_api:8000

## Worker Tuning
DISPATCH_MAX_RETRIES=3
DISPATCH_PREFETCH_COUNT=10
SCHEDULE_POLL_INTERVAL=10
SCHEDULE_BATCH_SIZE=50
```

### Dependencies
- None — environment variable changes are independent

### Out of Scope
- Doppler secret management integration (tracked separately: turumba_messaging_api#26)
- Production environment variable values
- `.env.example` template updates in individual service repos

### Priority
| Priority | Complexity |
|----------|------------|
| P0 | Simple |
```
