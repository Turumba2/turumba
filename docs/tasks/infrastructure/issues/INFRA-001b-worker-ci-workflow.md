# INFRA-001b: Create Worker CI Build Workflow

**Repo:** `turumba_messaging_api`
**Type:** Infrastructure / CI
**Priority:** P0
**Labels:** `enhancement`, `P0`
**Depends On:** INFRA-001a (Worker Dockerfile must exist)
**Blocks:** INFRA-001d (worker services need a published image)
**Task Spec:** [INFRA-001 — Dockerize Messaging Workers](../INFRA-001-dockerize-messaging-workers.md)

---

## GitHub Issue Title

`[Infra] Add CI workflow to build and push worker Docker image`

---

## GitHub Issue Body

```markdown
## [Infra] Add CI Workflow for Worker Docker Image

### Business Goal
The worker Dockerfile (INFRA-001a) needs a GitHub Actions pipeline to automatically build and push images to Docker Hub on every push — just like the existing API image pipeline. Without CI, worker images must be built and pushed manually, which is error-prone and blocks automated deployments.

### User Stories
As a DevOps engineer,
I want worker images to be automatically built and pushed to Docker Hub on every push,
So that deployments always have a matching worker image available.

As a developer,
I want worker images tagged by branch name (`:main`, `:feature-foo`),
So that I can test worker changes in Docker before merging.

### Acceptance Criteria
- [ ] `.github/workflows/docker-build-worker.yml` exists
- [ ] Triggers on push to `main`, `master`, `feature/*`, `release/*`
- [ ] Triggers on PRs to the same branches (build-only, no push)
- [ ] Builds using `Dockerfile.worker` (not the default `Dockerfile`)
- [ ] Pushes to `bengeos/turumba-messaging-worker` on Docker Hub (not the API image repo)
- [ ] Tags with branch name via `docker/metadata-action@v5` (e.g., `:main`, `:feature-xyz`)
- [ ] Uses GitHub Actions cache (`cache-from: type=gha`, `cache-to: type=gha,mode=max`)
- [ ] Uses existing `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets (same as API workflow)
- [ ] PR builds run but do NOT push to Docker Hub
- [ ] Workflow succeeds on a test push

### Implementation

Create `.github/workflows/docker-build-worker.yml`:

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

### Differences from Existing `docker-build.yml`
| Field | API Workflow | Worker Workflow |
|-------|-------------|-----------------|
| `IMAGE_NAME` | `turumba-messaging-api` | `turumba-messaging-worker` |
| `file` | (default `Dockerfile`) | `Dockerfile.worker` |
| Everything else | Same | Same |

### Dependencies
- INFRA-001a — `Dockerfile.worker` must exist for the workflow to build
- `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets must be configured (already exist for API)

### Out of Scope
- Multi-platform builds (arm64) — not needed, all targets are linux/amd64
- Semantic versioning tags — follow existing branch-based tag pattern
- Separate worker dependencies/requirements — use the same `requirements.txt`

### Priority
| Priority | Complexity |
|----------|------------|
| P0 | Simple |
```
