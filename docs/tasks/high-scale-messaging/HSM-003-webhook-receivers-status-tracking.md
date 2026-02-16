# HSM-003: Webhook Receivers & Status Tracking

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P1
**Feature Area:** High-Scale Messaging — Webhook & Status Pipeline
**Architecture Reference:** [High-Scale Messaging Architecture](../../HIGH_SCALE_MESSAGING_ARCHITECTURE.md)

---

## Summary

Build the inbound pipeline: webhook receiver endpoints for all channel types, the status update worker that processes delivery confirmations, and the inbound message worker that processes received messages. This closes the loop — messages flow out through adapters and confirmations/replies flow back in through webhooks.

**Scope:**
- Webhook receiver routes for Telegram, WhatsApp, SMS (Twilio), Messenger, Email
- Signature verification per provider
- Status update worker (delivery receipts → message status updates)
- Inbound message worker (received messages → Message records)
- Webhook registration on channel creation

---

## Part 1: Webhook Receiver Endpoints

### Directory Structure

```
src/routers/webhooks/
├── __init__.py
├── telegram.py         # POST /webhooks/telegram/{channel_id}
├── whatsapp.py         # POST /webhooks/whatsapp/{channel_id}
├── sms.py              # POST /webhooks/sms/{channel_id}
├── messenger.py        # POST /webhooks/messenger/{channel_id}
└── email.py            # POST /webhooks/email/{channel_id}
```

### Webhook Processing Pattern

Every webhook endpoint follows the same pattern:

```python
@router.post("/webhooks/{channel_type}/{channel_id}")
async def receive_webhook(
    channel_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    # 1. Load channel record (get credentials + webhook secret)
    channel = await load_channel(channel_id, db)
    if not channel:
        raise HTTPException(404)

    # 2. Read raw body
    body = await request.body()

    # 3. Verify webhook signature
    adapter = get_adapter(channel.channel_type)
    secret = channel.credentials.get("webhook_secret") or channel.credentials.get("bot_token")
    if not adapter.verify_webhook_signature(dict(request.headers), body, secret):
        raise HTTPException(401, "Invalid webhook signature")

    # 4. Parse payload
    payload = json.loads(body)

    # 5. Check for inbound message
    inbound = adapter.parse_inbound(payload)
    if inbound:
        await publish_to_rabbitmq(
            routing_key=f"webhook.inbound.{channel.channel_type}",
            payload={
                "channel_id": str(channel.id),
                "account_id": str(channel.account_id),
                "provider_message_id": inbound.provider_message_id,
                "sender_address": inbound.sender_address,
                "message_body": inbound.message_body,
                "timestamp": inbound.timestamp.isoformat(),
                "metadata": inbound.metadata,
                "media_url": inbound.media_url,
                "media_type": inbound.media_type,
            },
        )

    # 6. Check for status update
    status = adapter.parse_status_update(payload)
    if status:
        await publish_to_rabbitmq(
            routing_key=f"message.status.{status.status}",
            payload={
                "channel_id": str(channel.id),
                "account_id": str(channel.account_id),
                "provider_message_id": status.provider_message_id,
                "status": status.status,
                "timestamp": status.timestamp.isoformat(),
                "error_code": status.error_code,
                "error_message": status.error_message,
                "metadata": status.metadata,
            },
        )

    # 7. Return 200 immediately (providers expect fast response)
    return {"ok": True}
```

### Provider-Specific Webhook Details

#### Telegram
- **URL:** `POST /webhooks/telegram/{channel_id}`
- **Signature:** `X-Telegram-Bot-Api-Secret-Token` header (set during `setWebhook`)
- **Payload:** Telegram Update object with `message`, `callback_query`, etc.
- **Inbound:** `update.message` contains text/media from user
- **Status:** None (Telegram has no delivery receipts for bots)

#### WhatsApp (Cloud API)
- **URL:** `POST /webhooks/whatsapp/{channel_id}`
- **Signature:** `X-Hub-Signature-256` header (HMAC-SHA256 of body with app secret)
- **Verification:** GET request with `hub.verify_token` challenge on setup
- **Payload:** Webhook notification with `messages[]` and `statuses[]`
- **Inbound:** `entry[].changes[].value.messages[]`
- **Status:** `entry[].changes[].value.statuses[]` — sent, delivered, read, failed

