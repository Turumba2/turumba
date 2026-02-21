# BE-007: Multimedia Attachments for Messages, Templates & Scheduled Messages

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** TBD
**GitHub Issue:** TBD
**Feature Area:** Multimedia Messaging

---

## Summary

Extend the messaging API with structured multimedia attachment support. The platform targets channels that natively support rich media — Telegram (photos, videos, documents, audio, stickers, location), WhatsApp (images, video, documents, template header media), Messenger (media attachments), and Email (HTML body + MIME attachments) — but the current data model is **text-only**.

This task adds a unified `attachments` JSONB column to three existing entities: **Messages**, **Templates**, and **Scheduled Messages**. The approach is **URL-based**: the messaging API stores attachment metadata (url, mime_type, file_size, dimensions, etc.) but does **not** handle file uploads or media processing. Media files are hosted externally (S3, CDN, provider URLs); the API stores references only.

**What's in scope:**
- `attachments` JSONB column on `messages`, `templates`, and `scheduled_messages` tables
- `Attachment` Pydantic schema with type-specific validation
- Alembic migration (additive, backward-compatible)
- Full CRUD passthrough (create/read/update attachments alongside existing fields)
- Tests for validation, CRUD, and backward compatibility

**What's NOT in scope:**
- File upload endpoints or media processing (separate future service)
- Channel adapter validation (per-channel size/format limits enforced at dispatch time)
- Media URL accessibility verification (the API trusts the provided URL)
- Template-to-message attachment copy logic (future processor task)
- GroupMessage entity changes (media flows through the referenced template)

