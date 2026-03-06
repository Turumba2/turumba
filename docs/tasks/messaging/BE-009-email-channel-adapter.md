# BE-009: Email Channel Adapter — SendGrid Provider

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**GitHub Issue:** [Turumba2/turumba_messaging_api#58](https://github.com/Turumba2/turumba_messaging_api/issues/58)
**Feature Area:** Channel Adapters

---

## Summary

Implement an Email channel adapter using the existing adapter strategy pattern (`src/adapters/`), with **SendGrid** as the default provider. This follows the same architecture as the Telegram adapter — a class decorated with `@register_adapter("email")` implementing the 6 abstract methods of `ChannelAdapter`.

The adapter handles:
- **Outbound**: Sending emails (text, HTML, attachments) via the SendGrid v3 Mail Send API
- **Inbound**: Parsing SendGrid Inbound Parse webhook payloads into `InboundMessage`
- **Status tracking**: Parsing SendGrid Event Webhook payloads (delivered, bounced, opened, etc.) into `StatusUpdate`
- **Webhook security**: Verifying SendGrid's signed webhook signature (ECDSA)
- **Credential verification**: Validating API key via a lightweight SendGrid API call
- **Health checks**: Checking SendGrid API availability

Reference: [Telegram Adapter](../../../turumba_messaging_api/src/adapters/telegram/telegram_adapter.py) as the implementation template.

---

## Architecture

```
POST /messages (email)
    │
    ▼
outbox_worker → message.dispatch.email queue
    │
    ▼
dispatch_worker --channel-type email
    │
    ▼
EmailAdapter.send(payload)
    │
    ├── Text-only → SendGrid POST /v3/mail/send (text/plain)
    ├── HTML body  → SendGrid POST /v3/mail/send (text/html)
    └── With attachment → SendGrid POST /v3/mail/send (with attachments array)
    │
    ▼
DispatchResult { provider_message_id: x-message-id, status: "sent" }


SendGrid Event Webhook → POST /webhooks/email/{channel_id}
    │
    ▼
EmailAdapter.parse_status_update(raw_payload)
    │
    ├── "delivered" → StatusUpdate(status="delivered")
    ├── "bounce"    → StatusUpdate(status="failed", error_code="bounce")
    ├── "dropped"   → StatusUpdate(status="failed", error_code="dropped")
    ├── "open"      → StatusUpdate(status="read")  [if tracking enabled]
    └── other       → None (ignored)
    │
    ▼
status_update_worker → updates Message status


SendGrid Inbound Parse → POST /webhooks/email/{channel_id}
    │
    ▼
EmailAdapter.parse_inbound(raw_payload)
    │
    ▼
InboundMessage { sender_address, message_body, metadata: { subject, ... } }
    │
    ▼
inbound_message_worker → creates Message record
```

---

## Credentials Format

Email channels store credentials in the `credentials` JSONB column:

```json
{
  "api_key": "SG.xxxx...",
  "from_email": "noreply@example.com",
  "from_name": "Turumba Notifications",
  "webhook_signing_key": "MFkwEwYH...",
  "reply_to_email": "support@example.com",
  "tracking_enabled": true
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `api_key` | Yes | SendGrid API key with `Mail Send` permission |
| `from_email` | Yes | Verified sender email address |
| `from_name` | No | Display name for the sender (defaults to `from_email`) |
| `webhook_signing_key` | No | SendGrid Event Webhook verification key (ECDSA public key) |
| `reply_to_email` | No | Reply-To header address |
| `tracking_enabled` | No | Enable open/click tracking (default: `false`) |

---

## SendGrid API Reference

### Send Email (v3 Mail Send)

**Endpoint:** `POST https://api.sendgrid.com/v3/mail/send`

**Headers:**
```
Authorization: Bearer {api_key}
Content-Type: application/json
```

**Request body (text + HTML):**
```json
{
  "personalizations": [
    {
      "to": [{ "email": "recipient@example.com" }],
      "subject": "Message Subject"
    }
  ],
  "from": { "email": "noreply@example.com", "name": "Turumba" },
  "reply_to": { "email": "support@example.com" },
  "content": [
    { "type": "text/plain", "value": "Plain text body" },
    { "type": "text/html", "value": "<p>HTML body</p>" }
  ],
  "attachments": [
    {
      "content": "<base64-encoded>",
      "type": "application/pdf",
      "filename": "report.pdf",
      "disposition": "attachment"
    }
  ],
  "tracking_settings": {
    "open_tracking": { "enable": true },
    "click_tracking": { "enable": false }
  }
}
```

**Success:** `202 Accepted` with `x-message-id` header (provider message ID)
**Auth failure:** `401 Unauthorized`
**Rate limit:** `429 Too Many Requests`

### Verify API Key

**Endpoint:** `GET https://api.sendgrid.com/v3/scopes`

Lightweight call that returns the API key's permissions. A successful `200` response confirms the key is valid.

---

## SendGrid Webhook Payloads

### Event Webhook (Status Updates)

SendGrid delivers batched events as a JSON array:

```json
[
  {
    "email": "recipient@example.com",
    "timestamp": 1709500000,
    "event": "delivered",
    "sg_message_id": "abc123.filterxxx",
    "response": "250 OK",
    "smtp-id": "<abc123@example.com>"
  },
  {
    "email": "recipient@example.com",
    "timestamp": 1709500010,
    "event": "bounce",
    "sg_message_id": "abc123.filterxxx",
    "type": "bounce",
    "reason": "550 User not found",
    "status": "5.1.1"
  }
]
```

**Event type mapping:**

| SendGrid Event | Maps To | DeliveryStatus |
|----------------|---------|----------------|
| `delivered` | StatusUpdate | `"delivered"` |
| `bounce` | StatusUpdate | `"failed"` (error_code: `"bounce"`) |
| `dropped` | StatusUpdate | `"failed"` (error_code: `"dropped"`) |
| `deferred` | StatusUpdate | `"sent"` (still in transit) |
| `open` | StatusUpdate | `"read"` (if tracking enabled) |
| `processed` | Ignored | — |
| `click` | Ignored | — |
| `unsubscribe` | Ignored | — |
| `spamreport` | Ignored | — |

**Important:** SendGrid sends events as a JSON **array** (batch), even for a single event. The adapter's `parse_status_update()` must handle this — return the **first actionable** status update, and the webhook handler processes each event in the array by calling `parse_status_update` per element. See implementation notes below.

### Event Webhook Signature Verification

SendGrid signs Event Webhook payloads using **ECDSA** with the `X-Twilio-Email-Event-Webhook-Signature` header and `X-Twilio-Email-Event-Webhook-Timestamp` header.

Verification steps:
1. Concatenate: `timestamp + payload_body` (raw bytes)
2. Verify the ECDSA signature (base64-decoded) against the concatenated data using the public key from `webhook_signing_key` credential
3. Use `cryptography` library's `ec.ECDSA(hashes.SHA256())` for verification

### Inbound Parse Webhook

SendGrid Inbound Parse sends multipart/form-data:

```
POST /webhooks/email/{channel_id}
Content-Type: multipart/form-data

from=sender@example.com
to=inbox@turumba.example.com
subject=Re: Order #12345
text=Plain text body
html=<p>HTML body</p>
envelope={"from":"sender@example.com","to":["inbox@turumba.example.com"]}
headers=Received: from ... \nMessage-ID: <abc@example.com>\n...
attachments=2
attachment1=<file>
attachment2=<file>
```

**Distinguishing inbound vs. event webhooks:** The webhook handler must detect whether the payload is an inbound email (multipart form data with `from`/`to`/`subject`) or a status event (JSON array with `event` field). Check `Content-Type` header:
- `application/json` → Event Webhook → `parse_status_update()`
- `multipart/form-data` → Inbound Parse → `parse_inbound()`

---

## Implementation

### 1. File Structure

```
src/adapters/email/
├── __init__.py             # Re-export EmailAdapter
└── email_adapter.py        # Full implementation
```

### 2. EmailAdapter Class (`src/adapters/email/email_adapter.py`)

```python
@register_adapter("email")
class EmailAdapter(ChannelAdapter):
    """Concrete adapter for the SendGrid Email API.

    Credentials format::

        {
            "api_key": "SG.xxxx...",
            "from_email": "noreply@example.com",
            "from_name": "Turumba",             # optional
            "webhook_signing_key": "MFkw...",    # optional (ECDSA public key)
            "reply_to_email": "support@...",     # optional
            "tracking_enabled": false            # optional
        }
    """
```

### 3. Method Implementations

#### `send(payload: DispatchPayload) -> DispatchResult`

```
1. Extract credentials: api_key, from_email, from_name
2. Validate required: api_key, from_email → AdapterPayloadError if missing
3. Build SendGrid v3 Mail Send payload:
   - personalizations[0].to = [{ email: payload.delivery_address }]
   - personalizations[0].subject = payload.metadata.get("subject", "Message")
   - from = { email: from_email, name: from_name }
   - reply_to = { email: reply_to_email } if set
   - content:
     - If metadata["content_type"] == "html":
       content = [{ type: "text/html", value: payload.message_body }]
     - Else:
       content = [{ type: "text/plain", value: payload.message_body }]
     - If metadata["html_body"] is set alongside text:
       content = [
         { type: "text/plain", value: payload.message_body },
         { type: "text/html", value: metadata["html_body"] }
       ]
   - If payload.media_url and payload.media_type:
     - Fetch the file from media_url (HTTP GET)
     - Base64-encode content
     - Add to attachments[] with filename from URL or metadata["filename"]
     - Map media_type to MIME: image→image/png, document→application/octet-stream, etc.
   - tracking_settings based on credentials["tracking_enabled"]
4. POST to https://api.sendgrid.com/v3/mail/send
   - Authorization: Bearer {api_key}
5. Handle response:
   - 202: Success → DispatchResult(success=True, provider_message_id=resp.headers["x-message-id"])
   - 401: AdapterAuthError("Invalid SendGrid API key")
   - 429: AdapterRateLimitError with Retry-After header
   - 400: DispatchResult(success=False, retryable=False) — bad payload
   - 5xx: DispatchResult(success=False, retryable=True)
6. Catch httpx.RequestError → raise AdapterConnectionError
```

#### `verify_credentials(credentials: dict) -> bool`

```
1. Extract api_key → return False if missing
2. GET https://api.sendgrid.com/v3/scopes
   - Authorization: Bearer {api_key}
3. Return True if status == 200
4. Return False on any error (network, 401, etc.)
```

#### `check_health() -> ChannelHealth`

```
1. GET https://api.sendgrid.com/v3/scopes (lightweight, no side effects)
   - Requires an api_key stored from recent verify_credentials
   - Since adapters are stateless, return "unknown" with message
     suggesting verify_credentials (same pattern as Telegram)
```

> **Note:** Like Telegram, the adapter is stateless (no stored credentials), so `check_health()` returns `HealthStatus("unknown")` with a message suggesting `verify_credentials`. If you want an active health check, the caller must pass credentials separately (future enhancement).

#### `parse_inbound(raw_payload: dict) -> InboundMessage | None`

```
1. Check for "from" and "to" keys (Inbound Parse fields)
   - Return None if not present (not an inbound email payload)
2. Extract:
   - sender_address = raw_payload["from"] (or envelope.from)
   - message_body = raw_payload.get("text", "")
   - If no text but html present: strip HTML tags for plain text fallback
3. Build metadata:
   - subject = raw_payload.get("subject", "")
   - to = raw_payload.get("to", "")
   - html_body = raw_payload.get("html")
   - message_id = extract Message-ID from headers string
   - attachment_count = int(raw_payload.get("attachments", 0))
   - envelope = json.loads(raw_payload.get("envelope", "{}"))
   - spam_score = raw_payload.get("spam_score")
   - SPF = raw_payload.get("SPF")
4. provider_message_id = Message-ID from headers (or generate UUID if not present)
5. timestamp = parse Date header, fallback to datetime.now(UTC)
6. media_type = "document" if attachment_count > 0 else None
7. Return InboundMessage(...)
8. Raise AdapterPayloadError if "from" present but required fields malformed
```

#### `parse_status_update(raw_payload: dict) -> StatusUpdate | None`

```
1. Check for "event" key → return None if not present
   (This method handles a SINGLE event object, not the array.
    The webhook handler is responsible for iterating the array.)
2. Map event type:
   - "delivered" → DeliveryStatus "delivered"
   - "bounce"    → DeliveryStatus "failed"
   - "dropped"   → DeliveryStatus "failed"
   - "deferred"  → DeliveryStatus "sent"
   - "open"      → DeliveryStatus "read"
   - Others      → return None (not actionable)
3. Extract:
   - provider_message_id = raw_payload["sg_message_id"] (strip filter suffix after first ".")
   - status = mapped status
   - timestamp = datetime.fromtimestamp(raw_payload["timestamp"], tz=UTC)
   - error_code = raw_payload.get("type") or event name for failures
   - error_message = raw_payload.get("reason")
   - metadata = { email: raw_payload.get("email"), response: raw_payload.get("response") }
4. Return StatusUpdate(...)
5. Return None for unmapped/non-actionable events
```

> **Important:** The `sg_message_id` from SendGrid looks like `"abc123.filterdrecv-p3iad1-5765874-64109-5784.1"`. The dispatch response's `x-message-id` header returns only the base ID (e.g., `"abc123"`). The adapter must normalize both: strip everything after the first `.` when comparing.

#### `verify_webhook_signature(headers: dict, body: bytes, secret: str) -> bool`

```
1. If not secret: return True (no verification configured)
2. Extract:
   - signature = headers.get("x-twilio-email-event-webhook-signature", "")
   - timestamp = headers.get("x-twilio-email-event-webhook-timestamp", "")
3. Concatenate: payload = timestamp.encode() + body
4. Load ECDSA public key from secret (PEM/DER format)
5. Verify signature against payload using SHA256
6. Return True if valid, False otherwise
7. Catch any cryptography errors → return False
```

---

## Webhook Handler Updates

### Email Webhook Router (`src/routers/webhooks/email.py`)

The current email webhook handler delegates to `verify_and_parse()`. Two updates needed:

#### 1. Handle Batched Events

SendGrid Event Webhook sends a JSON **array** of events. The common `process_webhook()` function calls `parse_status_update()` once, but email payloads contain multiple events. Add a loop:

```python
@router.post("/{channel_id}")
async def receive_email_webhook(
    channel_id: str,
    request: Request,
    db: Session = Depends(get_postgres_db),
):
    content_type = request.headers.get("content-type", "")

    if "multipart/form-data" in content_type:
        # Inbound Parse — standard flow
        return await verify_and_parse(channel_id, request, db)

    # Event Webhook — batched JSON array
    channel = await load_channel(db, channel_id)
    body = await request.body()
    raw_events = json.loads(body)

    adapter = get_adapter("email")
    secret = get_webhook_secret(channel)

    if not adapter.verify_webhook_signature(request.headers, body, secret):
        raise HTTPException(status_code=403, detail="Invalid signature")

    for event in raw_events:
        status_update = adapter.parse_status_update(event)
        if status_update:
            await publish_status_update(channel, status_update)

    return {"status": "ok"}
```

#### 2. Handle Inbound Parse (multipart/form-data)

The `verify_and_parse` common function expects JSON. For Inbound Parse, the webhook receives `multipart/form-data`. Either:
- Parse form data to dict in the email webhook handler before calling `parse_inbound`
- Or update the common function to detect content type

**Recommended:** Parse form data in the email handler and pass the resulting dict to `adapter.parse_inbound()`:

```python
if "multipart/form-data" in content_type:
    form = await request.form()
    raw_payload = {key: form[key] for key in form}
    inbound = adapter.parse_inbound(raw_payload)
    if inbound:
        await publish_inbound_message(channel, inbound)
    return {"status": "ok"}
```

---

## Configuration

### Environment Variables

Add to `src/config/config.py`:

```python
# SendGrid
SENDGRID_API_BASE: str = "https://api.sendgrid.com"
```

### Dependencies

Add to `requirements.txt`:

```
cryptography>=42.0    # for ECDSA webhook signature verification
```

> **Note:** `httpx` is already a dependency (used by TelegramAdapter). No additional HTTP library needed.

---

## Registration

### Adapter Registration (`src/adapters/__init__.py`)

Add the import to trigger `@register_adapter("email")`:

```python
# Existing
import src.adapters.telegram  # noqa: F401

# Add
import src.adapters.email     # noqa: F401
```

### Smoke Test Update (`src/workers/smoke_test.py`)

Add email credentials mapping:

```python
CREDENTIALS_MAP = {
    "telegram": lambda args: {"bot_token": args.bot_token},
    "email": lambda args: {
        "api_key": args.api_key,
        "from_email": args.from_email,
    },
}
```

Add CLI arguments for `--api-key` and `--from-email`.

---

## Tasks

### 1. EmailAdapter — Core Class

- [ ] Create `src/adapters/email/__init__.py` — re-export `EmailAdapter`
- [ ] Create `src/adapters/email/email_adapter.py` — class decorated with `@register_adapter("email")`
- [ ] Define credentials docstring format (api_key, from_email, from_name, webhook_signing_key, reply_to_email, tracking_enabled)

### 2. `send()` — Outbound Email Dispatch

- [ ] Extract and validate `api_key` and `from_email` from credentials → `AdapterPayloadError` if missing
- [ ] Build SendGrid v3 Mail Send request payload:
  - `personalizations` with recipient email (`delivery_address`) and subject from `metadata["subject"]`
  - `from` with email and optional display name
  - `reply_to` from credentials if set
  - `content` array: text/plain for default, text/html if `metadata["content_type"] == "html"`, or both if `metadata["html_body"]` is set
- [ ] Handle attachments: if `media_url` is set, fetch the file via HTTP GET, base64-encode, add to `attachments[]` with filename and MIME type
- [ ] Set `tracking_settings` based on `credentials["tracking_enabled"]`
- [ ] POST to `{SENDGRID_API_BASE}/v3/mail/send` with `Authorization: Bearer {api_key}`
- [ ] Handle `202 Accepted`: return `DispatchResult(success=True, provider_message_id=resp.headers["x-message-id"])`
- [ ] Handle `401`: raise `AdapterAuthError`
- [ ] Handle `429`: raise `AdapterRateLimitError` with `Retry-After` header value
- [ ] Handle `400`: return `DispatchResult(success=False, retryable=False)`
- [ ] Handle `5xx`: return `DispatchResult(success=False, retryable=True)`
- [ ] Catch `httpx.RequestError`: raise `AdapterConnectionError`

### 3. `verify_credentials()` — API Key Validation

- [ ] Extract `api_key` → return `False` if missing
- [ ] GET `{SENDGRID_API_BASE}/v3/scopes` with `Authorization: Bearer {api_key}`
- [ ] Return `True` if status 200, `False` otherwise
- [ ] Catch all exceptions → return `False`

### 4. `check_health()` — Health Check

- [ ] Return `ChannelHealth(status="unknown")` with message suggesting `verify_credentials`
- [ ] Same pattern as TelegramAdapter (stateless adapters have no stored credentials)

### 5. `parse_inbound()` — Inbound Email Parsing

- [ ] Check for `"from"` and `"to"` keys in payload → return `None` if absent
- [ ] Extract `sender_address` from `from` field (parse email from display name format `"Name <email>"`)
- [ ] Extract `message_body` from `text` field, fall back to stripped `html` field
- [ ] Build metadata: `subject`, `to`, `html_body`, `message_id` (from headers), `attachment_count`, `envelope`, `spam_score`, `SPF`
- [ ] Extract `provider_message_id` from `Message-ID` header, fallback to generated UUID
- [ ] Parse `timestamp` from `Date` header, fallback to `datetime.now(UTC)`
- [ ] Set `media_type = "document"` if `attachment_count > 0`
- [ ] Raise `AdapterPayloadError` if `from` is present but required fields are malformed

### 6. `parse_status_update()` — Delivery Status Parsing

- [ ] Check for `"event"` key → return `None` if absent
- [ ] Map SendGrid events: `delivered` → `"delivered"`, `bounce`/`dropped` → `"failed"`, `deferred` → `"sent"`, `open` → `"read"`
- [ ] Return `None` for unmapped events (`processed`, `click`, `unsubscribe`, `spamreport`)
- [ ] Extract `provider_message_id` from `sg_message_id` — **strip filter suffix** (everything after first `.`)
- [ ] Extract `timestamp`, `error_code`, `error_message`, and metadata (`email`, `response`)
- [ ] Return `StatusUpdate(...)` with mapped values

### 7. `verify_webhook_signature()` — ECDSA Verification

- [ ] If no secret: return `True` (skip verification)
- [ ] Extract `x-twilio-email-event-webhook-signature` and `x-twilio-email-event-webhook-timestamp` from headers
- [ ] Concatenate: `timestamp_bytes + body`
- [ ] Load ECDSA public key from secret string (PEM format)
- [ ] Verify signature using `cryptography` library (`ec.ECDSA(hashes.SHA256())`)
- [ ] Return `True` if valid, `False` if invalid or on any exception

### 8. Webhook Handler Update

- [ ] Update `src/routers/webhooks/email.py` to detect `Content-Type`:
  - `multipart/form-data` → parse form data to dict → `adapter.parse_inbound()`
  - `application/json` → iterate event array → `adapter.parse_status_update()` per event
- [ ] Verify webhook signature once for the entire batch (not per event)
- [ ] Publish each status update to RabbitMQ individually
- [ ] Publish inbound message to RabbitMQ
- [ ] Return `200 OK` on success (SendGrid expects this to not retry)

### 9. Registration & Configuration

- [ ] Add `import src.adapters.email` to `src/adapters/__init__.py`
- [ ] Add `SENDGRID_API_BASE` to `src/config/config.py` (default: `https://api.sendgrid.com`)
- [ ] Add `cryptography>=42.0` to `requirements.txt`
- [ ] Update `smoke_test.py`: add email credentials mapping and CLI args (`--api-key`, `--from-email`)

### 10. Tests

#### Unit Tests (`tests/unit/test_email_adapter.py`)

- [ ] **Registration:** `get_adapter("email")` returns `EmailAdapter` instance
- [ ] **send — text:** Builds correct SendGrid payload for plain text, returns `DispatchResult` with `x-message-id`
- [ ] **send — HTML:** Sets `content[0].type = "text/html"` when `metadata["content_type"] == "html"`
- [ ] **send — dual content:** Sends both text/plain and text/html when `metadata["html_body"]` is set
- [ ] **send — with subject:** Uses `metadata["subject"]` in `personalizations[0].subject`
- [ ] **send — with reply_to:** Includes `reply_to` in payload when credential is set
- [ ] **send — attachment:** Fetches `media_url`, base64-encodes, adds to `attachments[]`
- [ ] **send — missing api_key:** Raises `AdapterPayloadError`
- [ ] **send — missing from_email:** Raises `AdapterPayloadError`
- [ ] **send — 401 response:** Raises `AdapterAuthError`
- [ ] **send — 429 response:** Raises `AdapterRateLimitError` with `retry_after`
- [ ] **send — 400 response:** Returns `DispatchResult(success=False, retryable=False)`
- [ ] **send — 500 response:** Returns `DispatchResult(success=False, retryable=True)`
- [ ] **send — network error:** Raises `AdapterConnectionError`
- [ ] **verify_credentials — valid key:** Returns `True` on 200
- [ ] **verify_credentials — invalid key:** Returns `False` on 401
- [ ] **verify_credentials — missing key:** Returns `False`
- [ ] **verify_credentials — network error:** Returns `False`
- [ ] **check_health:** Returns `ChannelHealth(status="unknown")`
- [ ] **parse_inbound — valid email:** Returns `InboundMessage` with sender, body, subject in metadata
- [ ] **parse_inbound — HTML only:** Falls back to stripped HTML for message_body
- [ ] **parse_inbound — with attachments:** Sets `media_type = "document"`, `attachment_count` in metadata
- [ ] **parse_inbound — not an inbound payload:** Returns `None`
- [ ] **parse_inbound — malformed:** Raises `AdapterPayloadError`
- [ ] **parse_status_update — delivered:** Returns `StatusUpdate(status="delivered")`
- [ ] **parse_status_update — bounce:** Returns `StatusUpdate(status="failed", error_code="bounce")`
- [ ] **parse_status_update — dropped:** Returns `StatusUpdate(status="failed", error_code="dropped")`
- [ ] **parse_status_update — deferred:** Returns `StatusUpdate(status="sent")`
- [ ] **parse_status_update — open:** Returns `StatusUpdate(status="read")`
- [ ] **parse_status_update — processed/click/unsubscribe:** Returns `None`
- [ ] **parse_status_update — sg_message_id normalization:** Strips filter suffix (`.filter...` → base ID)
- [ ] **parse_status_update — missing event key:** Returns `None`
- [ ] **verify_webhook_signature — valid signature:** Returns `True`
- [ ] **verify_webhook_signature — invalid signature:** Returns `False`
- [ ] **verify_webhook_signature — no secret:** Returns `True`
- [ ] **verify_webhook_signature — missing headers:** Returns `False`

#### Integration Tests

- [ ] **Webhook — event batch:** POST JSON array of events, verify each is published to RabbitMQ
- [ ] **Webhook — inbound email:** POST multipart form data, verify `InboundMessage` published
- [ ] **Webhook — signature rejection:** POST with bad signature, expect 403
- [ ] **Dispatch pipeline:** Create message with email channel, verify dispatch worker calls `EmailAdapter.send()`

---

## Acceptance Criteria

- [ ] `EmailAdapter` registered via `@register_adapter("email")` — `get_adapter("email")` returns instance
- [ ] `send()` dispatches emails via SendGrid v3 API with text, HTML, and attachment support
- [ ] `send()` correctly handles all HTTP status codes (202, 401, 429, 400, 5xx)
- [ ] `verify_credentials()` validates API key via `/v3/scopes`
- [ ] `parse_inbound()` handles SendGrid Inbound Parse multipart payloads
- [ ] `parse_status_update()` maps SendGrid events to `StatusUpdate` with correct status values
- [ ] `sg_message_id` is normalized (suffix stripped) to match `x-message-id` from send response
- [ ] `verify_webhook_signature()` performs ECDSA verification of SendGrid signed webhooks
- [ ] Email webhook handler processes both JSON event batches and multipart inbound payloads
- [ ] All unit tests passing
- [ ] Ruff passes cleanly
- [ ] Coverage threshold met (80%+)
- [ ] Smoke test works: `python -m src.workers.smoke_test --channel-type email --chat-id user@example.com --api-key SG.xxx --from-email noreply@example.com`

---

## Dependencies

- Channel Adapter Framework — Done (PR #36)
- Dispatch Worker — Done
- Webhook Infrastructure — Done
- Event Infrastructure (BE-006) — Done

---

## Notes

### Attachment Handling

For `send()`, the adapter needs to fetch the file from `media_url` before sending to SendGrid (SendGrid doesn't accept URLs directly for attachments — it requires base64-encoded content). This adds latency. Future optimization: pre-fetch and cache attachments in the dispatch worker before calling `adapter.send()`.

### SendGrid Message ID Format

SendGrid's `x-message-id` header (from send response) returns a base ID like `"abc123"`. The `sg_message_id` in webhooks includes a filter suffix like `"abc123.filterdrecv-p3iad1-5765874-64109-5784.1"`. The adapter **must normalize** by stripping everything after the first `.` when building `StatusUpdate.provider_message_id`, so the `status_update_worker` can match it to the stored `provider_message_id` in the Message record.

### Batched Event Webhooks

Unlike Telegram (which sends one update per request), SendGrid batches events. The webhook handler must iterate the array. Each event may reference a different `sg_message_id`, so each produces a separate `StatusUpdate` published to RabbitMQ individually.

### Inbound Parse Content Type

SendGrid Inbound Parse sends `multipart/form-data`, not JSON. The email webhook handler must parse form data before passing to `parse_inbound()`. The current `verify_and_parse()` common function assumes JSON — the email handler should bypass it for inbound and handle form parsing directly.

### Future Enhancements (Out of Scope)

- **Multiple provider support:** Add `@register_adapter("email", provider="ses")` for Amazon SES
- **Attachment storage:** Store inbound attachments in S3 and reference URLs in metadata
- **Template support:** Use SendGrid dynamic templates instead of raw content
- **Scheduled sending:** Use SendGrid's `send_at` parameter for provider-side scheduling
- **Suppression management:** Sync SendGrid suppression lists (bounces, unsubscribes) to channel metadata