#### SMS (Twilio)
- **URL:** `POST /webhooks/sms/{channel_id}`
- **Signature:** `X-Twilio-Signature` header (HMAC-SHA1 of URL + sorted params)
- **Payload:** Form-encoded with `From`, `Body`, `MessageSid`, `MessageStatus`
- **Inbound:** When `MessageStatus` absent — incoming SMS
- **Status:** When `MessageStatus` present — delivery callback (queued, sent, delivered, failed)

#### Messenger
- **URL:** `POST /webhooks/messenger/{channel_id}`
- **Signature:** `X-Hub-Signature-256` (HMAC-SHA256 with app secret)
- **Verification:** GET request with `hub.verify_token` challenge
- **Payload:** `entry[].messaging[]` with `message` or `delivery` events
- **Inbound:** `messaging[].message` contains text
- **Status:** `messaging[].delivery` contains delivery confirmation

#### Email
- **URL:** `POST /webhooks/email/{channel_id}`
- **Payload:** Varies by provider (SES SNS notification, SendGrid Event Webhook, etc.)
- **Inbound:** Handled separately via IMAP polling (not webhook)
- **Status:** Bounce notifications, complaint notifications

---

## Part 2: Status Update Worker

### File: `src/workers/status_update_worker.py`

Consumes from `message.status.update` queue and updates Message records.

```
1. Consume status event from message.status.update queue
2. Look up Message by provider_message_id + channel_id
   (provider_message_id stored in message.metadata when sent)
3. Update Message:
   ├── "delivered" → status="delivered", delivered_at=timestamp
   ├── "failed"    → status="failed", failed_at=timestamp, error_details
   └── "read"      → metadata.read_at=timestamp (informational)
4. If message has group_message_id:
   └── Update GroupMessage counters (delivered_count++ or failed_count++)
5. ACK
```

### Provider Message ID Lookup

When a message is sent (in the dispatch worker), the `provider_message_id` is stored in `message.metadata_`:

```json
{
    "provider_message_id": "telegram:12345",
    "chat_id": "67890"
}
```

The status update worker looks up messages by:
```sql
SELECT * FROM messages
WHERE metadata_->>'provider_message_id' = :provider_msg_id
  AND channel_id = :channel_id
```

**Index needed:**
```sql
CREATE INDEX idx_messages_provider_msg_id
ON messages ((metadata_->>'provider_message_id'), channel_id);
```

---

## Part 3: Inbound Message Worker

### File: `src/workers/inbound_message_worker.py`

Consumes from `webhook.inbound` queue and creates inbound Message records.

```
1. Consume inbound event from webhook.inbound queue
2. Create Message record:
   - direction: "inbound"
   - status: "delivered" (it arrived)
   - channel_id: from event
   - account_id: from event
   - delivery_address: sender_address (the sender's phone/chat_id)
   - message_body: from event
   - metadata: provider-specific data
   - delivered_at: event timestamp
3. Resolve contact (optional):
   - Look up contact by sender_address in Account API
   - If found, set contact_id on the Message
4. ACK
```

---

## Part 4: Webhook Registration

When a channel is created or updated, register the webhook URL with the provider.

Add to channel creation/update flow in the Messaging API:

```python
async def register_webhook(channel: Channel, base_webhook_url: str) -> None:
    """Register the webhook URL with the provider after channel creation."""
    adapter = get_adapter(channel.channel_type)
    webhook_url = f"{base_webhook_url}/webhooks/{channel.channel_type}/{channel.id}"

    if channel.channel_type == "telegram":
        # POST /setWebhook with URL + secret_token
        token = channel.credentials["bot_token"]
        secret = generate_webhook_secret()
        async with httpx.AsyncClient() as client:
            await client.post(
                f"https://api.telegram.org/bot{token}/setWebhook",
                json={"url": webhook_url, "secret_token": secret},
            )
        # Store secret in channel credentials
        channel.credentials["webhook_secret"] = secret

    elif channel.channel_type == "whatsapp":
        # WhatsApp webhook is configured in Meta Business Manager
        # Store the expected URL for documentation
        pass

    # ... similar for other channel types
```

### Configuration

