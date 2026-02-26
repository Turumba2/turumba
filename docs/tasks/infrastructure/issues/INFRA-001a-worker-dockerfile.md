# INFRA-001a: Create Worker Dockerfile for Messaging API

**Repo:** `turumba_messaging_api`
**Type:** Infrastructure
**Priority:** P0
**Labels:** `enhancement`, `P0`
**Depends On:** [HSM-002 — Dispatch Pipeline](https://github.com/Turumba2/turumba_messaging_api/issues/32) (workers exist)
**Blocks:** INFRA-001b (CI workflow), INFRA-001d (worker services in compose)
**Task Spec:** [INFRA-001 — Dockerize Messaging Workers](../INFRA-001-dockerize-messaging-workers.md)

---

## GitHub Issue Title

`[Infra] Create Worker Dockerfile for messaging worker processes`

---

## GitHub Issue Body

```markdown
## [Infra] Create Worker Dockerfile

### Business Goal
The messaging API has 4 worker processes (outbox_worker, dispatch_worker, group_message_processor, schedule_trigger) that need to run as Docker containers alongside the API. Currently there is no Docker image for workers — only the API has a Dockerfile. Without a worker image, `docker compose up -d` cannot start worker processes, requiring manual intervention on every deployment.

### User Stories
As a DevOps engineer,
I want a dedicated Docker image for messaging workers,
So that worker processes can be deployed as containers alongside the API.

As a developer,
I want workers to start automatically with `docker compose up -d`,
So that I don't have to manually start each worker process during development.

### Acceptance Criteria
- [ ] `Dockerfile.worker` exists at the root of the messaging API repo
- [ ] Uses `python:3.12-slim` base image (same as API Dockerfile)
- [ ] Copies `requirements.txt` and installs dependencies with `--no-cache-dir`
- [ ] Copies `src/` directory into the image
- [ ] Does NOT include `EXPOSE` (workers don't serve HTTP)
- [ ] Does NOT include a `CMD` (command is set per-worker in docker-compose)
- [ ] Image builds successfully: `docker build -f Dockerfile.worker -t test-worker .`
- [ ] A worker can start from the image: `docker run --rm test-worker python -m src.workers.outbox_worker --help`

### Implementation

Create `Dockerfile.worker` at the repo root:

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

### Why a Separate Dockerfile?
The existing API `Dockerfile` includes `EXPOSE 8000` and a `CMD` that runs uvicorn. Workers don't need either. A separate file:
- Makes the purpose explicit (no confusion about what the image does)
- Allows divergent dependencies in the future (e.g., adapter SDKs)
- Follows the one-concern-per-image principle

### Dependencies
- Worker code must exist in `src/workers/` (completed in HSM-001, HSM-002)
- `requirements.txt` must include all worker dependencies (pika, etc.)

### Out of Scope
- CI build pipeline (separate issue: INFRA-001b)
- Docker Compose service definitions (separate issue: INFRA-001d)
- Worker code changes (workers are containerized as-is)

### Priority
| Priority | Complexity |
|----------|------------|
| P0 | Simple |
```
