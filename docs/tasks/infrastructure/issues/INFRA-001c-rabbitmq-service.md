# INFRA-001c: Add RabbitMQ Service to Docker Compose

**Repo:** `turumba_gateway`
**Type:** Infrastructure
**Priority:** P0
**Labels:** `enhancement`, `P0`
**Depends On:** None (can be done independently)
**Blocks:** INFRA-001d (worker services depend on RabbitMQ healthy)
**Task Spec:** [INFRA-001 — Dockerize Messaging Workers](../INFRA-001-dockerize-messaging-workers.md)

---

## GitHub Issue Title

`[Infra] Add RabbitMQ service to docker-compose`

---

## GitHub Issue Body

```markdown
## [Infra] Add RabbitMQ Service to Docker Compose

### Business Goal
The messaging platform uses RabbitMQ for event-driven communication between the API and worker processes. Currently, RabbitMQ is not part of the Docker Compose stack — it must be provisioned separately. Adding it to compose means `docker compose up -d` brings up the complete infrastructure, eliminating manual setup steps and ensuring consistent environments across development and deployment.

### User Stories
As a developer,
I want RabbitMQ to start automatically with `docker compose up -d`,
So that I don't need to install or manage RabbitMQ separately.

As a DevOps engineer,
I want a health-checked RabbitMQ service in compose,
So that dependent services (workers, messaging API) only start when RabbitMQ is ready.

As a developer,
I want the RabbitMQ management UI available locally,
So that I can inspect queues, consumers, and message flow during development.

### Acceptance Criteria
- [ ] `rabbitmq` service added to `docker-compose.yml`
- [ ] Uses `rabbitmq:3.13-management-alpine` image (includes management UI)
- [ ] `platform: linux/amd64` set (required for Apple Silicon compatibility)
- [ ] AMQP port exposed: `${RABBITMQ_PORT:-5672}:5672`
- [ ] Management UI port exposed: `${RABBITMQ_MGMT_PORT:-15672}:15672`
- [ ] Default credentials configurable via env vars: `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`
- [ ] Data persisted in a named volume `rabbitmq_data` at `/var/lib/rabbitmq`
- [ ] `volumes:` section added at bottom of compose file for `rabbitmq_data`
- [ ] Connected to `gateway-network`
- [ ] Health check configured: `rabbitmq-diagnostics -q ping` with 10s interval, 5s timeout, 5 retries, 30s start_period
- [ ] `restart: unless-stopped` policy set
- [ ] Management UI accessible at `http://localhost:15672` after startup
- [ ] `turumba_messaging_api` updated to `depends_on: rabbitmq: condition: service_healthy`

### Implementation

Add to `docker-compose.yml`:

```yaml
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
```

Add volume declaration:

```yaml
volumes:
  rabbitmq_data:
```

Update messaging API service to depend on RabbitMQ:

```yaml
  turumba_messaging_api:
    # ... existing config ...
    depends_on:
      rabbitmq:
        condition: service_healthy
```

Add to `.env`:

```env
RABBITMQ_PORT=5672
RABBITMQ_MGMT_PORT=15672
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
```

### Health Check Details
- `rabbitmq-diagnostics -q ping` — lightweight check that verifies the node is running and responsive
- `start_period: 30s` — RabbitMQ needs ~15-20s to initialize plugins and start the management interface; 30s buffer avoids false-negative failures
- `interval: 10s` — after start_period, check every 10 seconds
- `retries: 5` — mark unhealthy after 5 consecutive failures (50s of downtime)

### Dependencies
- None — RabbitMQ is independent infrastructure

### Out of Scope
- RabbitMQ clustering or HA configuration (single-node is sufficient for dev/staging)
- TLS/SSL for AMQP connections (internal Docker network is trusted)
- Custom RabbitMQ plugins beyond management
- Queue/exchange declarations (handled by worker code on startup)
- Worker services (separate issue: INFRA-001d)

### Priority
| Priority | Complexity |
|----------|------------|
| P0 | Simple |
```
