# INFRA-001: Dockerize Messaging API Workers

**Type:** Infrastructure / DevOps
**Services:** turumba_messaging_api, turumba_gateway
**Priority:** P0
**Feature Area:** Worker Orchestration & Deployment
**Depends On:** [HSM-002 — Dispatch Pipeline](../high-scale-messaging/HSM-002-dispatch-pipeline.md) (workers exist), [BE-006 — Event Infrastructure](../messaging/BE-006-event-outbox-rabbitmq.md) (outbox worker)

---

## Summary

The messaging API has 4 worker processes — `outbox_worker`, `dispatch_worker`, `group_message_processor`, and `schedule_trigger` — that currently run as standalone Python CLI processes with no Docker orchestration. The deploy workflow (`docker compose up -d`) only starts the API server. Workers must be manually started, which is unreliable and unscalable.

This task adds worker services to the gateway's `docker-compose.yml`, adds RabbitMQ as infrastructure, and creates a dedicated worker Docker image with its own CI build pipeline — tagged the same way as the API image (branch-based tags via GitHub Actions).

**After this task, `docker compose up -d` brings up the full platform: gateway, both APIs, RabbitMQ, and all 10 worker processes.**

---

## Architecture: Before vs. After

### Before (Current)

```
docker compose up -d
  ├── krakend-gateway        (port 8080)
  ├── gt_turumba_account_api (port 5002→8000)
  └── gt_turumba_messaging_api (port 5001→8000)

# Workers must be started manually:
python -m src.workers.outbox_worker
python -m src.workers.dispatch_worker --channel-type telegram
python -m src.workers.group_message_processor
python -m src.workers.schedule_trigger
```

No RabbitMQ in compose. No worker containers. Workers run ad-hoc on developer machines or must be manually orchestrated on servers.

### After (Target)

```
docker compose up -d
  ├── krakend-gateway              (port 8080)
  ├── gt_turumba_account_api       (port 5002→8000)
  ├── gt_turumba_messaging_api     (port 5001→8000)
  ├── rabbitmq                     (ports 5672, 15672)
  ├── gt_outbox_worker
  ├── gt_group_message_processor
  ├── gt_schedule_trigger
  ├── gt_dispatch_worker_sms
  ├── gt_dispatch_worker_smpp
  ├── gt_dispatch_worker_telegram
  ├── gt_dispatch_worker_whatsapp
  ├── gt_dispatch_worker_messenger
  └── gt_dispatch_worker_email
```

14 services total. Single command. RabbitMQ health-gated startup.

---

## Files to Create/Modify (5 files)

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `turumba_messaging_api/Dockerfile.worker` | **Create** | Worker-specific Dockerfile (no port exposure, no CMD) |
| 2 | `turumba_messaging_api/.github/workflows/docker-build-worker.yml` | **Create** | CI workflow to build and push worker image |
| 3 | `turumba_gateway/docker-compose.yml` | **Modify** | Add RabbitMQ, YAML anchor, 10 worker services, volume |
| 4 | `turumba_gateway/.env` | **Modify** | Add `MESSAGING_WORKER_IMAGE`, RabbitMQ vars |
| 5 | `turumba_gateway/.env.messaging-api` | **Modify** | Fix `ACCOUNT_API_BASE_URL` bug, add worker tuning vars |

---

## Implementation Details

### Step 1: Create Worker Dockerfile

**File:** `turumba_messaging_api/Dockerfile.worker`

Same base as the API Dockerfile but without port exposure and with no default CMD. CMD will be set per-service in docker-compose. This separates concerns — the API image runs uvicorn, the worker image runs worker processes.

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/

# No EXPOSE — workers don't serve HTTP
# No CMD — command set per worker in docker-compose
```

**Why a separate Dockerfile?** The API image includes `EXPOSE 8000` and a uvicorn CMD. Workers don't need either. A separate file makes the purpose explicit, avoids confusion, and allows divergent dependencies in the future (e.g., workers might need additional packages for adapter SDKs).

---

### Step 2: Create Worker CI Build Workflow

**File:** `turumba_messaging_api/.github/workflows/docker-build-worker.yml`

Mirrors the existing `docker-build.yml` pattern but builds `Dockerfile.worker` and pushes to a separate Docker Hub repository.

```yaml
name: Build Worker Docker Image