Reference: [Turumba Delivery Channels — Channel Types](../../TURUMBA_DELIVERY_CHANNELS.md#channel-types)

---

## Attachment Data Model

### MediaType

```
image | video | audio | document | location | sticker | contact_card
```

| Type | Description | Example Use |
|------|-------------|-------------|
| `image` | Photos, graphics, screenshots | Telegram `sendPhoto`, WhatsApp image message, Email inline image |
| `video` | Video files | Telegram `sendVideo`, WhatsApp video message |
| `audio` | Audio files, voice notes | Telegram `sendAudio`/`sendVoice`, WhatsApp audio message |
| `document` | PDFs, spreadsheets, any file | Telegram `sendDocument`, WhatsApp document, Email MIME attachment |
| `location` | GPS coordinates with optional name | Telegram `sendLocation`, WhatsApp location message |
| `sticker` | Sticker images (WebP, animated) | Telegram `sendSticker` |
| `contact_card` | vCard contact information | Telegram `sendContact`, WhatsApp contact card |

### Attachment Object Schema

Each attachment in the `attachments` array follows this structure:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | MediaType | Yes | The attachment media type |
| `url` | string | Yes* | Media URL — required for all types **except** `location` |
| `mime_type` | string | No | MIME type (e.g., `image/jpeg`, `application/pdf`, `audio/mpeg`) |
| `file_size` | integer | No | File size in bytes (≥ 0) |
| `filename` | string | No | Original filename (especially useful for `document` type) |
| `thumbnail_url` | string | No | Preview/thumbnail URL |
| `caption` | string | No | Media caption (max 3000 chars — used by WhatsApp, Telegram) |
| `width` | integer | No | Width in pixels (valid for `image`, `video`, `sticker` only, ≥ 1) |
| `height` | integer | No | Height in pixels (valid for `image`, `video`, `sticker` only, ≥ 1) |
| `duration` | float | No | Duration in seconds (valid for `audio`, `video` only, ≥ 0) |
| `latitude` | float | No | Latitude (−90 to 90, **required** for `location` type) |
| `longitude` | float | No | Longitude (−180 to 180, **required** for `location` type) |
| `name` | string | No | Location name (valid for `location` type) |
| `address` | string | No | Location street address (valid for `location` type) |

**MAX_ATTACHMENTS = 10** per entity (enforced via Pydantic `max_length` on the list field).

### Example Payloads

**Image attachment (Telegram photo / WhatsApp image):**

```json
{
  "type": "image",
  "url": "https://cdn.example.com/campaigns/summer-promo.jpg",
  "mime_type": "image/jpeg",
  "file_size": 245760,
  "caption": "Summer sale — 30% off all items!",
  "width": 1200,
  "height": 630,
  "thumbnail_url": "https://cdn.example.com/campaigns/summer-promo-thumb.jpg"
}
```

**Document attachment (Email/WhatsApp PDF):**

```json
{
  "type": "document",
  "url": "https://cdn.example.com/invoices/INV-2026-0042.pdf",
  "mime_type": "application/pdf",
  "file_size": 102400,
  "filename": "Invoice-2026-0042.pdf",
  "caption": "Your invoice for February 2026"
}
```

**Audio attachment (Telegram voice / WhatsApp audio):**

```json
{
  "type": "audio",
  "url": "https://cdn.example.com/recordings/welcome.mp3",
  "mime_type": "audio/mpeg",
  "file_size": 512000,
  "duration": 32.5,
  "filename": "welcome-message.mp3"
}
```

**Video attachment:**

```json
{
  "type": "video",
  "url": "https://cdn.example.com/tutorials/setup-guide.mp4",
  "mime_type": "video/mp4",
  "file_size": 5242880,
  "width": 1920,
  "height": 1080,
  "duration": 120.0,
  "caption": "Quick setup guide",
  "thumbnail_url": "https://cdn.example.com/tutorials/setup-guide-poster.jpg"
}
```

**Location attachment (Telegram/WhatsApp location):**

```json
{
  "type": "location",
  "latitude": 9.0192,
  "longitude": 38.7525,
  "name": "Turumba HQ",
  "address": "Bole Road, Addis Ababa, Ethiopia"
}
```

**Sticker attachment (Telegram):**

```json
{
  "type": "sticker",
  "url": "https://cdn.example.com/stickers/welcome.webp",
  "mime_type": "image/webp",
  "file_size": 32768,
  "width": 512,
  "height": 512
}
```

**Contact card attachment:**

```json
{
  "type": "contact_card",
  "url": "https://cdn.example.com/contacts/support-team.vcf",
  "mime_type": "text/vcard",
  "filename": "support-team.vcf"
}
```

**Multiple attachments (Telegram album / Email with multiple files):**

```json
[
  {
    "type": "image",
    "url": "https://cdn.example.com/gallery/photo1.jpg",
    "mime_type": "image/jpeg",
    "caption": "Product front view"
  },
  {
    "type": "image",
    "url": "https://cdn.example.com/gallery/photo2.jpg",
    "mime_type": "image/jpeg",
    "caption": "Product side view"
  },
  {
    "type": "document",
    "url": "https://cdn.example.com/specs/product-datasheet.pdf",
    "mime_type": "application/pdf",
    "filename": "datasheet.pdf"
  }
]
```

---

## Database Changes

Three existing tables modified, zero new tables created.

### Why JSONB (Not a Separate Table)

| Concern | JSONB Approach |
|---------|----------------|
| **Atomic reads** | Attachments are always loaded with the parent entity — no JOIN needed |
| **Write simplicity** | Single INSERT/UPDATE on the parent table — no managing child rows |
| **Bounded cardinality** | Max 10 attachments enforced at the schema level — not an unbounded relationship |
| **No independent lifecycle** | Attachments don't exist without their parent message/template — no orphan cleanup |
| **Query needs** | Filtering by "has attachments" is a simple `attachments IS NOT NULL AND attachments != '[]'` |
| **Schema flexibility** | Different attachment types have different fields — JSONB accommodates this naturally |

### messages table

Add `attachments` JSONB column:

```python
# src/models/postgres/message.py — add to existing Message model

attachments = Column(JSONB, nullable=True, default=list)  # list of Attachment objects
```

Example value on a message record:

```json
[
  {
    "type": "image",
    "url": "https://cdn.example.com/promo.jpg",
    "mime_type": "image/jpeg",
    "file_size": 245760,
    "caption": "Check out our new product!"
  }
]
```

### templates table

Add `attachments` JSONB column:

```python
# src/models/postgres/template.py — add to existing Template model

attachments = Column(JSONB, nullable=True, default=list)  # list of Attachment objects
```

Template attachments serve as **media blueprints** that get copied to messages when the template is used:
- **WhatsApp:** One of the attachments serves as the template header media (image/video/document)
- **Email:** Attachments become MIME parts on the sent email
- **Telegram:** Attachments form an album or individual media messages alongside the text

Example template with header image + PDF attachment:

```json
[
  {
    "type": "image",
    "url": "https://cdn.example.com/templates/newsletter-header.jpg",
    "mime_type": "image/jpeg",
    "caption": "Monthly Newsletter — {MONTH} {YEAR}"
  },
  {
    "type": "document",
    "url": "https://cdn.example.com/templates/brochure.pdf",
    "mime_type": "application/pdf",
    "filename": "brochure.pdf"
  }
]
```

### scheduled_messages table

Add `attachments` JSONB column:

```python
# src/models/postgres/scheduled_message.py — add to existing ScheduledMessage model

attachments = Column(JSONB, nullable=True, default=list)  # list of Attachment objects
```

- **Single-send** (`send_type: "single"`): carries attachments directly on the scheduled message record
- **Group-send** (`send_type: "group"`): media flows through the referenced template — the scheduled message's own `attachments` field can remain empty

Example for a single-send scheduled message:

```json
[
  {
    "type": "image",
    "url": "https://cdn.example.com/events/webinar-invite.png",
    "mime_type": "image/png",
    "caption": "Join us for the webinar on Friday!"
  }
]
```

---

## Template Multimedia — Detailed Flow

### Template Creation with Attachments

When a user creates a template with media:

```
POST /v1/templates/
{
  "name": "Product Launch",
  "body": "Hi {FIRST_NAME}, check out our new {PRODUCT}!",
  "channel_type": "telegram",
  "attachments": [
    {
      "type": "image",
      "url": "https://cdn.example.com/products/new-release.jpg",
      "mime_type": "image/jpeg",
      "caption": "The all-new {PRODUCT}"
    },
    {
      "type": "document",
      "url": "https://cdn.example.com/products/spec-sheet.pdf",
      "mime_type": "application/pdf",
      "filename": "spec-sheet.pdf"
    }
  ]
}
```

The API validates the attachments array and stores them as JSONB on the template record.

### Template Rendering to Individual Message (Future Processor)

When a message is created from a template (via the message processor — **not part of this task**):

1. `message_body` is rendered from the template body with variable substitution
2. Template `attachments` are **copied** to the message's `attachments` field
3. Captions containing `{VARIABLE}` placeholders are also rendered
4. The channel adapter then dispatches text + attachments together

```
Template:
  body: "Hi {FIRST_NAME}, check out our new {PRODUCT}!"
  attachments: [{ type: "image", url: "...", caption: "The all-new {PRODUCT}" }]

→ Message (for contact "Alice", product "Widget Pro"):
  message_body: "Hi Alice, check out our new Widget Pro!"
  attachments: [{ type: "image", url: "...", caption: "The all-new Widget Pro" }]
```

### Group Message Flow

GroupMessage references a template via `template_id`. GroupMessage does **not** get its own `attachments` column.

When the group message processor (future task) creates individual Message records:
1. Each message gets the template body rendered with contact-specific variables
2. Each message gets the template's `attachments` copied over
3. Attachment captions with variables are also rendered per-contact

```
Template (id: "tpl-001"):
  body: "Dear {FIRST_NAME}, your appointment is on {DATE}."
  attachments: [{ type: "document", url: ".../reminder.pdf", caption: "Appointment details" }]

GroupMessage:
  template_id: "tpl-001"
  contact_group_ids: ["group-a"]

→ Message (for contact "Alice"):
  message_body: "Dear Alice, your appointment is on March 5."
  attachments: [{ type: "document", url: ".../reminder.pdf", caption: "Appointment details" }]

→ Message (for contact "Bob"):
  message_body: "Dear Bob, your appointment is on March 7."
  attachments: [{ type: "document", url: ".../reminder.pdf", caption: "Appointment details" }]
```

### Scheduled Message Flow

- **Single send** (`send_type: "single"`): Can carry its own `attachments` directly. If a `template_id` is also set, the processor (future task) can merge or prefer one source — but the column exists on the entity for standalone use.
- **Group send** (`send_type: "group"`): Triggers a GroupMessage, and media flows through the template as described above.

### Channel-Specific Attachment Handling (Documented, Not Implemented)

This section documents how channel adapters (future HSM tasks) will handle attachments. The messaging API stores attachments uniformly; channel-specific dispatch logic lives in the adapters.

| Channel | How Attachments Are Sent | Limits |
|---------|-------------------------|--------|
| **Telegram** | First image → `sendPhoto`, multiple images → `sendMediaGroup` (album), document → `sendDocument`, audio → `sendAudio`, video → `sendVideo`, location → `sendLocation`, sticker → `sendSticker` | 10 items per media group, 50 MB files, 20 MB photos |
| **WhatsApp** | First attachment can be template header media, others sent as separate messages. Image/video/document/audio supported. Location via separate API call. | Images 5 MB, docs 100 MB, audio 16 MB, video 16 MB |
| **Messenger** | Each attachment sent via Graph API `messages` endpoint with `attachment` payload. Supports image, video, audio, file types. | 25 MB per attachment |
| **Email** | Attachments become MIME multipart parts. Images can be inline via Content-ID. Documents as standard MIME attachments. | ~25 MB total (SMTP-provider dependent) |
| **SMS / SMPP** | Attachments ignored or rejected by adapter. Text-only channels. | N/A — text only |

---

## Schema Definitions

### New File: `src/schemas/attachment.py`

```python
from typing import Literal

from pydantic import BaseModel, model_validator, field_validator

MediaType = Literal["image", "video", "audio", "document", "location", "sticker", "contact_card"]

MAX_ATTACHMENTS = 10


class Attachment(BaseModel):
    """
    Represents a media attachment on a message, template, or scheduled message.
    URL-based — the messaging API stores metadata only, not the actual file.
    """

    type: MediaType
    url: str | None = None
    mime_type: str | None = None
    file_size: int | None = None       # bytes, >= 0
    filename: str | None = None
    thumbnail_url: str | None = None
    caption: str | None = None          # max 3000 chars

    # Dimensions (image, video, sticker only)
    width: int | None = None            # >= 1
    height: int | None = None           # >= 1

    # Duration (audio, video only)
    duration: float | None = None       # seconds, >= 0

    # Location fields (location type only)
    latitude: float | None = None       # -90 to 90
    longitude: float | None = None      # -180 to 180
    name: str | None = None             # location name
    address: str | None = None          # location street address

    @model_validator(mode="after")
    def validate_type_specific_fields(self) -> "Attachment":
        # Rule 1: Non-location types require url
        if self.type != "location" and not self.url:
            raise ValueError(f"url is required for {self.type} attachments")

        # Rule 2: Location requires latitude and longitude
        if self.type == "location":
            if self.latitude is None or self.longitude is None:
                raise ValueError(
                    "latitude and longitude are required for location attachments"
                )

        # Rule 5: duration only for audio/video
        if self.duration is not None and self.type not in ("audio", "video"):
            raise ValueError("duration is only valid for audio and video attachments")

        # Rule 6: width/height only for image/video/sticker
        if (self.width is not None or self.height is not None) and self.type not in (
            "image", "video", "sticker"
        ):
            raise ValueError(
                "width/height are only valid for image, video, and sticker attachments"
            )

        return self

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, v: str | None) -> str | None:
        # Rule 3: mime_type must be type/subtype format
        if v is not None:
            parts = v.split("/")
            if len(parts) != 2 or not parts[0] or not parts[1]:
                raise ValueError("Invalid mime_type format — expected 'type/subtype'")
        return v

    @field_validator("file_size")
    @classmethod
    def validate_file_size(cls, v: int | None) -> int | None:
        # Rule 7: file_size >= 0
        if v is not None and v < 0:
            raise ValueError("file_size must be >= 0")
        return v

    @field_validator("caption")
    @classmethod
    def validate_caption(cls, v: str | None) -> str | None:
        # Rule 10: caption max 3000 characters
        if v is not None and len(v) > 3000:
            raise ValueError("caption must not exceed 3000 characters")
        return v

    @field_validator("width", "height")
    @classmethod
    def validate_dimensions(cls, v: int | None) -> int | None:
        # Rule 11: width/height >= 1
        if v is not None and v < 1:
            raise ValueError("width/height must be >= 1")
        return v

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, v: float | None) -> float | None:
        # Rule 8: latitude -90 to 90
        if v is not None and (v < -90 or v > 90):
            raise ValueError("latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, v: float | None) -> float | None:
        # Rule 9: longitude -180 to 180
        if v is not None and (v < -180 or v > 180):
            raise ValueError("longitude must be between -180 and 180")
        return v

    @field_validator("duration")
    @classmethod
    def validate_duration(cls, v: float | None) -> float | None:
        if v is not None and v < 0:
            raise ValueError("duration must be >= 0")
        return v
```

### Modified Schemas

#### Message Schemas (`src/schemas/message.py`)

```python
from src.schemas.attachment import Attachment, MAX_ATTACHMENTS

class MessageCreate(BaseModel):
    # ... existing fields ...
    attachments: list[Attachment] | None = Field(
        default=None, max_length=MAX_ATTACHMENTS
    )

class MessageUpdate(BaseModel):
    # ... existing fields ...
    attachments: list[Attachment] | None = Field(
        default=None, max_length=MAX_ATTACHMENTS
    )

class MessageResponse(BaseModel):
    # ... existing fields ...
    attachments: list[dict[str, Any]] | None = None
```

#### Template Schemas (`src/schemas/template.py`)

```python
from src.schemas.attachment import Attachment, MAX_ATTACHMENTS

class TemplateCreate(BaseModel):
    # ... existing fields ...
    attachments: list[Attachment] | None = Field(
        default=None, max_length=MAX_ATTACHMENTS
    )

class TemplateUpdate(BaseModel):
    # ... existing fields ...
    attachments: list[Attachment] | None = Field(
        default=None, max_length=MAX_ATTACHMENTS
    )

class TemplateResponse(BaseModel):
    # ... existing fields ...
    attachments: list[dict[str, Any]] | None = None
```

#### Scheduled Message Schemas (`src/schemas/scheduled_message.py`)

```python
from src.schemas.attachment import Attachment, MAX_ATTACHMENTS

class ScheduledMessageCreate(BaseModel):
    # ... existing fields ...
    attachments: list[Attachment] | None = Field(
        default=None, max_length=MAX_ATTACHMENTS
    )

class ScheduledMessageUpdate(BaseModel):
    # ... existing fields ...
    attachments: list[Attachment] | None = Field(
        default=None, max_length=MAX_ATTACHMENTS
    )

class ScheduledMessageResponse(BaseModel):
    # ... existing fields ...
    attachments: list[dict[str, Any]] | None = None
```

---

## Validation Rules

| # | Rule | Where Enforced | Error Message |
|---|------|----------------|---------------|
| 1 | Non-location attachments require `url` | `Attachment.model_validator` | `"url is required for {type} attachments"` |
| 2 | Location requires `latitude` and `longitude` | `Attachment.model_validator` | `"latitude and longitude are required for location attachments"` |
| 3 | `mime_type` must be `type/subtype` format | `Attachment.field_validator("mime_type")` | `"Invalid mime_type format — expected 'type/subtype'"` |
| 4 | Max 10 attachments per entity | `Field(max_length=MAX_ATTACHMENTS)` on the list | Pydantic list length enforcement |
| 5 | `duration` only valid for `audio` / `video` | `Attachment.model_validator` | `"duration is only valid for audio and video attachments"` |
| 6 | `width`/`height` only valid for `image` / `video` / `sticker` | `Attachment.model_validator` | `"width/height are only valid for image, video, and sticker attachments"` |
| 7 | `file_size` must be ≥ 0 | `Attachment.field_validator("file_size")` | `"file_size must be >= 0"` |
| 8 | `latitude` range: −90 to 90 | `Attachment.field_validator("latitude")` | `"latitude must be between -90 and 90"` |
| 9 | `longitude` range: −180 to 180 | `Attachment.field_validator("longitude")` | `"longitude must be between -180 and 180"` |
| 10 | `caption` max 3000 characters | `Attachment.field_validator("caption")` | `"caption must not exceed 3000 characters"` |
| 11 | `width`/`height` must be ≥ 1 when provided | `Attachment.field_validator("width", "height")` | `"width/height must be >= 1"` |

---

## Migration

Single Alembic migration modifying three existing tables. No new tables.

### Migration Script

```python
"""Add attachments JSONB column to messages, templates, and scheduled_messages

Revision ID: <auto-generated>
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


def upgrade() -> None:
    op.add_column("messages", sa.Column("attachments", JSONB, nullable=True))
    op.add_column("templates", sa.Column("attachments", JSONB, nullable=True))
    op.add_column("scheduled_messages", sa.Column("attachments", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("scheduled_messages", "attachments")
    op.drop_column("templates", "attachments")
    op.drop_column("messages", "attachments")
```

**Notes:**
- All columns are **nullable** — existing rows remain untouched (`NULL` value)
- No data migration needed — purely additive
- Default `list` in the SQLAlchemy model means new rows get `[]` if no value is provided
- `NULL` vs `[]`: both mean "no attachments" — controllers should treat them equivalently

---

## Tasks

### 1. Attachment Schema Module
- [ ] Create `src/schemas/attachment.py`
- [ ] Define `MediaType` literal type: `image`, `video`, `audio`, `document`, `location`, `sticker`, `contact_card`
- [ ] Define `MAX_ATTACHMENTS = 10` constant
- [ ] Implement `Attachment` Pydantic model with all fields
- [ ] Implement `model_validator` for type-specific cross-field rules (url requirement, location requirement, duration/dimension type checks)
- [ ] Implement `field_validator` for individual field constraints (mime_type format, file_size, caption length, dimension ranges, lat/lon ranges, duration)

### 2. Message Model — Add `attachments` Column
- [ ] Add `attachments = Column(JSONB, nullable=True, default=list)` to `Message` model in `src/models/postgres/message.py`

### 3. Template Model — Add `attachments` Column
- [ ] Add `attachments = Column(JSONB, nullable=True, default=list)` to `Template` model in `src/models/postgres/template.py`

### 4. ScheduledMessage Model — Add `attachments` Column
- [ ] Add `attachments = Column(JSONB, nullable=True, default=list)` to `ScheduledMessage` model in `src/models/postgres/scheduled_message.py`

### 5. Alembic Migration
- [ ] Generate migration: `alembic revision --autogenerate -m "Add attachments JSONB column to messages, templates, and scheduled_messages"`
- [ ] Verify migration adds `attachments` column to all three tables
- [ ] Verify `upgrade()` and `downgrade()` work cleanly
- [ ] Verify existing data is unaffected (NULL values on existing rows)

### 6. Message Schemas — Add `attachments` Field
- [ ] Add `attachments: list[Attachment] | None = Field(default=None, max_length=MAX_ATTACHMENTS)` to `MessageCreate`
- [ ] Add `attachments: list[Attachment] | None = Field(default=None, max_length=MAX_ATTACHMENTS)` to `MessageUpdate`
- [ ] Add `attachments: list[dict[str, Any]] | None = None` to `MessageResponse`

### 7. Template Schemas — Add `attachments` Field
- [ ] Add `attachments: list[Attachment] | None = Field(default=None, max_length=MAX_ATTACHMENTS)` to `TemplateCreate`
- [ ] Add `attachments: list[Attachment] | None = Field(default=None, max_length=MAX_ATTACHMENTS)` to `TemplateUpdate`
- [ ] Add `attachments: list[dict[str, Any]] | None = None` to `TemplateResponse`

### 8. ScheduledMessage Schemas — Add `attachments` Field
- [ ] Add `attachments: list[Attachment] | None = Field(default=None, max_length=MAX_ATTACHMENTS)` to `ScheduledMessageCreate`
- [ ] Add `attachments: list[Attachment] | None = Field(default=None, max_length=MAX_ATTACHMENTS)` to `ScheduledMessageUpdate`
- [ ] Add `attachments: list[dict[str, Any]] | None = None` to `ScheduledMessageResponse`

### 9. Controller / Service Review
- [ ] Verify `CRUDController` passthrough works — JSONB columns should be handled automatically by SQLAlchemy
- [ ] Verify `model_to_response()` includes the new `attachments` field in both "single" and "list" contexts
- [ ] No controller overrides needed — `attachments` is a simple data column with no special business logic at this layer

### 10. Event Payload Updates (If BE-006 Is Wired)
- [ ] If event infrastructure (BE-006) is wired to message creation, add `has_attachments: bool` and `attachment_count: int` to the event payload
- [ ] These are lightweight metadata fields — the full attachment data should NOT be in the event payload (events should be small)
- [ ] If BE-006 is not yet wired, document this as a follow-up integration point

### 11. Tests
- [ ] Attachment schema validation tests (see test plan below)
- [ ] Message CRUD with attachments
- [ ] Template CRUD with attachments
- [ ] ScheduledMessage CRUD with attachments
- [ ] Backward compatibility tests
- [ ] Multi-attachment scenario tests

---

## Tests

### Attachment Schema Validation (11 cases)

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Create valid image attachment (url, mime_type, dimensions) | Passes validation |
| 2 | Create valid document attachment (url, mime_type, filename) | Passes validation |
| 3 | Create valid location attachment (latitude, longitude, name) | Passes validation |
| 4 | Create valid audio attachment (url, duration) | Passes validation |
| 5 | Image attachment without `url` | Fails: `"url is required for image attachments"` |
| 6 | Location attachment without `latitude` | Fails: `"latitude and longitude are required for location attachments"` |
| 7 | Image attachment with `duration` field | Fails: `"duration is only valid for audio and video attachments"` |
| 8 | Document attachment with `width`/`height` | Fails: `"width/height are only valid for image, video, and sticker attachments"` |
| 9 | Attachment with invalid `mime_type` format (e.g., `"jpeg"`) | Fails: `"Invalid mime_type format"` |
| 10 | Attachment with negative `file_size` | Fails: `"file_size must be >= 0"` |
| 11 | Attachment with `width: 0` | Fails: `"width/height must be >= 1"` |

### Message CRUD with Attachments (7 cases)

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Create message with single image attachment | Message created, attachments stored as JSONB |
| 2 | Create message with multiple attachments (image + document) | Both attachments stored |
| 3 | Create message without attachments (backward compat) | Message created, attachments is `null` |
| 4 | Read message with attachments | Response includes `attachments` array |
| 5 | Update message — add attachments | Attachments field updated |
| 6 | Update message — clear attachments (set to `[]`) | Attachments cleared |
| 7 | Update message — invalid attachment rejected | 422 validation error |

### Template CRUD with Attachments (7 cases)

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Create template with image + document attachments | Template created with attachments |
| 2 | Create template with caption containing `{VARIABLE}` | Stored as-is (rendered at dispatch time) |
| 3 | Create template without attachments (backward compat) | Template created, attachments is `null` |
| 4 | Read template with attachments | Response includes `attachments` array |
| 5 | Update template — replace attachments | Attachments overwritten |
| 6 | Update template — clear attachments (set to `[]`) | Attachments cleared |
| 7 | Update template body — attachments unchanged | Only body updated, attachments preserved |

### ScheduledMessage CRUD with Attachments (5 cases)

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Create single-send scheduled message with attachments | ScheduledMessage created with attachments |
| 2 | Create group-send scheduled message (no attachments — media via template) | Created with `null` attachments |
| 3 | Read scheduled message with attachments | Response includes `attachments` array |
| 4 | Update scheduled message — modify attachments | Attachments updated |
| 5 | Update scheduled message — clear attachments | Attachments cleared |

### Backward Compatibility (3 cases)

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Existing messages without attachments column still readable | `attachments` returns `null` in response |
| 2 | Create message with no `attachments` field in request body | Message created successfully, attachments is `null` |
| 3 | List endpoint returns messages with and without attachments | Mixed results returned correctly |

### Multi-Attachment Scenarios (2 cases)

| # | Test Case | Expected Result |
|---|-----------|-----------------|
| 1 | Create message with mixed attachment types (image + location + document) | All attachment types validated and stored |
| 2 | Create message with 11 attachments (exceeds MAX_ATTACHMENTS) | 422 validation error — list too long |

---

## Acceptance Criteria

- [ ] `attachments` JSONB column added to `messages`, `templates`, and `scheduled_messages` tables via Alembic migration
- [ ] Migration applies cleanly on existing data (no data migration required)
- [ ] `Attachment` Pydantic schema validates all 7 media types with type-specific rules
- [ ] All 11 validation rules enforced and producing correct error messages
- [ ] `POST`, `PATCH` endpoints for messages, templates, and scheduled messages accept `attachments` in the request body
- [ ] `GET` endpoints return `attachments` in the response body
- [ ] Max 10 attachments per entity enforced
- [ ] Existing records without attachments continue to work (backward compatibility)
- [ ] Creating entities without `attachments` field works as before
- [ ] 35+ tests passing covering validation, CRUD, backward compatibility, and edge cases
- [ ] Test coverage ≥ 80%
- [ ] Ruff passes cleanly

---

## Dependencies

- BE-001 (Messages CRUD) — Done
- BE-003 (Template Messages CRUD) — Done
- BE-005 (Scheduled Messages CRUD) — Done

**No blocking dependencies.** This task is purely additive to existing entities.

---

## Notes

### Channel-Level Validation

Channel adapters (HSM-001 through HSM-005) will enforce per-channel constraints at dispatch time:
- Telegram: max 10 photos per album, 50 MB files, 20 MB photos
- WhatsApp: images 5 MB, docs 100 MB, audio 16 MB, video 16 MB
- Messenger: 25 MB per attachment
- Email: ~25 MB total

The messaging API intentionally does **not** enforce channel-specific limits — it's a channel-agnostic store. This keeps the core API simple and avoids coupling to external provider constraints that may change.

### Media URL Accessibility

The API does **not** verify that the provided URL is accessible. This is a deliberate choice:
- URLs may be behind signed-URL mechanisms that expire and get regenerated at dispatch time
- URLs may be CDN URLs that are only accessible from certain regions
- Verifying URLs at creation time would add latency and fragility to the write path

### Template-to-Message Copy

The actual logic to copy template attachments to generated messages is a future processor concern (when group message and scheduled message processors are implemented). This task only adds the data model — the copy logic is out of scope.

### GroupMessage Exclusion

`group_messages` does **not** get an `attachments` column. GroupMessage always references a template, and media flows through that template. Adding attachments to GroupMessage would create ambiguity (template attachments vs. group message attachments) with no clear benefit.

### NULL vs Empty Array

Both `NULL` and `[]` mean "no attachments." The API should treat them equivalently in read paths. New records that explicitly set attachments get `[]`; existing records that predate the migration get `NULL`. Response serialization should normalize both to `null` or `[]` consistently (recommended: return `null` when no attachments exist, to match the pattern used by other nullable JSONB fields like `metadata` and `error_details`).
