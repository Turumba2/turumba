# API Response Standards

> **Audience:** Backend developers working on Turumba 2.0 APIs
> **Purpose:** Define a consistent response envelope for all API endpoints across services
> **Status:** Approved — all new endpoints MUST follow this standard; existing endpoints should be migrated

---

## Table of Contents

1. [Why Standardize](#why-standardize)
2. [Response Envelope](#response-envelope)
3. [Single Item Responses](#single-item-responses)
4. [List Responses](#list-responses)
5. [Error Responses](#error-responses)
6. [HTTP Method Conventions](#http-method-conventions)
7. [Current State & Migration](#current-state--migration)
8. [Implementation Reference](#implementation-reference)

---

## Why Standardize

The platform currently has **3 different response patterns** across services:

| Pattern | Used By | Format |
|---------|---------|--------|
| `SuccessResponse` / `ListResponse` envelope | Messaging API (channels, messages) | `{ success, data, meta }` |
| Custom `{ total, items }` wrapper | Messaging API (templates, group-messages, scheduled-messages) | `{ total, items: [...] }` |
| No envelope (bare objects/arrays) | Account API (all endpoints) | `[...]` or `{...}` |

This causes:
- **Frontend complexity** — clients must handle multiple response shapes per service
- **Inconsistent pagination** — some endpoints return `skip`/`limit`, others only `total`, others nothing
- **No success indicator** — most endpoints lack a top-level `success` field, forcing clients to rely solely on HTTP status codes

---

## Response Envelope

All API responses use a **standard envelope** that wraps the actual data.

### Core Principle

> Every successful response has `success: true` and a `data` field. Every error response has `success: false` and an `error` field. Clients can always check `response.success` first.

---

## Single Item Responses

Used for: `GET /{id}`, `POST /`, `PUT /{id}`, `PATCH /{id}`

### Format

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Welcome Template",
    "created_at": "2025-01-15T10:30:00Z",
    "updated_at": "2025-01-15T10:30:00Z"
  },
  "message": null
}
```

### Schema

```python
from pydantic import BaseModel
from typing import Generic, TypeVar

DataT = TypeVar("DataT")

class SuccessResponse(BaseModel, Generic[DataT]):
    success: bool = True
    data: DataT
    message: str | None = None
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | `bool` | Always `true` for successful responses |
| `data` | `T` | The entity object |
| `message` | `str \| null` | Optional message (e.g., `"Template created successfully"`) |

### Usage

```python
# Router — single item
@router.get("/{id}", response_model=SuccessResponse[TemplateResponse])
async def get_by_id(id: UUID):
    item = await controller.get_by_id(id)
    return SuccessResponse(data=controller.model_to_response(item))

# Router — create
@router.post("/", response_model=SuccessResponse[TemplateResponse], status_code=201)
async def create(payload: TemplateCreate):
    created = await controller.create(payload)
    return SuccessResponse(data=controller.model_to_response(created))

# Router — update
@router.patch("/{id}", response_model=SuccessResponse[TemplateResponse])
async def update(id: UUID, payload: TemplateUpdate):
    updated = await controller.update(id, payload)
    return SuccessResponse(data=controller.model_to_response(updated))
```

---

## List Responses

Used for: `GET /` (paginated lists)

### Format

```json
{
  "success": true,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Welcome Template",
      "created_at": "2025-01-15T10:30:00Z",
      "updated_at": "2025-01-15T10:30:00Z"
    }
  ],
  "meta": {
    "total": 42,
    "skip": 0,
    "limit": 100
  }
}
```

### Schema

```python
class PaginationMeta(BaseModel):
    total: int
    skip: int
    limit: int

class ListResponse(BaseModel, Generic[DataT]):
    success: bool = True
    data: list[DataT]
    meta: PaginationMeta
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | `bool` | Always `true` for successful responses |
| `data` | `list[T]` | Array of entity objects |
| `meta.total` | `int` | Total count matching the current filters (before skip/limit) |
| `meta.skip` | `int` | Offset applied to the query |
| `meta.limit` | `int` | Page size applied to the query |

### Usage

```python
@router.get("/", response_model=ListResponse[TemplateResponse])
async def get_all(skip: int = 0, limit: int = 100):
    items, total = await controller.get_all(skip=skip, limit=limit)
    return ListResponse(
        data=[controller.model_to_response(item, context="list") for item in items],
        meta=PaginationMeta(total=total, skip=skip, limit=limit),
    )
```

---

## Error Responses

Used for: all error cases (`4xx`, `5xx`)

### Format

```json
{
  "success": false,
  "error": "not_found",
  "message": "Template with id '550e8400-...' not found",
  "details": {}
}
```

### Schema

```python
class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    message: str
    details: dict[str, Any] = {}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | `bool` | Always `false` for error responses |
| `error` | `str` | Machine-readable error code (e.g., `"not_found"`, `"validation_error"`) |
| `message` | `str` | Human-readable error message |
| `details` | `dict` | Additional context (validation errors, field-level details, etc.) |

### Standard Error Codes

| HTTP Status | Error Code | Example Message |
|-------------|-----------|-----------------|
| `400` | `bad_request` | "Invalid filter syntax" |
| `401` | `unauthorized` | "Authentication required" |
| `403` | `forbidden` | "Insufficient permissions for this account" |
| `404` | `not_found` | "Channel with id '...' not found" |
| `409` | `conflict` | "A template with this name already exists" |
| `422` | `validation_error` | "Validation failed" (details contain field errors) |
| `429` | `rate_limited` | "Too many requests" |
| `500` | `internal_error` | "An unexpected error occurred" |

### Validation Error Details

```json
{
  "success": false,
  "error": "validation_error",
  "message": "Validation failed",
  "details": {
    "errors": [
      {
        "field": "email",
        "message": "Invalid email format"
      },
      {
        "field": "name",
        "message": "Field is required"
      }
    ]
  }
}
```

---

## HTTP Method Conventions

| Method | Success Status | Response Format | Notes |
|--------|---------------|-----------------|-------|
| `GET /` | `200` | `ListResponse[T]` | Always paginated |
| `GET /{id}` | `200` | `SuccessResponse[T]` | |
| `POST /` | `201` | `SuccessResponse[T]` | Returns created entity |
| `PUT /{id}` | `200` | `SuccessResponse[T]` | Returns updated entity |
| `PATCH /{id}` | `200` | `SuccessResponse[T]` | Returns updated entity |
| `DELETE /{id}` | `204` | No body | No response envelope |

---

## Current State & Migration

### Messaging API

| Entity | Current Format | Standard? | Action Required |
|--------|---------------|-----------|-----------------|
| Channels | `SuccessResponse` / `ListResponse` | Yes | None |
| Messages | `SuccessResponse` / `ListResponse` | Yes | None |
| Templates | `{ total, items }` / bare object | No | Migrate to `SuccessResponse` / `ListResponse` |
| Group Messages | `{ total, items }` / bare object | No | Migrate to `SuccessResponse` / `ListResponse` |
| Scheduled Messages | `{ total, items }` / bare object | No | Migrate to `SuccessResponse` / `ListResponse` |

**Migration for templates, group-messages, scheduled-messages:**

1. Replace custom `XxxListResponse` schemas (e.g., `TemplateListResponse`) with `ListResponse[XxxResponse]`
2. Wrap single-item GET returns in `SuccessResponse[XxxResponse]`
3. Wrap POST/PATCH returns in `SuccessResponse[XxxResponse]`
4. Add `skip` and `limit` to list responses via `PaginationMeta`
5. Remove the entity-specific `XxxListResponse` classes after migration

### Account API

| Entity | Current Format | Action Required |
|--------|---------------|-----------------|
| Users | Bare array / bare object | Add `SuccessResponse` / `ListResponse` envelope |
| Accounts | Bare array / bare object | Add `SuccessResponse` / `ListResponse` envelope |
| Roles | Bare array / bare object | Add `SuccessResponse` / `ListResponse` envelope |
| Account Users | Bare array / bare object | Add `SuccessResponse` / `ListResponse` envelope |
| Contacts | Bare array / bare object | Add `SuccessResponse` / `ListResponse` envelope |
| Persons | Bare array / bare object | Add `SuccessResponse` / `ListResponse` envelope |
| Groups | Bare array / bare object | Add `SuccessResponse` / `ListResponse` envelope |

**Migration steps:**

1. Create `src/schemas/responses.py` with `SuccessResponse`, `ListResponse`, `PaginationMeta`, `ErrorResponse`
2. Update `create_crud_routes()` in `src/routers/helpers.py` to return envelope responses
3. Update `list_response_model` default from `list[response_model]` to `ListResponse[response_model]`
4. Ensure `controller.get_all()` returns `(items, total)` tuple so `total` is available for `PaginationMeta`
5. Update custom routes (auth, context, group sub-routes) to use `SuccessResponse`

---

## Implementation Reference

### Canonical Schema File

The messaging API's `src/schemas/responses.py` is the canonical source for these schemas. The account API should create an identical `src/schemas/responses.py` with the same class definitions.

### Schema Imports

```python
from src.schemas.responses import (
    SuccessResponse,
    ListResponse,
    PaginationMeta,
    ErrorResponse,
)
```

### Testing

When writing tests, always validate the envelope structure:

```python
# List endpoint
response = client.get("/v1/templates/")
assert response.status_code == 200
body = response.json()
assert body["success"] is True
assert isinstance(body["data"], list)
assert "total" in body["meta"]
assert "skip" in body["meta"]
assert "limit" in body["meta"]

# Single endpoint
response = client.get(f"/v1/templates/{template_id}")
assert response.status_code == 200
body = response.json()
assert body["success"] is True
assert "id" in body["data"]

# Error endpoint
response = client.get("/v1/templates/nonexistent-id")
assert response.status_code == 404
body = response.json()
assert body["success"] is False
assert body["error"] == "not_found"
```

---

*Last updated: February 2025*
