# RT-GW-001: Gateway Route Configuration for Realtime Messaging

**Type:** Infrastructure
**Service:** turumba_gateway
**Assignee:** bengeos
**Priority:** P1 -- Makes endpoints accessible from frontend
**Phase:** 3 -- Realtime Infrastructure
**Depends On:** RT-BE-001, RT-BE-002, RT-BE-003, RT-ACC-001
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 15](../../../TURUMBA_REALTIME_MESSAGING.md#15-summary-of-changes-per-service)

---

## Summary

Configure KrakenD gateway routes for all new realtime messaging endpoints: conversations, conversation configs, chat endpoints, public chat API, and teams. This follows the established pattern in the existing endpoint definitions (channels.json, messages.json, groups.json).

All authenticated endpoints use JWT validation, context enrichment (x-account-ids, x-role-ids), and no-op encoding. Public endpoints skip auth and context enrichment but include rate limiting.

---

## Architecture

```
Client Browser
    |
    v
KrakenD Gateway (:8080)
    |
    |-- /v1/conversations/**        --> Messaging API (gt_turumba_messaging_api:8000)
    |-- /v1/conversation-configs/** --> Messaging API
    |-- /v1/chat-endpoints/**       --> Messaging API
    |-- /v1/public/chat/**          --> Messaging API (NO auth, rate-limited)
    |-- /v1/teams/**                --> Account API  (gt_turumba_account_api:8000)
    |-- /v1/users/{id}/teams        --> Account API
```

---

## Implementation

### File 1: `config/partials/endpoints/conversations.json`

Conversations CRUD + nested messages endpoint. Routes to Messaging API.

```json
[
  {
    "endpoint": "/v1/conversations",
    "method": "POST",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "output_encoding": "no-op",
    "backend": [
      {
        "url_pattern": "/v1/conversations/",
        "method": "POST",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversations",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "input_query_strings": ["filter", "sort", "limit", "skip"],
    "backend": [
      {
        "url_pattern": "/v1/conversations/",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversations/{id}",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/conversations/{id}",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversations/{id}",
    "method": "PATCH",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/conversations/{id}",
        "method": "PATCH",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversations/{id}",
    "method": "DELETE",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/conversations/{id}",
        "method": "DELETE",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversations/{id}/messages",
    "method": "POST",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "output_encoding": "no-op",
    "backend": [
      {
        "url_pattern": "/v1/conversations/{id}/messages",
        "method": "POST",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversations/{id}/messages",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "input_query_strings": ["filter", "sort", "limit", "skip"],
    "backend": [
      {
        "url_pattern": "/v1/conversations/{id}/messages",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  }
]
```

### File 2: `config/partials/endpoints/conversation-configs.json`

Conversation config CRUD. Routes to Messaging API.

```json
[
  {
    "endpoint": "/v1/conversation-configs",
    "method": "POST",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "output_encoding": "no-op",
    "backend": [
      {
        "url_pattern": "/v1/conversation-configs/",
        "method": "POST",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversation-configs",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "input_query_strings": ["filter", "sort", "limit", "skip"],
    "backend": [
      {
        "url_pattern": "/v1/conversation-configs/",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversation-configs/{id}",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/conversation-configs/{id}",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversation-configs/{id}",
    "method": "PATCH",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/conversation-configs/{id}",
        "method": "PATCH",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/conversation-configs/{id}",
    "method": "DELETE",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/conversation-configs/{id}",
        "method": "DELETE",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  }
]
```

### File 3: `config/partials/endpoints/chat-endpoints.json`

Chat endpoint CRUD. Routes to Messaging API.

```json
[
  {
    "endpoint": "/v1/chat-endpoints",
    "method": "POST",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "output_encoding": "no-op",
    "backend": [
      {
        "url_pattern": "/v1/chat-endpoints/",
        "method": "POST",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/chat-endpoints",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "input_query_strings": ["filter", "sort", "limit", "skip"],
    "backend": [
      {
        "url_pattern": "/v1/chat-endpoints/",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/chat-endpoints/{id}",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/chat-endpoints/{id}",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/chat-endpoints/{id}",
    "method": "PATCH",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/chat-endpoints/{id}",
        "method": "PATCH",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/chat-endpoints/{id}",
    "method": "DELETE",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/v1/chat-endpoints/{id}",
        "method": "DELETE",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  }
]
```

### File 4: `config/partials/endpoints/public-chat.json`

Public endpoints for the chat widget. **No auth, no context enrichment.** Rate-limited.

```json
[
  {
    "endpoint": "/v1/public/chat/{public_key}",
    "method": "GET",
    "output_encoding": "no-op",
    "input_query_strings": [],
    "backend": [
      {
        "url_pattern": "/v1/public/chat/{public_key}",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"]
      }
    ],
    "extra_config": {
      "qos/ratelimit/router": {
        "max_rate": 60,
        "client_max_rate": 20,
        "strategy": "ip",
        "every": "1m"
      }
    }
  },
  {
    "endpoint": "/v1/public/chat/{public_key}/session",
    "method": "POST",
    "output_encoding": "no-op",
    "input_headers": ["Content-Type"],
    "backend": [
      {
        "url_pattern": "/v1/public/chat/{public_key}/session",
        "method": "POST",
        "encoding": "no-op",
        "host": ["http://gt_turumba_messaging_api:8000"],
        "input_headers": ["Content-Type"]
      }
    ],
    "extra_config": {
      "qos/ratelimit/router": {
        "max_rate": 60,
        "client_max_rate": 10,
        "strategy": "ip",
        "every": "1m"
      }
    }
  }
]
```

**Key differences from authenticated endpoints:**
- No `Authorization` header in `input_headers`
- No `x-account-ids` or `x-role-ids` headers
- No context enrichment plugin match (not listed in `plugin.json`)
- Rate limiting configured per-endpoint via `qos/ratelimit/router`

**Rate limiting:**
- `GET /v1/public/chat/{public_key}`: 60 req/min global, 20 req/min per IP (widget config is cacheable)
- `POST /v1/public/chat/{public_key}/session`: 60 req/min global, 10 req/min per IP (session creation is heavier)

### File 5: `config/partials/endpoints/teams.json`

Teams CRUD + team members sub-resource. Routes to Account API.

**Note:** Account API routes strip the `/v1/` prefix -- gateway `/v1/teams` maps to backend `/teams/`.

```json
[
  {
    "endpoint": "/v1/teams",
    "method": "POST",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "output_encoding": "no-op",
    "backend": [
      {
        "url_pattern": "/teams/",
        "method": "POST",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/teams",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "input_query_strings": ["filter", "sort", "limit", "skip"],
    "backend": [
      {
        "url_pattern": "/teams/",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/teams/{id}",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/teams/{id}",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/teams/{id}",
    "method": "PATCH",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/teams/{id}",
        "method": "PATCH",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/teams/{id}",
    "method": "DELETE",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/teams/{id}",
        "method": "DELETE",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/teams/{id}/members",
    "method": "POST",
    "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"],
    "output_encoding": "no-op",
    "backend": [
      {
        "url_pattern": "/teams/{id}/members",
        "method": "POST",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "Content-Type", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/teams/{id}/members",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "input_query_strings": ["skip", "limit"],
    "backend": [
      {
        "url_pattern": "/teams/{id}/members",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/teams/{id}/members/{user_id}",
    "method": "DELETE",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "backend": [
      {
        "url_pattern": "/teams/{id}/members/{user_id}",
        "method": "DELETE",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  },
  {
    "endpoint": "/v1/users/{id}/teams",
    "method": "GET",
    "output_encoding": "no-op",
    "input_headers": ["Authorization", "x-account-ids", "x-role-ids"],
    "input_query_strings": ["skip", "limit"],
    "backend": [
      {
        "url_pattern": "/users/{id}/teams",
        "method": "GET",
        "encoding": "no-op",
        "host": ["http://gt_turumba_account_api:8000"],
        "input_headers": ["Authorization", "x-account-ids", "x-role-ids"]
      }
    ]
  }
]
```

---

## Context Enrichment Plugin

### Add to `config/partials/configs/plugin.json`

Add the following entries to the `endpoints` object in `plugin.json` so the context-enricher plugin intercepts requests and injects `x-account-ids` and `x-role-ids` headers:

```json
"* /v1/conversations/**": {
  "context_url": "http://gt_turumba_account_api:8000/context/basic",
  "timeout_ms": 10000,
  "headers_mapping": {
    "account_ids": "x-account-ids",
    "role_ids": "x-role-ids"
  }
},
"* /v1/conversation-configs/**": {
  "context_url": "http://gt_turumba_account_api:8000/context/basic",
  "timeout_ms": 10000,
  "headers_mapping": {
    "account_ids": "x-account-ids",
    "role_ids": "x-role-ids"
  }
},
"* /v1/chat-endpoints/**": {
  "context_url": "http://gt_turumba_account_api:8000/context/basic",
  "timeout_ms": 10000,
  "headers_mapping": {
    "account_ids": "x-account-ids",
    "role_ids": "x-role-ids"
  }
},
"* /v1/teams/**": {
  "context_url": "http://gt_turumba_account_api:8000/context/basic",
  "timeout_ms": 10000,
  "headers_mapping": {
    "account_ids": "x-account-ids",
    "role_ids": "x-role-ids"
  }
}
```

**Important:** Do NOT add a pattern for `/v1/public/chat/**`. Public endpoints must NOT go through context enrichment -- they have no `Authorization` header.

---

## Template Import

### Update `config/krakend.tmpl`

Add the new endpoint partials to the `endpoints` array in `krakend.tmpl`. Insert after the existing webhooks line:

```
{{ range $idx, $endpoint := include "endpoints/conversations.json" | fromJson }}{{ if $idx }},{{ end }}{{ $endpoint | toJson }}{{ end }},
{{ range $idx, $endpoint := include "endpoints/conversation-configs.json" | fromJson }}{{ if $idx }},{{ end }}{{ $endpoint | toJson }}{{ end }},
{{ range $idx, $endpoint := include "endpoints/chat-endpoints.json" | fromJson }}{{ if $idx }},{{ end }}{{ $endpoint | toJson }}{{ end }},
{{ range $idx, $endpoint := include "endpoints/public-chat.json" | fromJson }}{{ if $idx }},{{ end }}{{ $endpoint | toJson }}{{ end }},
{{ range $idx, $endpoint := include "endpoints/teams.json" | fromJson }}{{ if $idx }},{{ end }}{{ $endpoint | toJson }}{{ end }}
```

---

## Tasks

### 1. Endpoint Files
- [ ] Create `config/partials/endpoints/conversations.json` -- CRUD + nested messages (7 endpoints)
- [ ] Create `config/partials/endpoints/conversation-configs.json` -- CRUD (5 endpoints)
- [ ] Create `config/partials/endpoints/chat-endpoints.json` -- CRUD (5 endpoints)
- [ ] Create `config/partials/endpoints/public-chat.json` -- public widget API (2 endpoints, rate-limited)
- [ ] Create `config/partials/endpoints/teams.json` -- CRUD + members + user's teams (9 endpoints)

### 2. Context Enrichment
- [ ] Add `* /v1/conversations/**` to `config/partials/configs/plugin.json`
- [ ] Add `* /v1/conversation-configs/**` to plugin.json
- [ ] Add `* /v1/chat-endpoints/**` to plugin.json
- [ ] Add `* /v1/teams/**` to plugin.json
- [ ] Verify `/v1/public/chat/**` is NOT in plugin.json (no auth on public endpoints)

### 3. Template Import
- [ ] Add all 5 new endpoint files to `config/krakend.tmpl` endpoints array
- [ ] Verify no trailing comma issues in the JSON template

### 4. Validation
- [ ] Restart gateway: `docker-compose restart krakend`
- [ ] Verify gateway starts without config errors (check logs)
- [ ] Test authenticated endpoint: `GET /v1/conversations` with valid JWT returns response (or 404 if backend not ready)
- [ ] Test public endpoint: `GET /v1/public/chat/test-key` returns response without auth header
- [ ] Test rate limiting: rapid requests to public endpoint eventually return 429
- [ ] Test context enrichment: verify `x-account-ids` header is injected for conversation routes

### 5. Endpoint Inventory Verification
- [ ] Verify all endpoints match the API reference in spec Section 9:
  - Conversations: POST, GET list, GET by ID, PATCH, DELETE, POST messages, GET messages
  - Conversation configs: POST, GET list, GET by ID, PATCH, DELETE
  - Chat endpoints: POST, GET list, GET by ID, PATCH, DELETE
  - Public chat: GET config, POST session
  - Teams: POST, GET list, GET by ID, PATCH, DELETE, POST member, GET members, DELETE member, GET user's teams

---

## Acceptance Criteria

- [ ] All 5 endpoint partial files created in `config/partials/endpoints/`
- [ ] All authenticated routes include `Authorization`, `x-account-ids`, `x-role-ids` in `input_headers`
- [ ] All GET list endpoints include `input_query_strings: ["filter", "sort", "limit", "skip"]`
- [ ] All POST/PATCH endpoints include `Content-Type` in `input_headers`
- [ ] All endpoints use `no-op` encoding (passthrough)
- [ ] Public chat endpoints have NO auth headers and NO context enrichment
- [ ] Public chat endpoints have rate limiting configured (60 req/min global)
- [ ] Context enrichment patterns added to `plugin.json` for all authenticated resources
- [ ] All partials imported in `krakend.tmpl`
- [ ] Gateway starts cleanly with new configuration
- [ ] Teams routes map to Account API (URL pattern strips `/v1/` prefix)
- [ ] All other routes map to Messaging API (URL pattern keeps `/v1/` prefix)

---

## Notes

- **URL pattern difference:** Account API routes strip `/v1/` (gateway `/v1/teams` -> backend `/teams/`). Messaging API routes keep `/v1/` (gateway `/v1/conversations` -> backend `/v1/conversations/`). See existing `channels.json` vs `groups.json` for examples.
- **Trailing slashes:** Backend `url_pattern` for list/create endpoints includes trailing slash (e.g., `/v1/conversations/`) to match FastAPI router conventions. Single-resource endpoints do not (e.g., `/v1/conversations/{id}`).
- The `GET /v1/users/{id}/teams` endpoint is in `teams.json` even though it starts with `/users/`. This is because it routes to the Account API and is logically part of the teams feature. The context enrichment pattern `* /v1/users/**` already covers this path.
- The `DELETE /v1/teams/{id}/members/{user_id}` endpoint uses two path parameters. KrakenD handles this natively.
- Public endpoints do not appear in `plugin.json` -- the context-enricher plugin only processes requests matching patterns in its configuration. Unmatched requests pass through unenriched.

## Blocks

- **RT-FE-001** (WebSocket Client + Hooks) -- frontend connects via gateway for REST, directly to AWS for WebSocket
- **RT-FE-002** (Conversation Inbox + Chat) -- frontend calls these gateway routes
