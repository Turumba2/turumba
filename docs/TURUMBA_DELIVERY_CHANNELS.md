# Turumba Delivery Channels

This document describes the Delivery Channels feature of the Turumba platform in detail. For a high-level overview of the entire platform, see [What is Turumba?](./WHAT_IS_TURUMBA.md). For messaging features that use delivery channels, see [Turumba Messaging](./TURUMBA_MESSAGING.md).

---

## Overview

A **Delivery Channel** is a configured connection between a Turumba account and an external messaging platform. Before users can send any messages, they must add at least one delivery channel to their account. Channels are the "how" of messaging — they determine which platform a message is sent through.

The Delivery Channels feature is powered by the **turumba_messaging_api** and is accessed through the **Turumba Gateway**.

This document covers:

1. [What is a Channel?](#1-what-is-a-channel) — Core concept and multi-channel support
2. [Supported Channel Types](#2-supported-channel-types) — SMS, SMPP, Telegram, WhatsApp, Messenger, Email
3. [Channel Configuration](#3-channel-configuration) — Credentials, settings, and security
4. [Channel Lifecycle](#4-channel-lifecycle) — Add, configure, verify, enable/disable, remove
5. [Channel Status](#5-channel-status) — Real-time connection health monitoring
6. [Channel Data Model](#6-channel-data-model) — Database schema and JSONB credentials
7. [API Reference](#7-api-reference) — Endpoints, filtering, and sorting
8. [Frontend Views](#8-frontend-views) — Table view and create channel page

---

## 1. What is a Channel?

Each channel represents a specific, authenticated link to a messaging provider. For example:

- A Telegram Bot connected via its bot token
- An SMS provider connected via API credentials
- An SMPP connection to a telecom's SMS Center
- A WhatsApp Business number connected via the WhatsApp Business API
- A Facebook Page connected to send and receive Messenger messages
- An email account connected via SMTP/IMAP credentials

Users can add **multiple channels of the same type**. For instance, an organization might have two SMS channels — one for transactional messages (OTPs, confirmations) and another for marketing messages — each connected to a different provider with different sender names.

### How Channels Are Used

- When composing a new message, the user selects which delivery channel to send through
- Group messages and campaigns can target a specific channel or let the system choose based on the contact's preferred channel
- Each message in the history shows which channel it was sent or received through
- Inbound messages arrive through connected channels and are associated with the originating channel
- Channels have configurable rate limits, retry policies, and delivery priorities

---

## 2. Supported Channel Types

### SMS (API-based)

Connect to an SMS gateway provider using their REST API. Supports outbound SMS delivery with delivery receipt tracking. Common providers: Twilio, Africa's Talking, Vonage, MessageBird.

- **Outbound:** Send SMS to phone numbers worldwide
- **Inbound:** Receive SMS replies via webhook
- **Delivery receipts:** Track sent, delivered, failed statuses
- **Sender ID:** Configurable alphanumeric sender name or phone number
- **Segmentation:** Long messages automatically split into segments (160 chars per segment for GSM-7)

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `provider` | Provider | Select (Twilio, Africa's Talking, Vonage, MessageBird, Other) | Yes |
| `api_key` | API Key | Password input (masked) | Yes |
| `api_secret` | API Secret | Password input (masked) | Yes |
| `sender_number` | Sender Number | Text input (phone format) | No |
| `sender_id` | Sender ID | Text input (alphanumeric) | No |

### SMPP (Protocol-based)

Connect directly to an SMS Center (SMSC) using the Short Message Peer-to-Peer protocol. Used by organizations with direct telecom agreements or high-volume SMS needs.

- **Bind types:** Transmitter, Receiver, or Transceiver
- **Long messages:** Concatenated SMS via UDH (User Data Header)
- **Delivery receipts:** PDU-level delivery receipt tracking
- **Source address:** Configurable TON (Type of Number) and NPI (Numbering Plan Indicator)
- **Keep-alive:** Enquire link for connection keep-alive

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `host` | SMPP Host | Text input | Yes |
| `port` | SMPP Port | Number input (default: 2775) | Yes |
| `system_id` | System ID | Text input | Yes |
| `password` | Password | Password input (masked) | Yes |
| `system_type` | System Type | Text input | No |
| `source_addr` | Source Address | Text input | No |
| `source_addr_ton` | Source Address TON | Number input | No |
| `source_addr_npi` | Source Address NPI | Number input | No |

### Telegram

Connect a Telegram Bot to send and receive messages through Telegram. The bot is created via BotFather and linked to Turumba using the bot token.

- **Outbound:** Send text, media, and formatted messages
- **Inbound:** Receive messages from users who start a conversation with the bot
- **Rich messages:** Markdown/HTML formatting, inline keyboards, reply markup
- **Webhook-based:** Telegram pushes updates to a configured webhook URL
- **Media support:** Photos, videos, documents, audio, stickers, location

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `bot_token` | Bot Token | Password input (masked) | Yes |
| `webhook_url` | Webhook URL | URL input | No |

### WhatsApp

Connect a WhatsApp Business account to send messages via the official WhatsApp Business API (Cloud API or On-Premise).

- **Outbound:** Send text, media, and template messages
- **Inbound:** Receive messages from customers via webhook
- **Template messages:** Pre-approved message templates required for initiating conversations (WhatsApp policy)
- **24-hour window:** Free-form messages allowed within 24 hours of last customer message; template messages required otherwise
- **Media support:** Images, documents, audio, video, location
- **Approval tracking:** Turumba tracks template approval status (pending, approved, rejected)

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `access_token` | Access Token | Password input (masked) | Yes |
| `phone_number_id` | Phone Number ID | Text input | Yes |
| `business_account_id` | Business Account ID | Text input | Yes |

### Facebook Messenger

Connect a Facebook Page to send and receive messages through the Messenger platform.

- **Outbound:** Send text and rich messages to users who have messaged the Page
- **Inbound:** Receive messages via webhook
- **24-hour window:** Standard messaging window applies (Messenger policy)
- **Rich messages:** Quick replies, buttons, carousels, media attachments
- **Page-based:** One Messenger channel per Facebook Page

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `page_access_token` | Page Access Token | Password input (masked) | Yes |
| `page_id` | Page ID | Text input | Yes |
| `app_secret` | App Secret | Password input (masked) | Yes |

### Email

Connect an email account for both outbound and inbound email messaging.

- **Outbound (SMTP):** Send emails with subject, body (plain text and HTML), and attachments
- **Inbound (IMAP):** Poll for incoming emails and create inbound message records
- **Threading:** Group related emails into conversations by subject/references
- **Sender configuration:** From name, reply-to address, email signature
- **Dual protocol:** SMTP for sending, IMAP for receiving — each independently configurable

| Group | Field | Label | Type | Required |
|-------|-------|-------|------|----------|
| Outbound (SMTP) | `smtp_host` | SMTP Host | Text input | Yes |
| Outbound (SMTP) | `smtp_port` | SMTP Port | Number input (default: 587) | Yes |
| Outbound (SMTP) | `smtp_username` | SMTP Username | Text input | Yes |
| Outbound (SMTP) | `smtp_password` | SMTP Password | Password input (masked) | Yes |
| Inbound (IMAP) | `imap_host` | IMAP Host | Text input | No |
| Inbound (IMAP) | `imap_port` | IMAP Port | Number input (default: 993) | No |
| Inbound (IMAP) | `imap_username` | IMAP Username | Text input | No |
| Inbound (IMAP) | `imap_password` | IMAP Password | Password input (masked) | No |
| Sender | `from_name` | From Name | Text input | No |
| Sender | `reply_to` | Reply-To Address | Email input | No |

### Future Channel Types

The architecture supports adding new channel types over time. Potential additions include:

- **Viber** — Popular in Eastern Europe and Southeast Asia
- **Line** — Dominant in Japan, Thailand, and Taiwan
- **Signal** — Privacy-focused messaging
- **RCS (Rich Communication Services)** — Next-generation SMS
- **In-App Push Notifications** — Mobile app push via Firebase/APNs

---

## 3. Channel Configuration

Beyond credentials, each channel has common configuration options that control its behavior:

| Setting | Description | Default |
|---------|-------------|---------|
| **Sender Name** | Display name for outbound messages (e.g., "Turumba Academy") | — |
| **Default Country Code** | Default country code for phone-based channels (e.g., "+251") | — |
| **Rate Limit** | Maximum messages per minute. Prevents provider throttling | — (unlimited) |
| **Priority** | Selection priority when multiple channels of the same type exist. Higher = preferred | 0 |
| **Retry Count** | Number of retry attempts on delivery failure | 3 |
| **Retry Interval** | Seconds between retry attempts | 60 |

### Credential Security

Credentials are **write-only**. They are accepted on create and update, but **never returned in full** in API responses. Responses either exclude or mask credentials:

```json
{
  "channel_type": "sms",
  "credentials": {
    "provider": "twilio",
    "api_key": "sk-****1234",
    "api_secret": "••••••••",
    "sender_number": "+1234567890"
  }
}
```

This ensures that even if an API response is intercepted or logged, the actual secrets remain protected.

---

## 4. Channel Lifecycle

```
Add Channel → Configure → Verify Connection → Active
                                                 │
                                          ┌──────┴──────┐
                                          │             │
                                       Enabled      Disabled
                                          │             │
                                          └──────┬──────┘
                                                 │
                                              Remove
```

| Stage | Description |
|-------|-------------|
| **Add Channel** | User selects a channel type and provides the required credentials |
| **Configure** | User sets additional options: sender name, country code, rate limits, priority, retry policy |
| **Verify Connection** | System tests the connection (API credentials, SMPP bind, bot token validation). Channel marked as "connected" or "error" |
| **Enable / Disable** | Temporarily disable a channel without removing its configuration. Disabled channels cannot send or receive messages |
| **Remove** | Permanently delete the channel and its configuration. Previously sent messages retain their history |

---

## 5. Channel Status

Each channel has a real-time connection status:

| Status | Color | Meaning |
|--------|-------|---------|
| **Connected** | Green | Credentials valid, ready to send and receive |
| **Disconnected** | Gray | Connection lost or credentials expired — needs attention |
| **Rate-Limited** | Yellow | Temporarily throttled by the provider — messages queued until limit resets |
| **Error** | Red | Configuration issue or provider-side failure — needs user action |
| **Disabled** | Muted | Manually disabled by the user |

Status is tracked in real-time and updated based on:
- Credential verification results
- Delivery attempt outcomes (repeated failures may trigger "error" status)
- Provider rate limit headers (HTTP 429 responses trigger "rate_limited")
- Manual enable/disable actions by the user

---

## 6. Channel Data Model

**Database:** PostgreSQL — channels are relational (FK to accounts, referenced by messages) and need consistent state management. Provider credentials are stored in JSONB since each channel type requires different fields.

```
channels (PostgreSQL)
├── id (UUID, PK)
├── account_id (UUID, indexed)            — tenant isolation
├── name (string)                         — user-defined channel name
├── channel_type (string, indexed)        — "sms", "smpp", "telegram", "whatsapp", "messenger", "email"
├── status (string, indexed)              — "connected", "disconnected", "rate_limited", "error", "disabled"
├── is_enabled (boolean)                  — whether the channel is active
├── credentials (JSONB)                   — channel-type-specific auth credentials (write-only)
├── sender_name (string, nullable)        — display name for outbound messages
├── default_country_code (string, nullable) — default country code for phone-based channels
├── rate_limit (integer, nullable)        — max messages per minute
├── priority (integer)                    — selection priority when multiple channels exist
├── retry_count (integer)                 — number of retry attempts on failure (default: 3)
├── retry_interval (integer)              — seconds between retries (default: 60)
├── last_verified_at (timestamp, nullable) — when connection was last verified
├── error_message (text, nullable)        — last error description
├── created_at (timestamp)
└── updated_at (timestamp)
```

### Credentials JSONB per Channel Type

Each channel type stores different credential fields in the `credentials` JSONB column:

| Type | Fields |
|------|--------|
| `sms` | `provider`, `api_key`, `api_secret`, `sender_number`, `sender_id` |
| `smpp` | `host`, `port`, `system_id`, `password`, `system_type`, `source_addr`, `source_addr_ton`, `source_addr_npi` |
| `telegram` | `bot_token`, `webhook_url` |
| `whatsapp` | `access_token`, `phone_number_id`, `business_account_id` |
| `messenger` | `page_access_token`, `page_id`, `app_secret` |
| `email` | `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `imap_host`, `imap_port`, `imap_username`, `imap_password`, `from_name`, `reply_to` |

---

## 7. API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/channels/` | Add a new delivery channel |
| `GET` | `/v1/channels/` | List channels (filtered, sorted, paginated) |
| `GET` | `/v1/channels/{id}` | Get a single channel by ID |
| `PATCH` | `/v1/channels/{id}` | Update channel configuration |
| `DELETE` | `/v1/channels/{id}` | Remove a channel |

All endpoints require authentication. List endpoint is scoped to the user's accounts via the gateway's `x-account-ids` header.

### Filtering and Sorting

Channels support the platform's standard filter syntax: `?filter=field:op:value&sort=field:order`

| Field | Allowed Filter Operations | Sortable |
|-------|--------------------------|----------|
| `id` | `eq` | No |
| `account_id` | `eq`, `in` | No |
| `name` | `eq`, `contains`, `icontains` | Yes |
| `channel_type` | `eq`, `in` | Yes |
| `status` | `eq`, `in` | Yes |
| `is_enabled` | `eq` | No |
| `priority` | `eq`, `ge`, `le` | Yes |
| `created_at` | `ge`, `le`, `range` | Yes |
| `updated_at` | `ge`, `le`, `range` | Yes |

### Example Queries

```bash
# All SMS channels
GET /v1/channels/?filter=channel_type:eq:sms&sort=priority:desc

# Connected and enabled channels
GET /v1/channels/?filter=status:eq:connected&filter=is_enabled:eq:true

# Search channels by name
GET /v1/channels/?filter=name:icontains:marketing&sort=created_at:desc

# High-priority channels (priority >= 5)
GET /v1/channels/?filter=priority:ge:5&sort=priority:desc

# All Telegram channels, newest first
GET /v1/channels/?filter=channel_type:eq:telegram&sort=created_at:desc

# Channels with errors that need attention
GET /v1/channels/?filter=status:in:error,disconnected&sort=updated_at:desc
```

---

## 8. Frontend Views

### Channels Table View

The Delivery Channels page presents all channels in a data table with advanced filtering, sorting, and pagination using the `DataTable` and `TableFilter` components from `@repo/ui`. Filter and sort state is persisted in the URL via `nuqs` for shareable and bookmarkable views.

**Route:** `/channels`

**Table Columns:**

| Column | Field | Sortable | Display |
|--------|-------|----------|---------|
| Name | `name` | Yes | Plain text |
| Type | `channel_type` | Yes | Badge with channel icon (SMS, SMPP, Telegram, WhatsApp, Messenger, Email) |
| Status | `status` | Yes | Color-coded badge (Connected=green, Disconnected=gray, Rate-Limited=yellow, Error=red, Disabled=muted) |
| Sender | `sender_name` | No | Plain text or "—" if not set |
| Priority | `priority` | Yes | Numeric |
| Enabled | `is_enabled` | No | Toggle or indicator dot |
| Created | `created_at` | Yes | Relative time (e.g., "3 days ago") |
| Actions | — | No | Dropdown: View, Edit, Delete |

**Available Filters:** Name (text search), Channel Type (multi-select), Status (multi-select), Enabled (boolean), Priority (number range), Created At (date range)

**Page Actions:**
- **Add Channel** button — navigates to the channel creation form at `/channels/new`
- **Row actions** — View details, Edit configuration, Delete (with confirmation dialog)

### Create Channel Page

The Add New Delivery Channel page guides users through channel type selection, credentials, and configuration.

**Route:** `/channels/new`

**Form sections:**
1. **Channel Name** — Required text input
2. **Channel Type Selector** — Visual card grid with icon + label for each type (SMS, SMPP, Telegram, WhatsApp, Messenger, Email)
3. **Credentials** — Dynamic fields based on selected channel type (see credential tables per type above). Password fields are masked with show/hide toggle
4. **Configuration** — Optional settings: sender name, country code, rate limit, priority, retry count, retry interval
5. **Form Actions** — Cancel (back to `/channels`) and Add Channel (submit)

The form uses React Hook Form with dynamic Zod validation schemas that switch based on the selected channel type.

---

## Related Documentation

- **Backend Task:** [BE-002 — Delivery Channels CRUD](./tasks/delivery-channels/BE-002-delivery-channels-crud.md)
- **Frontend Tasks:**
  - [FE-002 — Delivery Channels Table View](./tasks/delivery-channels/FE-002-delivery-channels-table.md)
  - [FE-003 — Create New Delivery Channel](./tasks/delivery-channels/FE-003-create-delivery-channel.md)
- **Messaging Features:** [Turumba Messaging](./TURUMBA_MESSAGING.md) — channels are used by Messages, Group Messages, and Scheduled Messages
