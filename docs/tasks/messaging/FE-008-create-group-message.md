# FE-008: Create Group Message Page

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#14](https://github.com/Turumba2/turumba_web_core/issues/14)
**Feature Area:** Group Messaging
**Figma:** (link to Figma design)

---

## Summary

Build the Create Group Message page where users compose and submit a new group send. Users select a delivery channel, choose a message source (existing template or direct message body), pick one or more contact groups as recipients, optionally set custom variable values and a schedule, then submit. The page features a two-column layout with the form on the left and a live summary/preview panel on the right.

The Create Group Message API supports two modes: passing a `template_id` to use an existing template, or passing a `message_body` directly (the API auto-creates a template from the body text).

**UI design should follow the Figma mockup exactly.**

Backend API Reference: [BE-004 — Group Messages CRUD](./BE-004-group-messages-crud.md)
Feature Reference: [Turumba Messaging — Group Messaging](../TURUMBA_MESSAGING.md#4-group-messaging)

---

## Page Structure

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Back to Group Messages                   New Group Message       │
├──────────────────────────────┬─────────────────────────────────────┤
│                              │                                     │
│  Campaign Name               │         Summary                     │
│  ┌────────────────────────┐  │  ┌─────────────────────────────┐   │
│  │  e.g., "March Welcome" │  │  │  Channel: Marketing SMS      │   │
│  └────────────────────────┘  │  │  Recipients: ~5,000           │   │
│                              │  │  Template: Welcome Message    │   │
│  Delivery Channel            │  │                               │   │
│  ┌────────────────────────┐  │  │  Preview:                     │   │
│  │  Marketing SMS      ▾  │  │  │  "Hi Sarah, welcome to       │   │
│  └────────────────────────┘  │  │   Turumba Academy! Your       │   │
│                              │  │   code is MARCH-2026."        │   │
│  ── Message ─────────────── │  └─────────────────────────────┘   │
│  ○ Use existing template     │                                     │
│    ┌────────────────────┐   │  ── Custom Values ───────────────── │
│    │  Welcome Msg    ▾  │   │  MEETING_LINK │ [https://...]       │
│    └────────────────────┘   │  EVENT_DATE   │ [March 20, 2026]    │
│  ○ Write message directly    │                                     │
│    ┌────────────────────┐   │                                     │
│    │  Hi {FIRST_NAME},...│   │                                     │
│    └────────────────────┘   │                                     │
│                              │                                     │
│  ── Recipients ──────────── │                                     │
│  Contact Groups:             │                                     │
│  ┌────────────────────────┐  │                                     │
│  │ ☑ New Students (2,500) │  │                                     │
│  │ ☑ Alumni (2,500)       │  │                                     │
│  │ ☐ VIP Clients (500)   │  │                                     │
│  └────────────────────────┘  │                                     │
│  Exclude specific contacts   │                                     │
│                              │                                     │
│  ── Schedule (optional) ──── │                                     │
│  ○ Send immediately          │                                     │
│  ○ Schedule for later        │                                     │
│    [Date picker] [Time]      │                                     │
│                              │                                     │
│       [Cancel] [Send Now]    │                                     │
├──────────────────────────────┴─────────────────────────────────────┤
└────────────────────────────────────────────────────────────────────┘
```

---

## Route

- `apps/turumba/app/(dashboard)/group-messages/new/page.tsx`

---

## Requirements

### 1. Campaign Name

- Optional text input
- Placeholder: e.g., "March Welcome Campaign", "Weekly Newsletter"
- Max length: 255 characters

### 2. Delivery Channel

- Required select dropdown
- Populated dynamically from user's enabled channels (`GET /v1/channels/?filter=is_enabled:eq:true`)
- Shows channel name + type badge (e.g., "Marketing SMS [SMS]")
- Selecting a channel may filter available templates by `channel_type`

### 3. Message Source (Template or Direct)

Two mutually exclusive options (radio group):

**Option A: Use existing template**
- Select dropdown to pick an existing template
- Populated from `GET /v1/templates/?filter=is_active:eq:true`
- Optionally filtered by `channel_type` if a channel is already selected
- When selected, display the template body preview with highlighted `{VARIABLE}` placeholders
- Shows template name, category badge, and variable count in dropdown options

**Option B: Write message directly**
- Text area (same body composer as FE-006) with `{VARIABLE}` support
- Variable highlighting, Insert Variable dropdown, character count
- Auto-extract variables for the custom values section
- When submitted, the API auto-creates a template from this body

Switching between options clears the other option's data.

### 4. Contact Group Selection

- Multi-select component listing available contact groups
- Each group shows name and approximate contact count
- Populated from `GET /v1/contact-groups/` (or equivalent endpoint)
- At least one group must be selected
- Display total estimated recipients count (sum of selected group sizes)
- Checkbox-style selection for easy multi-pick

### 5. Exclude Contacts (Optional)

- Expandable/collapsible section
- Multi-select or search to pick specific contacts to exclude
- Shows count of excluded contacts
- Help text: "These contacts will not receive the message even if they are in the selected groups"

### 6. Custom Values (Optional)

- Key-value editor for template variable overrides
- Auto-populated with variables extracted from the selected template or message body
- Values here apply to **all** recipients (e.g., shared meeting link, event date)
- Same UI pattern as the default values editor in FE-006
- Contact-specific variables (like `FIRST_NAME`) are resolved per-contact at send time — show a note explaining this

### 7. Schedule (Optional)

- Radio group: "Send immediately" (default) or "Schedule for later"
- When "Schedule for later" is selected:
  - Date picker for the send date
  - Time picker for the send time
  - Timezone indicator (show user's local timezone)
  - Cannot select a date/time in the past
  - Validation error if past date/time selected

### 8. Summary Panel (Right Side)

A read-only summary panel that updates in real-time as the user fills out the form:

| Section | Content |
|---------|---------|
| **Channel** | Selected channel name + type badge, or placeholder "No channel selected" |
| **Recipients** | Estimated count from selected groups (minus exclusions), or "No groups selected" |
| **Template** | Template name or "(Direct message)" or placeholder "No message defined" |
| **Preview** | Rendered message with sample values (same as FE-006 live preview) — only shown when a template or message body is defined |
| **Schedule** | "Immediately" or formatted datetime |
| **Custom Values** | Listed key-value pairs (only shown if any values are set) |

### 9. Form Actions

- **Send Now / Schedule Send** button:
  - Label changes based on schedule selection: "Send Now" vs "Schedule for {date}"
  - Icon: `Send` for immediate, `Calendar` for scheduled
  - `POST /v1/group-messages/` with appropriate payload:
    - If using existing template: sends `template_id`
    - If using direct message: sends `message_body` (API handles auto-template creation)
    - Includes `contact_group_ids`, `exclude_contact_ids`, `channel_id`, `custom_values`, `scheduled_at`, `name`
  - Disabled until channel and at least one contact group are selected, and a message source is defined
  - Show loading spinner while submitting
  - On success: redirect to `/group-messages` with success toast (e.g., "Group message created" or "Group message scheduled for {date}")
  - On error: show inline error without navigating
- **Cancel** button — navigate back to `/group-messages`
  - Confirm if unsaved changes exist

---

## API Integration

### API Service (extend `apps/turumba/lib/api/group-messages.ts`)

```tsx
export async function createGroupMessage(data: {
  name?: string;
  channel_id: string;
  template_id?: string;
  message_body?: string;
  contact_group_ids: string[];
  exclude_contact_ids?: string[];
  scheduled_at?: string;
  custom_values?: Record<string, string>;
  metadata?: Record<string, unknown>;
}) { ... }
```

Also needs:
- `listChannels` from `apps/turumba/lib/api/channels.ts` — for channel dropdown
- `listTemplates` from `apps/turumba/lib/api/templates.ts` — for template dropdown
- Contact groups API (endpoint TBD) — for contact group selection

---

## Tasks

### 1. Create Group Message Page
- [ ] Create `apps/turumba/app/(dashboard)/group-messages/new/page.tsx`
- [ ] Two-column layout: form left, summary/preview right
- [ ] Page header: "New Group Message" with back link to `/group-messages`

### 2. Campaign Name & Channel
- [ ] Campaign name text input (optional, max 255)
- [ ] Channel select dropdown populated from channels API
- [ ] Channel options show name + type badge

### 3. Message Source Section
- [ ] Radio group: "Use existing template" / "Write message directly"
- [ ] Template select dropdown (populated from templates API, filtered by channel type)
- [ ] Template dropdown options show name, category, and variable count
- [ ] When template selected: display body preview with highlighted `{VARIABLE}` placeholders
- [ ] Direct message text area with variable highlighting and Insert Variable dropdown (reuse FE-006 body composer component)
- [ ] Switching between options clears the other's data
- [ ] Auto-extract variables from selected template or message body

### 4. Recipients Section
- [ ] Contact group multi-select with checkboxes
- [ ] Each group shows name and contact count
- [ ] Populated from contact groups API
- [ ] Total estimated recipients count displayed
- [ ] Exclude contacts section (collapsible, multi-select/search)

### 5. Custom Values Section
- [ ] Key-value editor auto-populated with extracted variables
- [ ] Same pattern as FE-006 default values editor
- [ ] Note explaining contact-specific vs shared variables

### 6. Schedule Section
- [ ] Radio group: "Send immediately" (default) / "Schedule for later"
- [ ] Date picker + time picker when scheduling
- [ ] Timezone indicator
- [ ] Past date/time validation

### 7. Summary Panel
- [ ] Live-updating summary: channel, recipients, template/message, schedule, custom values
- [ ] Message preview with sample values (reuse FE-006 preview logic)
- [ ] Responsive: right side on desktop, below on mobile

### 8. Form Validation (Zod)
- [ ] Channel: required
- [ ] Message source: either `template_id` or `message_body` required (not both, not neither)
- [ ] Contact groups: at least one required
- [ ] Scheduled date: if scheduling, must be in the future
- [ ] Name: optional, max 255 chars

### 9. Form Integration
- [ ] Wire up React Hook Form + Zod
- [ ] Add `createGroupMessage` to `apps/turumba/lib/api/group-messages.ts`
- [ ] Send Now / Schedule Send button with dynamic label and loading state
- [ ] Cancel with unsaved changes confirmation (`<Dialog>`)
- [ ] Success redirect to `/group-messages` with toast
- [ ] Error handling: inline error display

---

## UI/UX Notes

- **Follow the Figma design exactly** for layout, spacing, colors, and component styles
- Use existing `@repo/ui` components: Button, Input, Select, Label, Card, Field/FieldGroup/FieldError, Dialog, Separator, Tooltip, Checkbox
- Use `lucide-react` for icons (Send, Calendar, Clock, Users, Plus, ChevronDown)
- Use `sonner` for toast notifications
- Use `<Dialog>` for unsaved changes confirmation
- The two-column layout (form + summary) should collapse to single column on mobile with the summary below
- Message source toggle should clearly show which option is active and hide/show the relevant input
- Template select should show template name and a truncated body preview in the dropdown option
- Reuse the template body composer component from FE-006 for the "Write message directly" option
- Contact group selector should use checkboxes with group name and contact count on the right
- Consider showing a warning banner if total recipients > 10,000 (e.g., "This will send to over 10,000 contacts. Please verify your selection.")
- The summary panel should show placeholder text for empty sections to guide the user

---

## Acceptance Criteria

- [ ] User can create a group message using an existing template
- [ ] User can create a group message with a direct message body (auto-template creation via API)
- [ ] Template/message source toggle works correctly (mutually exclusive, clears other on switch)
- [ ] Channel select populated from enabled channels API
- [ ] Template select populated from active templates API, optionally filtered by channel type
- [ ] Contact group selector shows groups with contact counts, allows multi-select
- [ ] Estimated total recipients displayed and updated as groups are selected/deselected
- [ ] Exclude contacts section works (collapsible, shows excluded count)
- [ ] Custom values editor auto-populates from template/message variables
- [ ] Schedule option allows selecting future date/time with timezone indicator
- [ ] Summary panel updates in real-time as user fills out the form
- [ ] Live message preview renders template with sample values
- [ ] Send Now / Schedule Send button label changes based on schedule selection
- [ ] Button disabled until form is valid (channel + contact group + message source)
- [ ] Successful submission redirects to `/group-messages` with success toast
- [ ] Failed submission shows inline error
- [ ] Cancel with unsaved changes shows confirmation dialog
- [ ] Two-column layout collapses to single column on mobile
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Backend:** [BE-004 — Group Messages CRUD](./BE-004-group-messages-crud.md) (POST endpoint)
- **Backend:** [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md) (for channel dropdown)
- **Backend:** [BE-003 — Template Messages CRUD](./BE-003-template-messages-crud.md) (for template dropdown)
- **FE-007:** [Group Messages Table View](./FE-007-group-messages-table.md) (navigation + API file)
- **FE-006:** [Create/Edit Template Message](./FE-006-create-edit-template.md) (reuse body composer and preview components)
- `@repo/ui`: Button, Input, Select, Card, Label, Field, Dialog, Separator, Tooltip, Checkbox
