# BE-008: Internal API — Fetch Group Members (Contacts & Persons)

**Type:** Backend
**Service:** turumba_account_api
**Feature Area:** Internal API / Group Messaging

---

## Summary

The `group_message_processor` worker in `turumba_messaging_api` needs to fetch the members of a
group (contacts and/or persons) without a user JWT — it runs as a background process with no
request context. Add two internal endpoints to the Account API that accept the shared service
token and return paginated lists of contacts or persons for a given group.

---

## Required Endpoints

### `GET /internal/groups/{group_id}/contacts`

Returns paginated contacts belonging to `group_id`.

**Auth:** `X-Service-Token` header (same as existing `/internal/contacts/upsert`)

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `skip` | int ≥ 0 | 0 | Number of records to skip |
| `limit` | int 1–1000 | 100 | Page size |

**Response:** `ListResponse[ContactResponse]`

```json
{
  "success": true,
  "data": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "account_id": "550e8400-e29b-41d4-a716-446655440000",
      "properties": {
        "first_name": "Abebe",
        "phone": "+251911000001",
        "email": "abebe@example.com"
      },
      "created_at": "2026-01-01T00:00:00Z",
      "updated_at": "2026-01-01T00:00:00Z"
    }
  ],
  "meta": { "total": 150, "skip": 0, "limit": 100 }
}
```

**Error cases:**
- `401` — missing or invalid `X-Service-Token`
- `404` — group not found

---

### `GET /internal/groups/{group_id}/persons`

Identical shape to the contacts endpoint, but returns persons belonging to `group_id`.

**Response:** `ListResponse[PersonResponse]`

---

## Implementation Notes

### Router placement

Add both routes to the existing `src/routers/internal/` package, either in a new
`groups.py` file or alongside the existing `contacts.py`. Register the router in
`src/main.py` under the `/internal` prefix.

### Auth dependency

Reuse the existing `verify_service_token` dependency from
`src/routers/internal/contacts.py` — no changes needed to the auth logic.

### Data access

Use the existing service layer:

- **Contacts:** `GroupContactService.get_contacts_in_group(db, group_id, account_id, skip, limit)`
  — already used by `GET /groups/{id}/contacts` in the public router.
- **Persons:** `GroupPersonService.get_persons_in_group(db, group_id, account_id, skip, limit)`
  — already used by `GET /groups/{id}/persons` in the public router.

The internal endpoints do **not** scope by `account_id` (the worker doesn't have one — it
operates across the full group). Verify the service methods can be called without an
`account_id` scope, or add a variant that skips it.

### Response schema

Return the same `ContactResponse` / `PersonResponse` schemas already used by the public
group endpoints. No new schemas are needed.

---

## Tasks

- [ ] Create `src/routers/internal/groups.py`
- [ ] Add `GET /internal/groups/{group_id}/contacts` — paginated, service-token protected
- [ ] Add `GET /internal/groups/{group_id}/persons` — paginated, service-token protected
- [ ] Register router in `src/main.py`
- [ ] Unit tests: 401 on missing/invalid token, 200 with valid token, empty group returns `data: []`
- [ ] Integration test: fetch contacts/persons via internal endpoint matches public endpoint results

---

## Acceptance Criteria

- [ ] `GET /internal/groups/{id}/contacts?skip=0&limit=100` returns `ListResponse[ContactResponse]`
- [ ] `GET /internal/groups/{id}/persons?skip=0&limit=100` returns `ListResponse[PersonResponse]`
- [ ] Both endpoints return `401` when `X-Service-Token` is absent or wrong
- [ ] Pagination (`skip`, `limit`) works correctly
- [ ] Empty group returns `{ "data": [], "meta": { "total": 0 } }` — not an error
- [ ] Ruff passes cleanly, tests pass

---

## Consumer

`turumba_messaging_api` — `src/workers/group_message_processor.py`
calls `GET /internal/groups/{group_id}/contacts` and `GET /internal/groups/{group_id}/persons`
during group message fan-out, once per group in `group_ids`.
