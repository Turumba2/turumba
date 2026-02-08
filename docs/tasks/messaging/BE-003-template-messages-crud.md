# BE-003: Implement Template Messages CRUD API

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** [Turumba2/turumba_messaging_api#10](https://github.com/Turumba2/turumba_messaging_api/issues/10)
**Feature Area:** Template Messages

---

## Summary

Implement the Template Messages domain entity with full CRUD functionality. A Template Message is a reusable message blueprint with variable placeholders (`{VARIABLE_NAME}`) that get replaced with contact-specific data at send time. Templates are essential for group messaging — every group message uses a template so each contact receives a personalized version.

Reference: [Turumba Messaging — Template Messages](../TURUMBA_MESSAGING.md#3-template-messages)

---

## Database: PostgreSQL

Templates are relational (FK to accounts, referenced by messages via `template_id`) and benefit from text search on template body/name. Variable metadata and default values are stored in JSONB.

### Template Model (`src/models/postgres/template.py`)

```python
class Template(PostgresBaseModel):
    __tablename__ = "templates"

    account_id          = Column(UUID, nullable=False, index=True)
    name                = Column(String(255), nullable=False)
    body                = Column(Text, nullable=False)             # template text with {VARIABLE} placeholders
    category            = Column(String(100), nullable=True, index=True)
    channel_type        = Column(String(50), nullable=True, index=True)  # restrict to a channel type, or null for all
    language            = Column(String(10), nullable=True)        # e.g., "en", "am"

    variables           = Column(JSONB, nullable=True, default=list)   # extracted variable names from body
    default_values      = Column(JSONB, nullable=True, default=dict)   # fallback values per variable
    fallback_strategy   = Column(String(50), nullable=False, default="keep_placeholder")

    approval_status     = Column(String(50), nullable=True)        # for channels requiring pre-approval (WhatsApp)
    external_template_id = Column(String(255), nullable=True)      # provider-side template ID

    is_active           = Column(Boolean, nullable=False, default=True)
    created_by_user_id  = Column(UUID, nullable=True)
```

### Enums

**Fallback Strategy:** `keep_placeholder`, `use_default`, `skip_contact`

- `keep_placeholder` — Leave `{VARIABLE}` as-is if unresolved
- `use_default` — Replace with the value from `default_values`
- `skip_contact` — Skip sending to that contact if any variable is unresolved

**Approval Status:** `pending`, `approved`, `rejected` (nullable — only relevant for channels like WhatsApp that require pre-approved templates)

**Channel Types:** `sms`, `smpp`, `telegram`, `whatsapp`, `messenger`, `email` (nullable — `null` means the template works with any channel)

### Variables JSONB

The `variables` field stores the list of placeholder names extracted from the `body`. This is auto-extracted on create/update for quick reference without re-parsing the body.

Example for body `"Hi {FIRST_NAME}, your code is {CODE}"`:
```json
["FIRST_NAME", "CODE"]
```

### Default Values JSONB

Maps variable names to their fallback values, used when `fallback_strategy` is `use_default`.

```json
{
  "FIRST_NAME": "there",
  "CODE": ""
}
```

---

## Tasks

### 1. Model
- [ ] Create `src/models/postgres/template.py`
- [ ] Add import to `src/models/postgres/__init__.py`
- [ ] Create Alembic migration
- [ ] Verify migration applies cleanly

### 2. Schemas (`src/schemas/template.py`)
- [ ] `TemplateCreate` — name, body, category, channel_type, language, default_values, fallback_strategy (optional fields where applicable)
- [ ] `TemplateUpdate` — name, body, category, channel_type, language, default_values, fallback_strategy, is_active (all optional)
- [ ] `TemplateResponse` — all fields including auto-extracted `variables`
- [ ] `TemplateListResponse` — list wrapper with total count
- [ ] Validate `channel_type` against allowed enum values (when provided)
- [ ] Validate `fallback_strategy` against allowed enum values
- [ ] Auto-extract `variables` from `body` on create/update (parse `{VARIABLE_NAME}` placeholders)

### 3. Controller (`src/controllers/template.py`)
- [ ] Extend `CRUDController` with `PostgresFilterStrategy` and `PostgresSortStrategy`
- [ ] Define `FilterSortConfig` (see filter table below)
- [ ] Define `SchemaConfig`
- [ ] Default filter: `account_id:in:{x-account-ids}`
- [ ] Auto-extract variables from body before persisting (override create/update)

### 4. Router (`src/routers/template.py`)
- [ ] `POST /v1/templates/` — Create a new template
- [ ] `GET /v1/templates/` — List templates (filtered, sorted, paginated)
- [ ] `GET /v1/templates/{id}` — Get single template by ID
- [ ] `PATCH /v1/templates/{id}` — Update template
- [ ] `DELETE /v1/templates/{id}` — Delete template
- [ ] All endpoints require authentication

### 5. Register Router
- [ ] Add template router to `src/main.py`

### 6. Tests
- [ ] Create template with variables
- [ ] Verify variables are auto-extracted from body
- [ ] Create template with channel_type restriction
- [ ] List with filters (category, channel_type, is_active, approval_status)
- [ ] List with sorting and pagination
- [ ] Get by ID
- [ ] Update (name, body — verify variables re-extracted)
- [ ] Update default_values and fallback_strategy
- [ ] Delete
- [ ] Account scoping
- [ ] channel_type validation rejects invalid types
- [ ] fallback_strategy validation rejects invalid values

---

## FilterSortConfig

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `name` | `eq`, `contains`, `icontains` | Yes |
| `category` | `eq`, `in` | Yes |
| `channel_type` | `eq`, `in` | Yes |
| `language` | `eq`, `in` | No |
| `is_active` | `eq` | No |
| `approval_status` | `eq`, `in` | No |
| `fallback_strategy` | `eq` | No |
| `created_by_user_id` | `eq` | No |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

---

## Variable Extraction Logic

When a template is created or its `body` is updated, the system should:

1. Parse the body for all `{VARIABLE_NAME}` placeholders using regex (e.g., `r'\{([A-Z_][A-Z0-9_]*)\}'`)
2. Store the extracted variable names in the `variables` JSONB field as a list
3. This is a convenience field — the source of truth is always the `body` text

This allows the frontend to display which variables a template uses without re-parsing the body.

---

## Acceptance Criteria

- [ ] Templates table created via Alembic migration
- [ ] Full CRUD endpoints at `/v1/templates/`
- [ ] Filtering, sorting, pagination working
- [ ] Account scoping via `x-account-ids` header
- [ ] Variables auto-extracted from body on create/update
- [ ] JSONB default_values accepts arbitrary key-value pairs
- [ ] channel_type and fallback_strategy validated against allowed values
- [ ] Tests passing with coverage threshold
- [ ] Ruff passes cleanly

---

## Dependencies

- Issue #1 (Core Architecture Components) — Done
- Issue #3 (Dual Database Support) — Done
- Messages (#8) references `template_id` from this table
