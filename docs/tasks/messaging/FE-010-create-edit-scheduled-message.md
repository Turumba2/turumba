# FE-010: Create / Edit Scheduled Message Page

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#16](https://github.com/Turumba2/turumba_web_core/issues/16)
**Feature Area:** Scheduled Messages
**Figma:** (link to Figma design)

---

## Summary

Build the Create and Edit Scheduled Message page where users compose a message, define the recipient (single contact or contact group), set the delivery schedule (one-time or recurring), and choose a delivery channel. The page features a two-column layout with a step-by-step form on the left and a live summary panel on the right.

The same page serves both **create** and **edit** flows — in edit mode, the form is pre-populated with existing schedule data. Editing is only allowed while the schedule is in `pending` or `paused` status.

**UI design should follow the Figma mockup exactly.**

Backend API Reference: [BE-005 — Scheduled Messages CRUD](./BE-005-scheduled-messages-crud.md)
Feature Reference: [Turumba Messaging — Scheduled Messages](../TURUMBA_MESSAGING.md#5-scheduled-messages)

---

## Page Structure

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Back to Schedules        Create Schedule / Edit Schedule         │
├──────────────────────────────┬─────────────────────────────────────┤
│                              │                                     │
│  Schedule Name               │         Summary                     │
│  ┌────────────────────────┐  │  ┌─────────────────────────────┐   │
│  │  e.g., "Morning Report"│  │  │  Send Type: Group            │   │
│  └────────────────────────┘  │  │  Channel: Marketing SMS      │   │
│                              │  │  Recipients: ~5,000           │   │
│  ── Who to Send To ──────── │  │  Template: Weekly Digest      │   │
│  ○ Single recipient          │  │                               │   │
│    [+251912345678        ]   │  │  Schedule:                    │   │
│  ○ Contact group(s)          │  │  🔁 Weekly: Mon, Wed, Fri    │   │
│    ☑ New Students (2,500)    │  │  Starting: Mar 10, 8:00 AM   │   │
│    ☑ Alumni (2,500)          │  │  Timezone: Africa/Addis_Ababa│   │
│                              │  │  Until: Jun 30, 2026         │   │
│  ── Delivery Channel ────── │  │                               │   │
│  ┌────────────────────────┐  │  │  Preview:                    │   │
│  │  Marketing SMS      ▾  │  │  │  "Hi Sarah, your weekly      │   │
│  └────────────────────────┘  │  │   digest is ready..."        │   │
│                              │  └─────────────────────────────┘   │
│  ── Message ─────────────── │                                     │
│  ○ Use existing template     │  ── Custom Values ───────────────── │
│    ┌────────────────────┐   │  EVENT_DATE │ [March 20, 2026]      │
│    │  Weekly Digest  ▾  │   │                                     │
│    └────────────────────┘   │                                     │
│  ○ Write message directly    │                                     │
│    ┌────────────────────┐   │                                     │
│    │  Hi {FIRST_NAME},...│   │                                     │
│    └────────────────────┘   │                                     │
│                              │                                     │
│  ── Schedule ────────────── │                                     │
│  Scheduled Date & Time       │                                     │
│  [Mar 10, 2026] [08:00 AM]  │                                     │
│  Timezone: Africa/Addis_Ababa│                                     │
│                              │                                     │
│  ☐ Make this recurring       │                                     │
│    Repeat: [Weekly       ▾]  │                                     │
│    Days:   ☑Mon ☐Tue ☑Wed    │                                     │
│            ☐Thu ☑Fri ☐Sat ☐Sun│                                    │
│    End:    ○ Never            │                                     │
│            ○ On [Jun 30, 2026]│                                    │
│                              │                                     │
│  ── Custom Values (opt) ──── │                                     │
│  EVENT_DATE │ [March 20, 2026]│                                    │
│                              │                                     │
│     [Cancel] [Schedule Send]  │                                     │
├──────────────────────────────┴─────────────────────────────────────┤
└────────────────────────────────────────────────────────────────────┘
```

---

## Routes

- **Create:** `apps/turumba/app/(dashboard)/scheduled-messages/new/page.tsx`
- **Edit:** `apps/turumba/app/(dashboard)/scheduled-messages/[id]/edit/page.tsx`

Both routes render the same form component. Edit mode fetches existing schedule data and pre-populates the form.

---

## Requirements

### 1. Schedule Name

- Optional text input
- Placeholder: e.g., "Morning Report", "Weekly Digest", "Welcome OTP"
- Max length: 255 characters

### 2. Send Type — Who to Send To

Radio group selecting between single recipient and contact group:

**Option A: Single Recipient**
- Text input for `delivery_address` (phone number, email, username, etc.)
- Required when single is selected
- Placeholder: e.g., "+251912345678", "user@example.com"
- Optional: contact search/select to link a `contact_id` (auto-fills the delivery address from the contact's data)

**Option B: Contact Group(s)**
- Multi-select component listing available contact groups
- Each group shows name and approximate contact count
- Populated from contact groups API
- At least one group required when group is selected
- Display total estimated recipients count
- Expandable "Exclude contacts" section (same as FE-008)

Switching send type clears the recipient fields of the other option.

### 3. Delivery Channel

- Required select dropdown
- Populated dynamically from user's enabled channels (`GET /v1/channels/?filter=is_enabled:eq:true`)
- Shows channel name + type badge (e.g., "Marketing SMS [SMS]")
- Selecting a channel may filter available templates by `channel_type`

### 4. Message Source (Template or Direct)

Two mutually exclusive options (radio group) — same pattern as FE-008:

**Option A: Use existing template**
- Select dropdown to pick an existing template
- Populated from `GET /v1/templates/?filter=is_active:eq:true`
- Optionally filtered by `channel_type` if a channel is already selected
- When selected, display the template body preview with highlighted `{VARIABLE}` placeholders

**Option B: Write message directly**
- Text area (reuse FE-006 body composer) with `{VARIABLE}` support
- Variable highlighting, Insert Variable dropdown, character count
- Auto-extract variables for the custom values section
- When submitted, the API auto-creates a template from this body

### 5. Schedule Configuration

The core scheduling section:

**Scheduled Date & Time:**
- Required date picker for the send date
- Required time picker for the send time
- Cannot select a date/time in the past (for create mode; edit mode allows if schedule is already set)
- Combined into `scheduled_at` (ISO 8601 with timezone)

**Timezone:**
- Select dropdown or auto-detect from browser
- Common presets: Africa/Addis_Ababa, UTC, America/New_York, Europe/London, Asia/Dubai
- Allow searching/typing timezone names
- Default: user's local timezone (auto-detected)
- Display the selected timezone name and current offset (e.g., "Africa/Addis_Ababa (UTC+3)")

**Recurring Toggle:**
- Checkbox: "Make this recurring"
- When checked, show the recurrence configuration fields below
- When unchecked, hide recurrence fields (one-time send)

**Recurrence Configuration** (shown when recurring is checked):

*Repeat Pattern:*
- Select dropdown: Daily, Weekly, Monthly
- Default: Weekly

*Weekly Options* (shown when repeat = Weekly):
- Day-of-week checkboxes: Mon, Tue, Wed, Thu, Fri, Sat, Sun
- At least one day must be selected
- Visual: inline row of 7 toggleable day buttons/chips

*Monthly Options* (shown when repeat = Monthly):
- Day-of-month input: number input (1–31) or multi-select for multiple days
- E.g., "15" for the 15th, or "1, 15" for 1st and 15th
- Validate: 1–31

*Recurrence End:*
- Radio group: "Never" (default) or "On specific date"
- When "On specific date": date picker for `recurrence_end_at`
- End date must be after the scheduled date
- "Never" means the schedule recurs indefinitely until cancelled or paused

The recurrence configuration generates the `recurrence_rule` string:
- Daily → `"daily"`
- Weekly with Mon, Wed, Fri → `"weekly:mon,wed,fri"`
- Monthly on 15th → `"monthly:15"`
- Monthly on 1st and 15th → `"monthly:1,15"`

### 6. Custom Values (Optional)

- Key-value editor for template variable overrides
- Auto-populated with variables extracted from the selected template or message body
- Values apply to **all** recipients (for group sends) or the single recipient
- Same UI pattern as FE-006 default values editor and FE-008 custom values
- Note for group sends: "Contact-specific variables (like FIRST_NAME) are resolved per-contact at send time"

### 7. Summary Panel (Right Side)

A read-only summary panel that updates in real-time:

| Section | Content |
|---------|---------|
| **Send Type** | "Single" or "Group" with icon |
| **Channel** | Selected channel name + type, or "No channel selected" |
| **Recipient** | Single: delivery address. Group: estimated count, or "No recipient defined" |
| **Template** | Template name or "(Direct message)" or "No message defined" |
| **Schedule** | Formatted date/time with timezone. Recurring: rule in human-readable format (e.g., "🔁 Weekly: Mon, Wed, Fri"), end date or "Indefinite" |
| **Preview** | Rendered message with sample values (reuse FE-006 preview logic) — only shown when a template or message body is defined |
| **Custom Values** | Listed key-value pairs (only shown if any values are set) |

### 8. Form Actions

- **Schedule Send / Save Schedule** button:
  - **Create mode:** Label "Schedule Send". `POST /v1/scheduled-messages/` — on success redirect to `/scheduled-messages` with success toast
  - **Edit mode:** Label "Save Schedule". `PATCH /v1/scheduled-messages/{id}` — on success redirect to `/scheduled-messages` with success toast
  - Payload includes:
    - `name`, `channel_id`, `send_type`, `scheduled_at`, `timezone`
    - `template_id` OR `message_body` (API handles auto-template creation for message_body)
    - Single: `delivery_address`, `contact_id`
    - Group: `contact_group_ids`, `exclude_contact_ids`
    - `is_recurring`, `recurrence_rule`, `recurrence_end_at` (if recurring)
    - `custom_values`
  - Disabled until: channel selected, recipient defined, message source defined, schedule date/time set
  - Show loading spinner while submitting
  - On error: show inline error without navigating
- **Cancel** button — navigate back to `/scheduled-messages`
  - Confirm if unsaved changes exist

### 9. Edit Mode

- Route: `/scheduled-messages/{id}/edit`
- Fetch schedule data via `GET /v1/scheduled-messages/{id}` on mount
- **Only editable if status is `pending` or `paused`** — if status is anything else, show a read-only view with a note ("This schedule can no longer be edited")
- Pre-populate all form fields: name, send_type, delivery_address/contact_group_ids, channel_id, template_id/message_body, scheduled_at, timezone, is_recurring, recurrence_rule, recurrence_end_at, custom_values
- Page title changes to "Edit Schedule"
- Parse `recurrence_rule` back into form state (e.g., "weekly:mon,wed,fri" → Weekly repeat with Mon/Wed/Fri selected)
- Show loading skeleton while fetching schedule data

---

## API Integration

### API Service (extend `apps/turumba/lib/api/scheduled-messages.ts`)

```tsx
export async function createScheduledMessage(data: {
  name?: string;
  channel_id: string;
  send_type: "single" | "group";
  template_id?: string;
  message_body?: string;
  delivery_address?: string;
  contact_id?: string;
  contact_group_ids?: string[];
  exclude_contact_ids?: string[];
  scheduled_at: string;
  timezone?: string;
  is_recurring?: boolean;
  recurrence_rule?: string;
  recurrence_end_at?: string;
  custom_values?: Record<string, string>;
  metadata?: Record<string, unknown>;
}) { ... }

export async function updateScheduledMessage(id: string, data: {
  name?: string;
  channel_id?: string;
  template_id?: string;
  message_body?: string;
  delivery_address?: string;
  contact_id?: string;
  contact_group_ids?: string[];
  exclude_contact_ids?: string[];
  scheduled_at?: string;
  timezone?: string;
  is_recurring?: boolean;
  recurrence_rule?: string;
  recurrence_end_at?: string;
  custom_values?: Record<string, string>;
  status?: string;
}) { ... }
```

Also needs:
- `listChannels` from `apps/turumba/lib/api/channels.ts` — for channel dropdown
- `listTemplates` from `apps/turumba/lib/api/templates.ts` — for template dropdown
- Contact groups API — for contact group selection (group send type)

---

## Tasks

### 1. Create Scheduled Message Page
- [ ] Create `apps/turumba/app/(dashboard)/scheduled-messages/new/page.tsx`
- [ ] Two-column layout: form left, summary/preview right
- [ ] Page header: "Create Schedule" with back link to `/scheduled-messages`

### 2. Edit Scheduled Message Page
- [ ] Create `apps/turumba/app/(dashboard)/scheduled-messages/[id]/edit/page.tsx`
- [ ] Fetch schedule data on mount, loading skeleton
- [ ] Pre-populate all form fields including parsing `recurrence_rule` back to form state
- [ ] Page header: "Edit Schedule" with back link
- [ ] Read-only guard: if status is not `pending` or `paused`, show read-only view with note

### 3. Send Type Section
- [ ] Radio group: "Single recipient" / "Contact group(s)"
- [ ] Single: delivery address text input (required), optional contact search/select for `contact_id`
- [ ] Group: contact group multi-select with checkboxes, contact counts, estimated recipients
- [ ] Group: exclude contacts section (collapsible)
- [ ] Switching send type clears the other option's recipient fields

### 4. Channel & Message Source
- [ ] Channel select dropdown populated from channels API, shows name + type badge
- [ ] Message source radio group: "Use existing template" / "Write message directly"
- [ ] Template select (filtered by channel type), body preview with highlighted variables
- [ ] Direct message text area (reuse FE-006 body composer component)
- [ ] Switching message source clears the other's data
- [ ] Auto-extract variables for custom values section

### 5. Schedule Configuration
- [ ] Date picker + time picker for `scheduled_at` (required)
- [ ] Timezone select with auto-detect default, common presets, search support
- [ ] Timezone display: name + offset (e.g., "Africa/Addis_Ababa (UTC+3)")
- [ ] Past date/time validation (create mode)
- [ ] "Make this recurring" checkbox toggle
- [ ] Repeat pattern select: Daily, Weekly, Monthly
- [ ] Weekly: day-of-week toggle buttons (Mon–Sun), at least one required
- [ ] Monthly: day-of-month input (1–31), supports multiple days
- [ ] Recurrence end: radio "Never" / "On specific date" with date picker
- [ ] End date must be after scheduled date
- [ ] Generate `recurrence_rule` string from form state
- [ ] Parse `recurrence_rule` string back to form state (for edit mode)

### 6. Custom Values Section
- [ ] Key-value editor auto-populated from template/message variables
- [ ] Same pattern as FE-006/FE-008
- [ ] Note for group sends about contact-specific vs shared variables

### 7. Summary Panel
- [ ] Live-updating: send type, channel, recipient, template/message, schedule (with recurrence), preview, custom values
- [ ] Message preview with sample values (reuse FE-006 preview logic)
- [ ] Human-readable recurrence display (e.g., "🔁 Weekly: Mon, Wed, Fri, until Jun 30")
- [ ] Responsive: right side on desktop, below on mobile

### 8. Form Validation (Zod)
- [ ] Send type: required (`single` or `group`)
- [ ] Single: `delivery_address` required
- [ ] Group: at least one `contact_group_ids` required
- [ ] Channel: required
- [ ] Message source: either `template_id` or `message_body` required (not both, not neither)
- [ ] Scheduled date/time: required, must be in the future (create mode)
- [ ] Recurring: if `is_recurring`, `recurrence_rule` required
- [ ] Weekly: at least one day selected
- [ ] Monthly: at least one valid day (1–31)
- [ ] Recurrence end date: must be after scheduled date (if set)
- [ ] Name: optional, max 255 chars

### 9. Form Integration
- [ ] Wire up React Hook Form + Zod with dynamic schema based on send type and recurring toggle
- [ ] Add `createScheduledMessage` to `apps/turumba/lib/api/scheduled-messages.ts`
- [ ] Schedule Send / Save Schedule button with loading state
- [ ] Cancel with unsaved changes confirmation (`<Dialog>`)
- [ ] Success redirect to `/scheduled-messages` with toast
- [ ] Error handling: inline error display

---

## UI/UX Notes

- **Follow the Figma design exactly** for layout, spacing, colors, and component styles
- Use existing `@repo/ui` components: Button, Input, Select, Label, Card, Field/FieldGroup/FieldError, Dialog, Separator, Tooltip, Checkbox
- Use `lucide-react` for icons (Calendar, Clock, Repeat, User, Users, Send, Plus, ChevronDown, Globe)
- Use `sonner` for toast notifications
- Use `<Dialog>` for unsaved changes confirmation
- The two-column layout (form + summary) should collapse to single column on mobile with the summary below
- Send type toggle should clearly show which option is active and adapt the recipient section accordingly
- Day-of-week selectors for weekly recurrence should be compact toggle buttons in a row (e.g., pill-shaped buttons: `[M] [T] [W] [T] [F] [S] [S]`)
- Timezone select should show the current UTC offset next to the timezone name
- Consider auto-detecting the user's timezone as the default
- Recurring configuration should feel intuitive — progressive disclosure: show only relevant fields based on repeat pattern
- The summary panel's schedule section should clearly distinguish one-time vs recurring with visual indicators
- For edit mode: if the schedule is not editable (wrong status), show a friendly message and render the form fields as read-only rather than hiding the page
- Reuse the body composer component from FE-006 and the contact group selector / custom values editor from FE-008

---

## Acceptance Criteria

### Create Mode
- [ ] User can create a one-time scheduled message for a single recipient
- [ ] User can create a one-time scheduled message for contact group(s)
- [ ] User can create a recurring scheduled message (daily, weekly, monthly)
- [ ] Send type toggle correctly switches between single/group recipient fields
- [ ] Single: delivery address required, optional contact search
- [ ] Group: contact group multi-select with counts, exclude contacts section
- [ ] Channel select populated from enabled channels API
- [ ] Template select populated from active templates API, filtered by channel type
- [ ] Direct message body with variable highlighting (reuses FE-006 composer)
- [ ] Template/message source toggle works correctly (mutually exclusive)
- [ ] Date/time picker for schedule with past-date validation
- [ ] Timezone select with auto-detect default and offset display
- [ ] Recurring checkbox shows/hides recurrence configuration
- [ ] Weekly repeat: day-of-week toggles, at least one required
- [ ] Monthly repeat: day-of-month input, valid range 1–31
- [ ] Recurrence end: "Never" or specific end date (after scheduled date)
- [ ] Custom values editor auto-populates from template/message variables
- [ ] Summary panel updates in real-time (send type, channel, recipients, schedule, preview)
- [ ] Live message preview renders with sample values
- [ ] Schedule Send button disabled until form is valid
- [ ] Successful creation redirects to `/scheduled-messages` with toast
- [ ] Failed creation shows inline error

### Edit Mode
- [ ] Edit page fetches schedule data with loading skeleton
- [ ] All form fields pre-populated including recurrence rule parsed back to form state
- [ ] Page title shows "Edit Schedule"
- [ ] Non-editable schedules (triggered/completed/failed/cancelled) show read-only view with note
- [ ] Save Schedule button calls PATCH, redirects on success
- [ ] Cancel with unsaved changes shows confirmation

### General
- [ ] Two-column layout collapses to single column on mobile
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Backend:** [BE-005 — Scheduled Messages CRUD](./BE-005-scheduled-messages-crud.md) (POST + PATCH + GET endpoints)
- **Backend:** [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md) (for channel dropdown)
- **Backend:** [BE-003 — Template Messages CRUD](./BE-003-template-messages-crud.md) (for template dropdown)
- **FE-009:** [Scheduled Messages Table View](./FE-009-scheduled-messages-table.md) (navigation + API file)
- **FE-006:** [Create/Edit Template Message](./FE-006-create-edit-template.md) (reuse body composer and preview components)
- **FE-008:** [Create Group Message](./FE-008-create-group-message.md) (reuse contact group selector and custom values editor)
- `@repo/ui`: Button, Input, Select, Card, Label, Field, Dialog, Separator, Tooltip, Checkbox
