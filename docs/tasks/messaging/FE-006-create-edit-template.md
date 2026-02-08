# FE-006: Create / Edit Template Message Page

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#12](https://github.com/Turumba2/turumba_web_core/issues/12)
**Feature Area:** Template Messages
**Figma:** (link to Figma design)

---

## Summary

Build the Create and Edit Template Message page where users compose reusable message templates with `{VARIABLE}` placeholders. The page includes a rich template body composer with variable insertion, a live preview panel that renders the template with sample data, and configuration options for category, channel type, language, fallback strategy, and default values.

The same page serves both **create** and **edit** flows — in edit mode, the form is pre-populated with existing template data.

**UI design should follow the Figma mockup exactly.**

Backend API Reference: [BE-003 — Template Messages CRUD](./BE-003-template-messages-crud.md)
Feature Reference: [Turumba Messaging — Template Messages](../TURUMBA_MESSAGING.md#3-template-messages)

---

## Page Structure

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Back to Templates              Create Template / Edit Template  │
├──────────────────────────────┬─────────────────────────────────────┤
│                              │                                     │
│  Template Name               │         Live Preview                │
│  ┌────────────────────────┐  │  ┌─────────────────────────────┐   │
│  │  e.g., "Welcome Msg"  │  │  │  Hi Sarah, welcome to       │   │
│  └────────────────────────┘  │  │  Turumba Academy!           │   │
│                              │  │                             │   │
│  Category                    │  │  Your enrollment code is    │   │
│  ┌────────────────────────┐  │  │  TRB-2024-0042. Please      │   │
│  │  Onboarding        ▾  │  │  │  complete your registration  │   │
│  └────────────────────────┘  │  │  by March 15, 2026.         │   │
│                              │  │                             │   │
│  Template Body               │  │  Best regards,              │   │
│  ┌────────────────────────┐  │  │  Abebe                      │   │
│  │  Hi {FIRST_NAME},     │  │  └─────────────────────────────┘   │
│  │  welcome to            │  │                                     │
│  │  {ACCOUNT_NAME}!...    │  │  ── Variables (3) ──────────────── │
│  │                        │  │  FIRST_NAME  │ fallback: "there"   │
│  └────────────────────────┘  │  ACCOUNT_NAME │ fallback: —         │
│  [+ Insert Variable ▾]      │  CODE         │ fallback: —         │
│                              │                                     │
│  ── Settings ─────────────── │                                     │
│  Channel Type, Language,     │                                     │
│  Fallback Strategy,          │                                     │
│  Default Values              │                                     │
│                              │                                     │
│          [Cancel] [Save]     │                                     │
├──────────────────────────────┴─────────────────────────────────────┤
└────────────────────────────────────────────────────────────────────┘
```

---

## Routes

- **Create:** `apps/turumba/app/(dashboard)/templates/new/page.tsx`
- **Edit:** `apps/turumba/app/(dashboard)/templates/[id]/edit/page.tsx`

Both routes render the same form component. Edit mode fetches existing template data and pre-populates the form.

---

## Requirements

### 1. Template Name

- Required text input
- Placeholder: e.g., "Welcome Message", "OTP Code", "Weekly Update"
- Max length: 255 characters

### 2. Category

- Optional select or creatable input (user can type a new category or select existing)
- Populate suggestions from existing templates' distinct categories via API or allow freeform text
- Placeholder: e.g., "Onboarding", "Reminders", "Promotions", "Security"
- Max length: 100 characters

### 3. Template Body Composer

The core of the page — a text area where users write the template with `{VARIABLE}` placeholders.

- [ ] **Text area** with generous height (at least 8–10 rows)
- [ ] **Variable highlighting** — `{VARIABLE_NAME}` placeholders should be visually distinct within the text area. Options:
  - Syntax-highlighted overlay (colored background behind `{...}` patterns)
  - Or a rich text area that renders variables as inline chips/tags
- [ ] **Insert Variable button** — A dropdown button below the text area that inserts a variable at the current cursor position:
  - Common variables: `{FIRST_NAME}`, `{LAST_NAME}`, `{EMAIL}`, `{PHONE}`, `{ACCOUNT_NAME}`, `{SENDER_NAME}`, `{CURRENT_DATE}`
  - "Custom..." option to type a custom variable name (opens a small input)
  - Inserting places the `{VARIABLE}` text at the cursor and moves cursor after it
- [ ] **Character count** — Display character count below the text area (some channels have limits — SMS: 160 per segment)
- [ ] **Auto-extract variables** — As the user types, extract `{VARIABLE_NAME}` placeholders in real-time and display them in the preview panel's variables list

### 4. Live Preview Panel

A side panel (right side on desktop, below on mobile) that shows how the template will render with example data.

- [ ] **Rendered preview** — Replace all `{VARIABLE}` placeholders with sample values and display the resulting text
- [ ] **Sample values** — Use built-in defaults:

| Variable | Sample Value |
|----------|-------------|
| `FIRST_NAME` | Sarah |
| `LAST_NAME` | Johnson |
| `EMAIL` | sarah@example.com |
| `PHONE` | +251912345678 |
| `ACCOUNT_NAME` | Turumba Academy |
| `SENDER_NAME` | Abebe |
| `CURRENT_DATE` | (today's date) |
| Custom variables | Show the variable name in italics (e.g., *ENROLLMENT_CODE*) |

- [ ] **Variables list** — Below the rendered preview, list all extracted variables with:
  - Variable name
  - Default value (editable inline — ties to the Default Values section)
  - Indicator if a default value is set
- [ ] **Live update** — Preview updates in real-time as the user types in the body composer

### 5. Settings Section

Collapsible or clearly separated section below the body composer.

**Channel Type:**
- Optional select
- Options: SMS, SMPP, Telegram, WhatsApp, Messenger, Email (plus "Any" / blank for no restriction)
- When WhatsApp is selected, show a note: "WhatsApp templates require pre-approval from Meta"

**Language:**
- Optional select or text input
- Common presets: English (en), Amharic (am), or allow freeform language code
- Placeholder: e.g., "en"

**Fallback Strategy:**
- Required select (default: "Keep placeholder")
- Options with descriptions:

| Option | Label | Description |
|--------|-------|-------------|
| `keep_placeholder` | Keep placeholder | Leave `{VARIABLE}` as-is if value not found |
| `use_default` | Use default value | Replace with the default value defined below |
| `skip_contact` | Skip contact | Don't send to this contact if a variable can't be resolved |

When "Use default value" is selected, emphasize the Default Values section.

**Default Values:**
- Shown when fallback strategy is `use_default` (or always visible but dimmed otherwise)
- A key-value editor for each extracted variable:

```
┌──────────────────┬──────────────────────┐
│  Variable        │  Default Value       │
├──────────────────┼──────────────────────┤
│  FIRST_NAME      │  [there           ]  │
│  ACCOUNT_NAME    │  [                ]  │
│  CODE            │  [                ]  │
└──────────────────┴──────────────────────┘
```

- Variables are auto-populated from the body (same list as the preview panel)
- User can set a fallback value for each variable
- Empty default values are acceptable

### 6. Form Actions

- **Save / Create Template** button:
  - **Create mode:** `POST /v1/templates/` — on success redirect to `/templates` with success toast
  - **Edit mode:** `PATCH /v1/templates/{id}` — on success redirect to `/templates` with success toast
  - Disabled until name and body are filled
  - Show loading spinner while submitting
  - On error: show inline error without navigating
- **Cancel** button — navigate back to `/templates`
  - Confirm if unsaved changes exist

### 7. Edit Mode

- Route: `/templates/{id}/edit`
- Fetch template data via `GET /v1/templates/{id}` on mount
- Pre-populate all form fields: name, body, category, channel_type, language, fallback_strategy, default_values
- Page title changes to "Edit Template"
- Variables and preview update based on existing body
- Show loading skeleton while fetching template data

---

## API Integration

### API Service (extend `apps/turumba/lib/api/templates.ts`)

```tsx
export async function createTemplate(data: {
  name: string;
  body: string;
  category?: string;
  channel_type?: string;
  language?: string;
  fallback_strategy?: string;
  default_values?: Record<string, string>;
}) { ... }

export async function updateTemplate(id: string, data: {
  name?: string;
  body?: string;
  category?: string;
  channel_type?: string;
  language?: string;
  fallback_strategy?: string;
  default_values?: Record<string, string>;
  is_active?: boolean;
}) { ... }
```

---

## Tasks

### 1. Template Body Composer
- [ ] Text area with generous height
- [ ] Variable highlighting (colored background or inline chips for `{VARIABLE}` patterns)
- [ ] Insert Variable dropdown: common variables + custom option
- [ ] Cursor-aware insertion (insert at cursor, move cursor after)
- [ ] Character count display
- [ ] Real-time variable extraction as user types

### 2. Live Preview Panel
- [ ] Rendered preview with sample values replacing variables
- [ ] Variables list with names and default values
- [ ] Live update as user types
- [ ] Responsive: side panel on desktop, below on mobile

### 3. Settings Section
- [ ] Channel type select (with WhatsApp note)
- [ ] Language select/input
- [ ] Fallback strategy select with descriptions
- [ ] Default values key-value editor (auto-populated from extracted variables)

### 4. Form Validation (Zod)
- [ ] Name: required, max 255 chars
- [ ] Body: required, non-empty
- [ ] Channel type: optional, validate against allowed values
- [ ] Fallback strategy: required, validate against allowed values
- [ ] Category: optional, max 100 chars

### 5. Create Page
- [ ] `apps/turumba/app/(dashboard)/templates/new/page.tsx`
- [ ] Wire up React Hook Form + Zod
- [ ] Two-column layout: form left, preview right
- [ ] Cancel + Create Template buttons
- [ ] Page header: "Create Template" with back link

### 6. Edit Page
- [ ] `apps/turumba/app/(dashboard)/templates/[id]/edit/page.tsx`
- [ ] Fetch template data on mount, loading skeleton
- [ ] Pre-populate form fields
- [ ] Page header: "Edit Template" with back link
- [ ] Save button calls PATCH

### 7. API Integration
- [ ] Add `createTemplate`, `updateTemplate` to `apps/turumba/lib/api/templates.ts`
- [ ] Loading, success (redirect + toast), error states
- [ ] Unsaved changes prompt on cancel/navigation

---

## UI/UX Notes

- **Follow the Figma design exactly** for layout, spacing, colors, and component styles
- Use existing `@repo/ui` components: Button, Input, Select, Label, Card, Field/FieldGroup/FieldError, Sheet, Separator, Tooltip
- Use `lucide-react` for icons (Plus for insert variable, Eye for preview, X for remove)
- Use `sonner` for toast notifications
- Use `<Dialog>` for unsaved changes confirmation
- The two-column layout (form + preview) should collapse to single column on mobile with the preview below the form
- Variable highlighting should be performant — avoid expensive re-renders on every keystroke (debounce if needed)
- The Insert Variable dropdown should not steal focus from the text area
- Consider a subtle animation when the preview updates (fade transition)

---

## Acceptance Criteria

- [ ] User can create a new template with name, body, and optional settings
- [ ] User can edit an existing template (form pre-populated from API)
- [ ] Template body composer supports `{VARIABLE}` syntax with visual highlighting
- [ ] Insert Variable dropdown inserts at cursor position
- [ ] Character count is displayed
- [ ] Live preview panel renders template with sample variable values
- [ ] Variables are auto-extracted and listed in preview panel
- [ ] Default values editor shows all extracted variables with editable fallback values
- [ ] Fallback strategy selector works with descriptions
- [ ] Channel type selector shows WhatsApp approval note when selected
- [ ] Create/Save button is disabled until form is valid
- [ ] Successful create/save redirects to `/templates` with toast
- [ ] Failed save shows inline error
- [ ] Cancel with unsaved changes shows confirmation
- [ ] Edit mode loads existing data with loading skeleton
- [ ] Two-column layout collapses to single column on mobile
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Backend:** [BE-003 — Template Messages CRUD](./BE-003-template-messages-crud.md) (POST + PATCH + GET endpoints)
- **FE-005:** [Template Messages Table View](./FE-005-template-messages-table.md) (navigation + `templates.ts` API file)
- `@repo/ui`: Button, Input, Select, Card, Label, Field, Dialog, Sheet, Separator, Tooltip
