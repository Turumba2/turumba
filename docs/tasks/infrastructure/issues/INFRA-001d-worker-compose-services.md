# INFRA-001d: Add Worker Services to Docker Compose

**Repo:** `turumba_gateway`
**Type:** Infrastructure
**Priority:** P0
**Labels:** `enhancement`, `P0`
**Depends On:** INFRA-001a (Dockerfile), INFRA-001b (CI workflow publishes image), INFRA-001c (RabbitMQ in compose)
**Task Spec:** [INFRA-001 — Dockerize Messaging Workers](../INFRA-001-dockerize-messaging-workers.md)

---

## GitHub Issue Title

`[Infra] Add messaging worker services to docker-compose`

---

## GitHub Issue Body

```markdown
## [Infra] Add Messaging Worker Services to Docker Compose

### Business Goal
The messaging API has 4 types of worker processes that consume from RabbitMQ queues: outbox_worker, dispatch_worker (per channel type), group_message_processor, and schedule_trigger. These must run as Docker containers for reliable deployment. Currently workers must be started manually — unreliable and unscalable. This issue adds all 10 worker service definitions to docker-compose using a shared YAML anchor.

### User Stories
As a DevOps engineer,
I want all messaging workers defined as Docker Compose services,
So that `docker compose up -d` starts the complete messaging pipeline.

As a developer,
I want each dispatch worker to be a separate service per channel type,
So that I can independently start/stop/scale workers for specific channels.

As a developer,
I want workers to only start after RabbitMQ is healthy,
So that workers don't crash on startup due to missing broker connectivity.

### Acceptance Criteria

**YAML Anchor:**
- [ ] `x-messaging-worker` extension defined with shared worker configuration
- [ ] Anchor uses `${MESSAGING_WORKER_IMAGE}` for the image
- [ ] `platform: linux/amd64` set
- [ ] `restart: unless-stopped` policy
- [ ] `env_file` loads both `.env` and `.env.messaging-api`
- [ ] Connected to `gateway-network`
- [ ] `depends_on: rabbitmq: condition: service_healthy`
- [ ] `stop_grace_period: 30s` for graceful shutdown
- [ ] Log rotation: `json-file` driver, `max-size: 10m`, `max-file: 3`

**Worker Services (10 total):**
- [ ] `outbox_worker` → `gt_outbox_worker` → `python -m src.workers.outbox_worker`
- [ ] `group_message_processor` → `gt_group_message_processor` → `python -m src.workers.group_message_processor`
- [ ] `schedule_trigger` → `gt_schedule_trigger` → `python -m src.workers.schedule_trigger`
- [ ] `dispatch_worker_sms` → `gt_dispatch_worker_sms` → `python -m src.workers.dispatch_worker --channel-type sms`
- [ ] `dispatch_worker_smpp` → `gt_dispatch_worker_smpp` → `python -m src.workers.dispatch_worker --channel-type smpp`
- [ ] `dispatch_worker_telegram` → `gt_dispatch_worker_telegram` → `python -m src.workers.dispatch_worker --channel-type telegram`
- [ ] `dispatch_worker_whatsapp` → `gt_dispatch_worker_whatsapp` → `python -m src.workers.dispatch_worker --channel-type whatsapp`
- [ ] `dispatch_worker_messenger` → `gt_dispatch_worker_messenger` → `python -m src.workers.dispatch_worker --channel-type messenger`
- [ ] `dispatch_worker_email` → `gt_dispatch_worker_email` → `python -m src.workers.dispatch_worker --channel-type email`

**Special Cases:**
- [ ] `group_message_processor` has additional `depends_on: turumba_account_api: condition: service_started` (makes HTTP calls to Account API)

**Environment:**
- [ ] `MESSAGING_WORKER_IMAGE=bengeos/turumba-messaging-worker:main` added to `.env`

**Verification:**
- [ ] `docker compose up -d` starts all 14 services (3 existing + RabbitMQ + 10 workers)
- [ ] `docker compose ps` shows all containers in `running` state
- [ ] `docker compose logs outbox_worker` shows worker polling
- [ ] `docker compose stop dispatch_worker_telegram` stops only that worker
- [ ] `docker compose down` cleanly stops everything

### Implementation

Add the YAML anchor at the top of `docker-compose.yml`:

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

Example service definitions:

```yaml
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

  # ... same pattern for smpp, telegram, whatsapp, messenger, email
```

### Design Decisions

**Why one service per dispatch channel type (not `replicas`)?**
Each dispatch worker takes a `--channel-type` CLI argument. Docker Compose `replicas` gives identical containers — you can't pass different arguments to each replica. Separate services also allow:
- Independent scaling (more Telegram workers, fewer SMS)
- Independent stopping (disable WhatsApp without affecting others)
- Separate log streams per channel type
- Different restart policies per channel if needed

**Why 30s `stop_grace_period`?**
Workers handle SIGTERM and drain in-flight messages. 30 seconds gives enough time for a message dispatch to complete (typical: 1-5s, worst case: 20-25s for slow providers). Docker's default 10s is too aggressive.

**Why log rotation?**
Workers produce continuous log output (poll loops, message processing). Without rotation, logs can fill disk. 10MB x 3 files = 30MB cap per worker, 300MB total for all 10 workers.

### Dependencies
- INFRA-001a — `Dockerfile.worker` must exist
- INFRA-001b — CI must have published the image to Docker Hub
- INFRA-001c — RabbitMQ service must be in compose (health check dependency)

### Out of Scope
- Worker auto-scaling based on queue depth (future: Kubernetes HPA)
- Docker profiles for optional worker subsets
- Worker health check endpoints (workers don't serve HTTP)
- Monitoring/alerting (future: Prometheus + Grafana)

### Priority
| Priority | Complexity |
|----------|------------|
| P0 | Medium |
```
