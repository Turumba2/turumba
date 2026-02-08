# FE-003: Create New Delivery Channel Page

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#9](https://github.com/Turumba2/turumba_web_core/issues/9)
**Feature Area:** Delivery Channels
**Figma:** (link to Figma design)

---

## Summary

Build the "Add New Delivery Channel" page where users configure and connect a new delivery channel to their account. The form dynamically adapts based on the selected channel type — each type requires different credential fields. The page uses a multi-step or sectioned layout to guide users through channel type selection, credentials, and configuration.

**UI design should follow the Figma mockup exactly for layout, spacing, colors, and component styles.**

Backend API Reference: [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md)
Feature Reference: [Turumba Messaging — Delivery Channels](../TURUMBA_MESSAGING.md#1-delivery-channels)

---

## Page Structure

```
┌─────────────────────────────────────────────────────┐
│  ← Back to Channels          Add New Delivery Channel │
├─────────────────────────────────────────────────────┤
│                                                       │
│  Channel Name                                         │
│  ┌─────────────────────────────────────────────────┐ │
│  │  e.g., "Marketing SMS", "Support Bot"           │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  Channel Type                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌───┐ │
│  │ SMS  │ │ SMPP │ │ TG   │ │ WA   │ │ MSG  │ │ ✉ │ │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └───┘ │
│                                                       │
│  ── Credentials ──────────────────────────────────── │
│  (dynamic fields based on selected channel type)      │
│                                                       │
│  ── Configuration (optional) ─────────────────────── │
│  Sender Name, Country Code, Rate Limit, Priority,     │
│  Retry Count, Retry Interval                          │
│                                                       │
│                            [Cancel]  [Add Channel]    │
└─────────────────────────────────────────────────────┘
```

---

## Requirements

### 1. Entry Point & Navigation

- Navigated to from the "Add Channel" button on the Channels Table View (FE-002)
- Route: `apps/turumba/app/(dashboard)/channels/new/page.tsx`
- "Back to Channels" link in the page header navigates back to `/channels`

### 2. Channel Name

- Required text input
- Placeholder: e.g., "Marketing SMS", "Support Bot", "Transactional Email"
- Max length: 255 characters
- Validation: required, non-empty

### 3. Channel Type Selector

- Visual selector (card grid, segmented control, or radio cards per Figma design)
- Each type shows an icon and label:

| Type | Label | Icon |
|------|-------|------|
| `sms` | SMS | MessageSquare or Phone |
| `smpp` | SMPP | Radio or Server |
| `telegram` | Telegram | Send or Telegram icon |
| `whatsapp` | WhatsApp | MessageCircle or WhatsApp icon |
| `messenger` | Messenger | Facebook or MessagesSquare |
| `email` | Email | Mail |

- Required — user must select a type before proceeding
- Selecting a type dynamically renders the corresponding credential fields below
- Changing the type clears the credential fields and resets validation

### 4. Credentials Section (Dynamic)

The credential fields change based on the selected `channel_type`. All credential fields should be in a visually grouped section with a "Credentials" heading.

**SMS:**

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `provider` | Provider | Select (Twilio, Africa's Talking, Vonage, MessageBird, Other) | Yes |
| `api_key` | API Key | Password input (masked, with show/hide toggle) | Yes |
| `api_secret` | API Secret | Password input (masked, with show/hide toggle) | Yes |
| `sender_number` | Sender Number | Text input (phone format) | No |
| `sender_id` | Sender ID | Text input (alphanumeric) | No |

**SMPP:**

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

**Telegram:**

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `bot_token` | Bot Token | Password input (masked, with show/hide toggle) | Yes |
| `webhook_url` | Webhook URL | URL input | No |

**WhatsApp:**

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `access_token` | Access Token | Password input (masked) | Yes |
| `phone_number_id` | Phone Number ID | Text input | Yes |
| `business_account_id` | Business Account ID | Text input | Yes |

**Messenger:**

| Field | Label | Type | Required |
|-------|-------|------|----------|
| `page_access_token` | Page Access Token | Password input (masked) | Yes |
| `page_id` | Page ID | Text input | Yes |
| `app_secret` | App Secret | Password input (masked) | Yes |

**Email:**

| Field | Label | Type | Required | Group |
|-------|-------|------|----------|-------|
| `smtp_host` | SMTP Host | Text input | Yes | Outbound (SMTP) |
| `smtp_port` | SMTP Port | Number input (default: 587) | Yes | Outbound (SMTP) |
| `smtp_username` | SMTP Username | Text input | Yes | Outbound (SMTP) |
| `smtp_password` | SMTP Password | Password input (masked) | Yes | Outbound (SMTP) |
| `imap_host` | IMAP Host | Text input | No | Inbound (IMAP) |
| `imap_port` | IMAP Port | Number input (default: 993) | No | Inbound (IMAP) |
| `imap_username` | IMAP Username | Text input | No | Inbound (IMAP) |
| `imap_password` | IMAP Password | Password input (masked) | No | Inbound (IMAP) |
| `from_name` | From Name | Text input | No | Sender |
| `reply_to` | Reply-To Address | Email input | No | Sender |

For Email, group the fields visually into **Outbound (SMTP)**, **Inbound (IMAP)** (optional), and **Sender** sub-sections.

### 5. Configuration Section (Optional)

Common settings that apply to all channel types. Display in a collapsible or separate section labeled "Configuration" or "Advanced Settings".

| Field | Label | Type | Default | Description |
|-------|-------|------|---------|-------------|
| `sender_name` | Sender Name | Text input | — | Display name for outbound messages |
| `default_country_code` | Default Country Code | Text input (e.g., "+251") | — | For phone-based channels |
| `rate_limit` | Rate Limit | Number input | — | Max messages per minute |
| `priority` | Priority | Number input | 0 | Higher = preferred when multiple channels exist |
| `retry_count` | Retry Count | Number input | 3 | Number of retry attempts on failure |
| `retry_interval` | Retry Interval (seconds) | Number input | 60 | Seconds between retries |

### 6. Form Actions

- **Add Channel** button — submits the form to create the channel
  - Disabled until all required fields are filled and valid
  - Show loading spinner while API request is in progress
  - On success: redirect to `/channels` with a success toast notification
  - On error: display the error message inline without navigating away
- **Cancel** button — navigates back to `/channels`
  - If the form has unsaved changes, show a confirmation prompt before navigating

### 7. API Integration

- **Create channel:** `POST /v1/channels/` via the Turumba Gateway
  - Payload: `{ name, channel_type, credentials: { ... }, sender_name, default_country_code, rate_limit, priority, retry_count, retry_interval }`
- Create API function in `apps/turumba/lib/api/channels.ts`:

```tsx
export async function createChannel(data: {
  name: string;
  channel_type: string;
  credentials: Record<string, unknown>;
  sender_name?: string;
  default_country_code?: string;
  rate_limit?: number;
  priority?: number;
  retry_count?: number;
  retry_interval?: number;
}) { ... }
```

### 8. Form Validation (Zod)

- Use React Hook Form + Zod for form state management and validation
- Base schema validates `name` (required) and `channel_type` (required, one of allowed values)
- Credential schema switches dynamically based on `channel_type` using Zod discriminated union or conditional refinement
- Show inline validation errors under each field
- Credential fields with `password` type should have a show/hide toggle

---

## Tasks

### 1. Channel Type Selector Component
- [ ] Create a visual channel type selector (card grid or radio cards per Figma)
- [ ] Each option shows icon + label
- [ ] Selected state visually distinct (border highlight, background change)

### 2. Dynamic Credential Forms
- [ ] Create credential field sets for each channel type (SMS, SMPP, Telegram, WhatsApp, Messenger, Email)
- [ ] Password fields with show/hide toggle
- [ ] Email type: sub-sections for SMTP, IMAP, Sender
- [ ] Fields render/clear dynamically when channel type changes

### 3. Configuration Section
- [ ] Optional fields section (sender_name, country code, rate limit, priority, retry settings)
- [ ] Collapsible or clearly separated from credentials

### 4. Zod Validation Schemas
- [ ] Base schema: name (required), channel_type (required, enum)
- [ ] Per-type credential schemas with required/optional fields
- [ ] Dynamic schema switching based on selected channel_type

### 5. Create Channel Page
- [ ] Create `apps/turumba/app/(dashboard)/channels/new/page.tsx`
- [ ] Wire up React Hook Form with dynamic Zod schema
- [ ] Channel type selector at top
- [ ] Dynamic credential fields below
- [ ] Configuration section
- [ ] Cancel and Add Channel buttons with proper behavior
- [ ] Page header with "Add New Delivery Channel" title and back link

### 6. API Integration
- [ ] Add `createChannel` to `apps/turumba/lib/api/channels.ts`
- [ ] Handle loading, success (redirect + toast), and error states
- [ ] Unsaved changes prompt on cancel/navigation

---

## UI/UX Notes

- **Follow the Figma design exactly** for layout, spacing, colors, and component styles
- Use existing `@repo/ui` components: Button, Input, Select, Label, Card, Separator, Field/FieldGroup/FieldError
- Use `lucide-react` for channel type icons and password toggle (Eye/EyeOff)
- Use `sonner` for toast notifications
- Use `<Dialog>` for unsaved changes confirmation
- Credential fields should feel secure — password inputs masked by default with explicit toggle
- The form should work well on both desktop and mobile layouts
- Consider showing a brief helper text or link per channel type (e.g., "Get your bot token from BotFather" for Telegram)

---

## Acceptance Criteria

- [ ] User can navigate to the create channel page from the channels table
- [ ] User can enter a channel name
- [ ] User can select a channel type from the visual selector
- [ ] Credential fields change dynamically based on selected channel type
- [ ] All required fields are validated with inline error messages
- [ ] Password/secret fields are masked with show/hide toggle
- [ ] Email channel shows grouped sub-sections (SMTP, IMAP, Sender)
- [ ] Configuration section displays optional settings
- [ ] Add Channel button is disabled until form is valid
- [ ] Successful creation redirects to `/channels` with success toast
- [ ] Failed creation shows error inline without navigating
- [ ] Cancel with unsaved changes shows confirmation prompt
- [ ] Form works on both desktop and mobile
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Backend:** [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md) (POST endpoint must be available)
- **FE-002:** [Delivery Channels Table View](./FE-002-delivery-channels-table.md) (for navigation and `channels.ts` API file)
- Existing `@repo/ui` components: Button, Input, Select, Card, Label, Field, Dialog, Separator
