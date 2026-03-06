# CONV-GW-001: Gateway Route Configuration

**Type:** Infrastructure
**Service:** turumba_gateway
**Priority:** P0 — Required for all conversation endpoints to be accessible
**Phase:** 1 — Conversation Foundation
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Add KrakenD endpoint definitions for all new conversation-related endpoints across both the Messaging API and Account API. All routes require authentication and context enrichment.

---

## New Endpoint Definitions

### `config/partials/endpoints/conversations.json`

Target: `gt_turumba_messaging_api:8000`

```
POST   /v1/conversations/
GET    /v1/conversations/
GET    /v1/conversations/{id}
PATCH  /v1/conversations/{id}
DELETE /v1/conversations/{id}
POST   /v1/conversations/{id}/messages
GET    /v1/conversations/{id}/messages
```

### `config/partials/endpoints/contact-identifiers.json`

Target: `gt_turumba_messaging_api:8000`

```
POST   /v1/contact-identifiers/
GET    /v1/contact-identifiers/
GET    /v1/contact-identifiers/{id}
PATCH  /v1/contact-identifiers/{id}
DELETE /v1/contact-identifiers/{id}
```

### `config/partials/endpoints/canned-responses.json`

Target: `gt_turumba_messaging_api:8000`

```
POST   /v1/canned-responses/
GET    /v1/canned-responses/
GET    /v1/canned-responses/{id}
PATCH  /v1/canned-responses/{id}
DELETE /v1/canned-responses/{id}
```

### `config/partials/endpoints/bot-rules.json`

Target: `gt_turumba_messaging_api:8000`

```
POST   /v1/bot-rules/
GET    /v1/bot-rules/
GET    /v1/bot-rules/{id}
PATCH  /v1/bot-rules/{id}
DELETE /v1/bot-rules/{id}
```

### `config/partials/endpoints/agent-preferences.json`

Target: `gt_turumba_account_api:8000`

```
GET    /v1/agent-preferences/me
PATCH  /v1/agent-preferences/me
GET    /v1/agent-preferences/
GET    /v1/agent-preferences/{user_id}
```

---

## Configuration

All routes must:
- Use `no-op` encoding for response passthrough
- Require authentication (context enrichment plugin enabled)
- Be imported in `config/krakend.tmpl`
- Be added to the context enrichment plugin whitelist in `config/partials/configs/plugin.json` if needed

Follow the pattern of existing endpoint definitions (e.g., `messages.json`, `channels.json`).

---

## Tasks

- [ ] Create `config/partials/endpoints/conversations.json`
- [ ] Create `config/partials/endpoints/contact-identifiers.json`
- [ ] Create `config/partials/endpoints/canned-responses.json`
- [ ] Create `config/partials/endpoints/bot-rules.json`
- [ ] Create `config/partials/endpoints/agent-preferences.json`
- [ ] Import all new partials in `config/krakend.tmpl`
- [ ] Add new endpoint patterns to context enrichment plugin whitelist
- [ ] Test that all routes are accessible through the gateway

---

## Acceptance Criteria

- [ ] All conversation endpoints routable through KrakenD on port 8080
- [ ] Context enrichment injects `x-account-ids` and `x-role-ids` headers
- [ ] Unauthenticated requests are rejected
- [ ] Response passthrough works correctly (`no-op` encoding)

---

## Dependencies

- **CONV-BE-001** — Messaging API endpoints must exist
- **CONV-BE-003** — Account API endpoints must exist

## Blocks

- All frontend tasks that call these endpoints through the gateway
