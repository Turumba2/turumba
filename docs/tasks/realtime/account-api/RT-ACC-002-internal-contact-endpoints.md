# RT-ACC-002: Internal Contact Endpoints (Service-to-Service)

**Type:** Backend
**Service:** turumba_account_api
**Assignee:** tesfayegirma-116
**Priority:** P0 — Required by inbound conversation flow
**Phase:** 1 — Data Foundation
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 4.2](../../../TURUMBA_REALTIME_MESSAGING.md#42-account-api-integration-internal-endpoints), [Section 9.5](../../../TURUMBA_REALTIME_MESSAGING.md#95-account-api--internal-endpoints-service-to-service)

---

## Summary

Three new internal endpoints on the Docker network for the Messaging API to call during the conversation creation flow. These are service-to-service only — protected by `verify_service_token` (existing pattern in `src/routers/internal/deps.py`), not JWT auth. They are not exposed through KrakenD.

The Messaging API calls these endpoints when an inbound message arrives to:
1. Look up the sender as an existing contact
2. Check if the contact belongs to specific groups (audience evaluation)
3. Create a new contact if one doesn't exist and a config matched

```
Messaging API ──HTTP──→ gt_turumba_account_api:8000/internal/contacts/...
```

---

## Endpoint 1: Contact Lookup

### `POST /internal/contacts/lookup`

Search for an existing contact by phone or email within an account. Used in Step 2 of the conversation creation flow.

**Request:**

```json
{
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "phone": "+251911234567"
}
```

OR:

```json
{
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "dawit@example.com"
}
```

**Response (found):**

```json
{
  "success": true,
  "data": {
    "found": true,
    "contact_id": "507f1f77bcf86cd799439011",
    "name": "Dawit Bekele",
    "phone": "+251911234567",
    "email": "dawit@example.com"
  }
}
```

**Response (not found):**

```json
{
  "success": true,
  "data": {
    "found": false,
    "contact_id": null,
    "name": null,
    "phone": null,
    "email": null
  }
}
```

### Implementation

- Query MongoDB `contacts` collection by `account_id` (string) + match `phone` or `email` in the contact's `properties` field
- Contacts store dynamic properties — phone/email are typically in `properties.phone` and `properties.email`
- Return the first matching contact
- `account_id` is stored as a string in MongoDB (not UUID) — convert before querying

### Request Schema

```python
from uuid import UUID
from pydantic import BaseModel, model_validator


class ContactLookupRequest(BaseModel):
    account_id: UUID
    phone: str | None = None
    email: str | None = None

    @model_validator(mode="after")
    def at_least_one_identifier(self):
        if not self.phone and not self.email:
            msg = "Either phone or email must be provided"
            raise ValueError(msg)
        return self
```

### Response Schema

```python
class ContactLookupResponse(BaseModel):
    found: bool
    contact_id: str | None = None
    name: str | None = None
    phone: str | None = None
    email: str | None = None
```

---

## Endpoint 2: Check Group Membership

### `POST /internal/contacts/check-membership`

Check if a contact belongs to any of the specified groups. Used in Step 4b of the conversation creation flow for audience evaluation.

**Request:**

```json
{
  "contact_id": "507f1f77bcf86cd799439011",
  "group_ids": [
    "60d5ec49f1d2e8a7b4c7e8f1",
    "60d5ec49f1d2e8a7b4c7e8f2"
  ]
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "is_member": true,
    "matched_groups": ["60d5ec49f1d2e8a7b4c7e8f1"]
  }
}
```

### Implementation

- Groups and group_contacts are in **MongoDB** (not PostgreSQL)
- Query `group_contacts` collection: find documents where `contact_id` matches AND `group_id` is in the provided list
- Return the list of matched group IDs and a boolean summary
- Handle MongoDB ObjectId format for both `contact_id` and `group_ids`

### Schemas

```python
class CheckMembershipRequest(BaseModel):
    contact_id: str
    group_ids: list[str]


class CheckMembershipResponse(BaseModel):
    is_member: bool
    matched_groups: list[str]
```

---

## Endpoint 3: Create Contact

### `POST /internal/contacts/create`

Create a new contact in the MongoDB contacts collection. Called in Step 5 of the conversation creation flow, only after a config matched and no existing contact was found via lookup.

**Request:**

```json
{
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Unknown",
  "phone": "+251911234567",
  "email": null,
  "properties": {
    "source": "whatsapp",
    "auto_created": true
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "account_id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Unknown",
    "properties": {
      "phone": "+251911234567",
      "source": "whatsapp",
      "auto_created": true
    },
    "created_at": "2026-03-06T10:00:00Z",
    "updated_at": "2026-03-06T10:00:00Z"
  }
}
```

### Implementation

- Insert a new document into the MongoDB `contacts` collection
- `account_id` stored as string in MongoDB
- `phone` and `email` are merged into the `properties` dict (contacts use dynamic properties)
- No duplicate check — the caller (Messaging API) handles dedup by calling `/lookup` first
- Return the created contact using the existing `ContactResponse` schema
- Status code: 201 Created

### Schema

```python
from typing import Any

class ContactCreateInternalRequest(BaseModel):
    account_id: UUID
    name: str = "Unknown"
    phone: str | None = None
    email: str | None = None
    properties: dict[str, Any] = {}
```

---

## File Structure

All three endpoints go in the existing internal router package:

```
src/routers/internal/
├── __init__.py          # Add new contacts routes (already includes contacts.py)
├── deps.py              # verify_service_token (existing)
├── contacts.py          # Existing — has /upsert endpoint
├── accounts.py          # Existing
├── groups.py            # Existing
└── persons.py           # Existing
```

**Option A:** Add the three new endpoints to the existing `src/routers/internal/contacts.py` file (it already has `/contacts/upsert`).

**Option B:** Create a separate file if the existing file becomes too large. Either approach is fine — the routes all share the `/internal/contacts` prefix.

### Router Registration

The internal contacts router is already registered in `src/routers/internal/__init__.py`. New endpoints added to the same router will be automatically included.

---

## Service Layer

### Contact Lookup Service

Add a lookup method to the existing contact services or create a dedicated internal service:

```python
# src/services/contact/contact_lookup.py (new)
class ContactLookupService:
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db

    async def lookup_by_phone(self, account_id: str, phone: str) -> dict | None:
        """Find contact by phone in properties."""
        return await self.db.contacts.find_one({
            "account_id": account_id,
            "properties.phone": phone,
        })

    async def lookup_by_email(self, account_id: str, email: str) -> dict | None:
        """Find contact by email in properties."""
        return await self.db.contacts.find_one({
            "account_id": account_id,
            "properties.email": email,
        })
```

### Group Membership Check

Reuse or extend `GroupContactService` from `src/services/group/group_contact.py`:

```python
async def check_contact_membership(self, contact_id: str, group_ids: list[str]) -> list[str]:
    """Return group_ids where the contact is a member."""
    # Query group_contacts collection for matching entries
    ...
```

---

## Important Context

- **Contacts are in MongoDB** — `MongoDBBaseModel` with `id` (PyObjectId aliased to `_id`), `account_id` as string
- **Groups are in MongoDB** — `group_contacts` is also MongoDB
- **`verify_service_token`** checks `x-service-token` header against `ACCOUNT_API_SERVICE_TOKEN` env var (see `src/routers/internal/deps.py`)
- The existing `/internal/contacts/upsert` endpoint is a reference for the pattern — same auth, same DB access, same response envelope
- These endpoints are called by the Messaging API's `inbound_message_worker` during conversation creation — they need to be fast
- Results should be cacheable: spec suggests 5-minute TTL per (contact_id, group_ids) pair, but caching is the caller's responsibility

---

## Tasks

### 1. Request/Response Schemas
- [ ] Create `ContactLookupRequest` with `model_validator` requiring phone or email
- [ ] Create `ContactLookupResponse` with found/contact_id/name/phone/email
- [ ] Create `CheckMembershipRequest` with contact_id and group_ids
- [ ] Create `CheckMembershipResponse` with is_member and matched_groups
- [ ] Create `ContactCreateInternalRequest` with account_id, name, phone, email, properties

### 2. Service Layer
- [ ] Create `ContactLookupService` in `src/services/contact/contact_lookup.py`
- [ ] Implement `lookup_by_phone` — query contacts by account_id + properties.phone
- [ ] Implement `lookup_by_email` — query contacts by account_id + properties.email
- [ ] Add `check_contact_membership` method to `GroupContactService` (or create dedicated service)
- [ ] Implement group_contacts query for multiple group_ids

### 3. Router Endpoints
- [ ] Add `POST /internal/contacts/lookup` endpoint to `src/routers/internal/contacts.py`
- [ ] Add `POST /internal/contacts/check-membership` endpoint
- [ ] Add `POST /internal/contacts/create` endpoint (merge phone/email into properties)
- [ ] All endpoints use `Depends(verify_service_token)` for auth
- [ ] All responses wrapped in `SuccessResponse` envelope

### 4. Tests
- [ ] Lookup: find contact by phone — found case
- [ ] Lookup: find contact by email — found case
- [ ] Lookup: contact not found — returns `{ found: false }`
- [ ] Lookup: validation error when neither phone nor email provided
- [ ] Check membership: contact belongs to one of the groups
- [ ] Check membership: contact belongs to none of the groups
- [ ] Check membership: empty group_ids list
- [ ] Create: new contact created with properties merged
- [ ] Create: returns 201 with contact data
- [ ] All endpoints: reject requests without valid service token (401)

---

## Acceptance Criteria

- [ ] `POST /internal/contacts/lookup` returns matching contact or `{ found: false }`
- [ ] `POST /internal/contacts/check-membership` correctly checks MongoDB group_contacts
- [ ] `POST /internal/contacts/create` creates a contact and returns 201
- [ ] All endpoints protected by `verify_service_token` (returns 401 without valid token)
- [ ] All responses use the standard `SuccessResponse` envelope
- [ ] Phone and email are correctly queried from contact `properties` (dynamic fields)
- [ ] MongoDB ObjectId formats handled correctly
- [ ] All tests passing, Ruff clean, coverage threshold met (50%)

---

## Notes

- The existing `/internal/contacts/upsert` endpoint does a combined find-or-create. The new `/lookup` and `/create` are intentionally separate to give the Messaging API control over the flow (lookup first, evaluate config, then create only if needed)
- The `check-membership` endpoint bridges contacts (MongoDB) and group_contacts (MongoDB) — both are in the same database
- These endpoints are not routed through KrakenD — they are only accessible on the Docker `gateway-network` at `gt_turumba_account_api:8000`
- The Messaging API will call these from `src/clients/account_api.py` (or a new internal client)

## Dependencies

None — builds on existing internal router infrastructure.

## Blocks

- **CONV-BE-005** (Inbound Flow + Agent Routing) — calls these endpoints during conversation creation
- **CONV-BE-004** (Bot Rules Evaluation) — uses check-membership for audience evaluation