```python
# src/config/config.py
WEBHOOK_BASE_URL: str = "https://turumba.example.com"  # Public-facing URL for webhooks
```

---

## Tasks

### Part 1: Webhook Endpoints
- [ ] Create `src/routers/webhooks/__init__.py`
- [ ] Create Telegram webhook endpoint (`POST /webhooks/telegram/{channel_id}`)
- [ ] Create WhatsApp webhook endpoint (`POST /webhooks/whatsapp/{channel_id}`)
- [ ] Create WhatsApp verification endpoint (`GET /webhooks/whatsapp/{channel_id}` — hub.verify_token challenge)
- [ ] Create SMS/Twilio webhook endpoint (`POST /webhooks/sms/{channel_id}`)
- [ ] Create Messenger webhook endpoint (`POST /webhooks/messenger/{channel_id}`)
- [ ] Create Messenger verification endpoint (`GET /webhooks/messenger/{channel_id}`)
- [ ] Create Email webhook endpoint (`POST /webhooks/email/{channel_id}`)
- [ ] All endpoints: load channel, verify signature, parse, enqueue, return 200
- [ ] Register webhook router in `src/main.py` (no auth middleware — webhooks come from providers)

### Part 2: RabbitMQ Publishing from Webhooks
- [ ] Implement `publish_to_rabbitmq()` utility for webhook handlers
- [ ] Inbound messages → `webhook.inbound.{channel_type}`
- [ ] Status updates → `message.status.{status}`
- [ ] Use persistent delivery mode

### Part 3: Status Update Worker
- [ ] Create `src/workers/status_update_worker.py`
- [ ] Consume from `message.status.update` queue
- [ ] Look up Message by `provider_message_id` + `channel_id`
- [ ] Update message status (delivered, failed, read)
- [ ] Update GroupMessage counters if applicable
- [ ] Add JSONB index on `metadata_->>'provider_message_id'`
- [ ] Create Alembic migration for the index
- [ ] Graceful shutdown

### Part 4: Inbound Message Worker
- [ ] Create `src/workers/inbound_message_worker.py`
- [ ] Consume from `webhook.inbound` queue
- [ ] Create Message record (direction="inbound", status="delivered")
- [ ] Optionally resolve contact by sender_address
- [ ] Graceful shutdown

### Part 5: Webhook Registration
- [ ] Implement `register_webhook()` for Telegram (call `/setWebhook`)
- [ ] Generate and store webhook_secret per channel
- [ ] Add `WEBHOOK_BASE_URL` to config
- [ ] Hook into channel create/update flow

### Part 6: Tests
- [ ] Telegram webhook: valid signature → accepted, invalid → 401
- [ ] Telegram webhook: inbound message parsed and enqueued
- [ ] WhatsApp webhook: signature verification (HMAC-SHA256)
- [ ] WhatsApp webhook: status update parsed (delivered, failed, read)
- [ ] Twilio webhook: signature verification
- [ ] Twilio webhook: inbound SMS parsed
- [ ] Twilio webhook: status callback parsed
- [ ] Status update worker: delivered status → message.delivered_at set
- [ ] Status update worker: failed status → message.failed_at + error_details
- [ ] Status update worker: group message counters updated
- [ ] Inbound worker: creates Message with direction="inbound"
- [ ] Webhook returns 200 within timeout
- [ ] Unknown channel_id → 404

---

## Acceptance Criteria

- [ ] Webhook endpoints for all 5 channel types
- [ ] Signature verification per provider
- [ ] Inbound messages and status updates enqueued to correct RabbitMQ queues
- [ ] Status update worker processes delivery receipts and updates message status
- [ ] Inbound message worker creates inbound Message records
- [ ] GroupMessage counters updated on delivery confirmations
- [ ] Webhook registration for Telegram on channel creation
- [ ] Provider_message_id indexed for efficient lookup
- [ ] All endpoints return 200 quickly (no blocking processing)
- [ ] Tests passing, Ruff clean

---

## Dependencies

- HSM-001 (Channel Adapter Framework — adapter parse methods and signature verification)
- HSM-002 (Dispatch Pipeline — dispatch queues and status queue exist)
- BE-001 (Messages CRUD — Message model)
- BE-002 (Channels CRUD — Channel model)

## Blocks

- None (this closes the message lifecycle loop)