on:
  push:
    branches:
      - main
      - master
      - feature/*
      - release/*

  pull_request:
    branches:
      - main
      - master
      - feature/*
      - release/*

env:
  DOCKER_USERNAME: ${{ secrets.DOCKER_USERNAME }}
  IMAGE_NAME: ${{ secrets.DOCKER_USERNAME }}/turumba-messaging-worker

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Extract metadata (tags, labels) for Docker
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            # Tag with branch name (e.g., main, feature/xyz)
            type=ref,event=branch

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile.worker
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**Differences from `docker-build.yml`:**
- `IMAGE_NAME` → `turumba-messaging-worker` (not `turumba-messaging-api`)
- `file: Dockerfile.worker` specified explicitly
- Same trigger branches, same tag strategy, same secrets

---

### Step 3: Add RabbitMQ to Gateway Compose

**File:** `turumba_gateway/docker-compose.yml`

Add RabbitMQ as a service with the management plugin for queue/consumer visibility:

```yaml
rabbitmq:
  image: rabbitmq:3.13-management-alpine
  container_name: rabbitmq
  platform: linux/amd64
  restart: unless-stopped
  ports:
    - "${RABBITMQ_PORT:-5672}:5672"
    - "${RABBITMQ_MGMT_PORT:-15672}:15672"
  environment:
    RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-guest}
    RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-guest}
  volumes:
    - rabbitmq_data:/var/lib/rabbitmq
  networks:
    - gateway-network
  healthcheck:
    test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
```

Management UI accessible at `localhost:15672` (default credentials `guest`/`guest`).

Add named volume at the bottom of the file:

```yaml
volumes:
  rabbitmq_data:
```

---

### Step 4: Add Worker Services via YAML Anchor

**File:** `turumba_gateway/docker-compose.yml`

Define a shared anchor to avoid duplicating configuration across 10 worker services:

```yaml
x-messaging-worker: &messaging-worker-base
  image: ${MESSAGING_WORKER_IMAGE}
  platform: linux/amd64
  restart: unless-stopped
  env_file:
    - .env
    - .env.messaging-api
  networks:
    - gateway-network
  depends_on:
    rabbitmq:
      condition: service_healthy
  stop_grace_period: 30s
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
```

Then define 10 worker services using the anchor:

| Service | Container Name | Command |
|---------|---------------|---------|
| `outbox_worker` | `gt_outbox_worker` | `python -m src.workers.outbox_worker` |
| `group_message_processor` | `gt_group_message_processor` | `python -m src.workers.group_message_processor` |
| `schedule_trigger` | `gt_schedule_trigger` | `python -m src.workers.schedule_trigger` |
| `dispatch_worker_sms` | `gt_dispatch_worker_sms` | `python -m src.workers.dispatch_worker --channel-type sms` |
| `dispatch_worker_smpp` | `gt_dispatch_worker_smpp` | `python -m src.workers.dispatch_worker --channel-type smpp` |
| `dispatch_worker_telegram` | `gt_dispatch_worker_telegram` | `python -m src.workers.dispatch_worker --channel-type telegram` |
| `dispatch_worker_whatsapp` | `gt_dispatch_worker_whatsapp` | `python -m src.workers.dispatch_worker --channel-type whatsapp` |
| `dispatch_worker_messenger` | `gt_dispatch_worker_messenger` | `python -m src.workers.dispatch_worker --channel-type messenger` |
| `dispatch_worker_email` | `gt_dispatch_worker_email` | `python -m src.workers.dispatch_worker --channel-type email` |

**Example service definition:**
```yaml
outbox_worker:
  <<: *messaging-worker-base
  container_name: gt_outbox_worker
  command: ["python", "-m", "src.workers.outbox_worker"]

dispatch_worker_telegram:
  <<: *messaging-worker-base
  container_name: gt_dispatch_worker_telegram
  command: ["python", "-m", "src.workers.dispatch_worker", "--channel-type", "telegram"]
```

**Special case — `group_message_processor`:** Gets an additional `depends_on` for `turumba_account_api` since it makes HTTP calls to the Account API to resolve contact groups:

```yaml
group_message_processor:
  <<: *messaging-worker-base
  container_name: gt_group_message_processor
  command: ["python", "-m", "src.workers.group_message_processor"]
  depends_on:
    rabbitmq:
      condition: service_healthy
    turumba_account_api:
      condition: service_started
```

**Why one service per dispatch channel type?** Each dispatch worker takes a `--channel-type` argument. Different channel types have different throughput characteristics, rate limits, and failure modes (e.g., Telegram rate limits vs. SMS gateway throughput). Separate services allow independent scaling, stopping, and log inspection. Using `replicas` is not possible because each replica would need a different CLI argument.

---

### Step 5: Update Messaging API Dependency on RabbitMQ

**File:** `turumba_gateway/docker-compose.yml`

The messaging API itself connects to RabbitMQ (for the outbox worker's pg_notify channel setup). Add a `depends_on` to its service definition:

```yaml
turumba_messaging_api:
  image: ${MESSAGING_API_IMAGE}
  container_name: gt_turumba_messaging_api
  platform: linux/amd64
  restart: unless-stopped
  env_file:
    - .env
    - .env.messaging-api
  networks:
    - gateway-network
  ports:
    - "${MESSAGING_API_PORT}:8000"
  depends_on:
    rabbitmq:
      condition: service_healthy
```

---

### Step 6: Environment Variable Updates

#### `turumba_gateway/.env` — Add worker image and RabbitMQ vars

```env
MESSAGING_WORKER_IMAGE=bengeos/turumba-messaging-worker:main

RABBITMQ_PORT=5672
RABBITMQ_MGMT_PORT=15672
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
```

#### `turumba_gateway/.env.messaging-api` — Fix bug + add worker tuning

**Bug fix:** `ACCOUNT_API_BASE_URL` currently points to `localhost:8001`, which doesn't resolve inside Docker containers. Workers and the API need the Docker container name:

```env
# BEFORE (broken in Docker):
ACCOUNT_API_BASE_URL=http://localhost:8001

# AFTER (correct for Docker networking):
ACCOUNT_API_BASE_URL=http://gt_turumba_account_api:8000
```

**Add optional worker tuning vars** (these have defaults in `src/config/config.py`):

```env
## Worker Tuning
DISPATCH_MAX_RETRIES=3
DISPATCH_PREFETCH_COUNT=10
SCHEDULE_POLL_INTERVAL=10
SCHEDULE_BATCH_SIZE=50
```

---

## Complete docker-compose.yml (Target State)

For reference, the complete target state of the compose file:

```yaml
x-messaging-worker: &messaging-worker-base
  image: ${MESSAGING_WORKER_IMAGE}
  platform: linux/amd64
  restart: unless-stopped
  env_file:
    - .env
    - .env.messaging-api
  networks:
    - gateway-network
  depends_on:
    rabbitmq:
      condition: service_healthy
  stop_grace_period: 30s
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"

services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    container_name: rabbitmq
    platform: linux/amd64
    restart: unless-stopped
    ports:
      - "${RABBITMQ_PORT:-5672}:5672"
      - "${RABBITMQ_MGMT_PORT:-15672}:15672"
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-guest}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS:-guest}
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    networks:
      - gateway-network
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  turumba_messaging_api:
    image: ${MESSAGING_API_IMAGE}
    container_name: gt_turumba_messaging_api
    platform: linux/amd64
    restart: unless-stopped
    env_file:
      - .env
      - .env.messaging-api
    networks:
      - gateway-network
    ports:
      - "${MESSAGING_API_PORT}:8000"
    depends_on:
      rabbitmq:
        condition: service_healthy

  turumba_account_api:
    image: ${ACCOUNT_API_IMAGE}
    container_name: gt_turumba_account_api
    platform: linux/amd64
    restart: unless-stopped
    env_file:
      - .env
      - .env.account-api
    networks:
      - gateway-network
    ports:
      - "${ACCOUNT_API_PORT}:8000"

  outbox_worker:
    <<: *messaging-worker-base
    container_name: gt_outbox_worker
    command: ["python", "-m", "src.workers.outbox_worker"]

  group_message_processor:
    <<: *messaging-worker-base
    container_name: gt_group_message_processor
    command: ["python", "-m", "src.workers.group_message_processor"]
    depends_on:
      rabbitmq:
        condition: service_healthy
      turumba_account_api:
        condition: service_started

  schedule_trigger:
    <<: *messaging-worker-base
    container_name: gt_schedule_trigger
    command: ["python", "-m", "src.workers.schedule_trigger"]

  dispatch_worker_sms:
    <<: *messaging-worker-base
    container_name: gt_dispatch_worker_sms
    command: ["python", "-m", "src.workers.dispatch_worker", "--channel-type", "sms"]

  dispatch_worker_smpp:
    <<: *messaging-worker-base
    container_name: gt_dispatch_worker_smpp
    command: ["python", "-m", "src.workers.dispatch_worker", "--channel-type", "smpp"]

  dispatch_worker_telegram:
    <<: *messaging-worker-base
    container_name: gt_dispatch_worker_telegram
    command: ["python", "-m", "src.workers.dispatch_worker", "--channel-type", "telegram"]

  dispatch_worker_whatsapp:
    <<: *messaging-worker-base
    container_name: gt_dispatch_worker_whatsapp
    command: ["python", "-m", "src.workers.dispatch_worker", "--channel-type", "whatsapp"]

  dispatch_worker_messenger:
    <<: *messaging-worker-base
    container_name: gt_dispatch_worker_messenger
    command: ["python", "-m", "src.workers.dispatch_worker", "--channel-type", "messenger"]

  dispatch_worker_email:
    <<: *messaging-worker-base
    container_name: gt_dispatch_worker_email
    command: ["python", "-m", "src.workers.dispatch_worker", "--channel-type", "email"]

  krakend:
    image: bengeos/turumba-gateway:latest
    container_name: krakend-gateway
    platform: linux/amd64
    restart: unless-stopped
    ports:
      - "${APP_PORT}:8080"
    volumes:
      - ./config:/etc/krakend/config
    environment:
      - FC_ENABLE=1
      - FC_PARTIALS=/etc/krakend/config/partials
    command: ["run", "-c", "/etc/krakend/config/krakend.tmpl"]
    networks:
      - gateway-network
    depends_on:
      - turumba_messaging_api
      - turumba_account_api

networks:
  gateway-network:
    driver: bridge

volumes:
  rabbitmq_data:
```

---

## Startup Order

```
1. rabbitmq               → starts, health check begins (30s start_period)
2. turumba_account_api    → starts immediately (no RabbitMQ dependency)
3. rabbitmq healthy       → unlocks all workers + messaging API
4. turumba_messaging_api  → starts (depends on rabbitmq healthy)
5. outbox_worker, schedule_trigger, dispatch_worker_* → start
6. group_message_processor → starts (depends on rabbitmq healthy + account_api started)
7. krakend                → starts (depends on both APIs started)
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Worker image** | Separate `Dockerfile.worker` + CI pipeline | Independent versioning, no uvicorn/port overhead, clear separation |
| **Image tag strategy** | Branch-based (`:main`, `:feature-x`) | Matches existing API image pattern from `docker-build.yml` |
| **RabbitMQ** | In compose with management plugin | Single `docker compose up` brings everything up; mgmt UI for debugging |
| **Dispatch workers** | One service per channel type | Different CLI args, independent scaling/stopping, different rate-limit profiles |
| **Health checks** | None for workers (rely on `restart: unless-stopped`) | No HTTP endpoint to probe; RabbitMQ mgmt UI shows consumer counts |
| **Docker profiles** | No profiles — all start by default | Deploy script unchanged; workers are essential infrastructure, not optional |
| **Graceful shutdown** | 30s `stop_grace_period` | Workers handle SIGTERM; allows in-flight messages to complete before force-kill |
| **Log rotation** | `json-file` driver, 10MB x 3 files | Prevents worker logs from filling disk; 30MB cap per worker |
| **`ACCOUNT_API_BASE_URL` fix** | `http://gt_turumba_account_api:8000` | Current `localhost:8001` doesn't resolve inside Docker; use container name on gateway-network |

---

## Tasks

### 1. Worker Dockerfile
- [ ] Create `turumba_messaging_api/Dockerfile.worker`
- [ ] Verify it builds locally: `docker build -f Dockerfile.worker -t test-worker .` (from messaging API root)
- [ ] Verify a worker starts: `docker run --rm test-worker python -m src.workers.outbox_worker --help`

### 2. Worker CI Workflow
- [ ] Create `turumba_messaging_api/.github/workflows/docker-build-worker.yml`
- [ ] Uses `Dockerfile.worker` as the build file
- [ ] Pushes to `bengeos/turumba-messaging-worker:{branch-tag}`
- [ ] Same trigger branches and secrets as `docker-build.yml`
- [ ] PR builds run but don't push (existing pattern)

### 3. RabbitMQ Service
- [ ] Add `rabbitmq` service to `turumba_gateway/docker-compose.yml`
- [ ] Use `rabbitmq:3.13-management-alpine` image
- [ ] Expose ports 5672 (AMQP) and 15672 (management UI)
- [ ] Add health check with `rabbitmq-diagnostics ping`
- [ ] Add `rabbitmq_data` named volume for persistence
- [ ] Add `volumes:` section at bottom of compose file

### 4. Worker Services
- [ ] Add `x-messaging-worker` YAML anchor with shared config
- [ ] Add `outbox_worker` service
- [ ] Add `group_message_processor` service (extra depends_on: account_api)
- [ ] Add `schedule_trigger` service
- [ ] Add 6 dispatch worker services (sms, smpp, telegram, whatsapp, messenger, email)
- [ ] All workers depend on `rabbitmq: service_healthy`
- [ ] All workers use `stop_grace_period: 30s`
- [ ] All workers use log rotation (10MB x 3 files)

### 5. Messaging API Dependency
- [ ] Add `depends_on: rabbitmq: condition: service_healthy` to `turumba_messaging_api` service

### 6. Environment Variables
- [ ] Add `MESSAGING_WORKER_IMAGE=bengeos/turumba-messaging-worker:main` to `.env`
- [ ] Add `RABBITMQ_PORT`, `RABBITMQ_MGMT_PORT`, `RABBITMQ_USER`, `RABBITMQ_PASS` to `.env`
- [ ] Fix `ACCOUNT_API_BASE_URL` in `.env.messaging-api` from `localhost:8001` to `gt_turumba_account_api:8000`
- [ ] Add optional worker tuning vars to `.env.messaging-api`

---

## Verification

1. **All services start:** `docker compose up -d` — 14 services should start without errors
2. **All containers running:** `docker compose ps` — all containers in `running` state (not `restarting`)
3. **RabbitMQ healthy:** Management UI at `localhost:15672` shows green status
4. **Queues declared with consumers:**
   - `group_message_processing` — 1 consumer
   - `scheduled_message_processing` — 1 consumer
   - `message.dispatch.sms` — 1 consumer
   - `message.dispatch.smpp` — 1 consumer
   - `message.dispatch.telegram` — 1 consumer
   - `message.dispatch.whatsapp` — 1 consumer
   - `message.dispatch.messenger` — 1 consumer
   - `message.dispatch.email` — 1 consumer
5. **Outbox worker polling:** `docker compose logs -f outbox_worker` shows poll loop running
6. **CI builds:** Push to a branch in `turumba_messaging_api` → verify `docker-build-worker.yml` builds and pushes `bengeos/turumba-messaging-worker:{branch}` to Docker Hub
7. **Graceful shutdown:** `docker compose stop outbox_worker` completes within 30s (not force-killed)
8. **API still works:** `curl http://localhost:8080/v1/channels` returns valid response through the full gateway → API path

---

## Acceptance Criteria

- [ ] `Dockerfile.worker` exists and builds a working image
- [ ] `docker-build-worker.yml` CI workflow mirrors API build pattern
- [ ] RabbitMQ starts with health check and management UI
- [ ] All 10 worker containers start and connect to RabbitMQ
- [ ] `group_message_processor` waits for both RabbitMQ and Account API
- [ ] `ACCOUNT_API_BASE_URL` bug is fixed (Docker container name, not localhost)
- [ ] `docker compose up -d` brings up the entire platform (14 services)
- [ ] `docker compose down` cleanly stops everything
- [ ] Existing gateway, API, and KrakenD functionality is unaffected
- [ ] Worker logs are rotated (no disk fill risk)

---

## Scope Boundaries

### In Scope
- Worker Dockerfile and CI pipeline
- RabbitMQ as a Docker Compose service
- 10 worker service definitions with YAML anchor
- Environment variable updates and bug fixes
- Startup dependency ordering

### Out of Scope (Future Tasks)
- **Kubernetes/ECS deployment** — production orchestration beyond Docker Compose
- **Worker auto-scaling** — dynamic replica counts based on queue depth
- **Monitoring/alerting** — Prometheus metrics, Grafana dashboards for worker health
- **Redis** — rate limiting and caching (covered in HSM-004)
- **Worker code changes** — this task only containerizes existing workers; no business logic changes
- **Database containers** — PostgreSQL and MongoDB remain external (Neon, Atlas)

---

## Dependencies

- [HSM-002 — Dispatch Pipeline](../high-scale-messaging/HSM-002-dispatch-pipeline.md) — Worker processes must exist (`dispatch_worker`, `group_message_processor`, `schedule_trigger`)
- [BE-006 — Event Infrastructure](../messaging/BE-006-event-outbox-rabbitmq.md) — Outbox worker must exist
- Docker Hub access with `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets configured in the messaging API repo
