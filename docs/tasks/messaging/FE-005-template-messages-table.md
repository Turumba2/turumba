# FE-005: Template Messages Table View

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#11](https://github.com/Turumba2/turumba_web_core/issues/11)
**Feature Area:** Template Messages

---

## Summary

Build the Template Messages table view page where users can browse, search, and manage their reusable message templates. Each template contains a message body with `{VARIABLE}` placeholders that get personalized per contact at send time. The page uses the **Generic Table Builder** (`DataTable`) and **Advanced Table Filter** (`TableFilter`) shared components from `@repo/ui`.

Backend API Reference: [BE-003 — Template Messages CRUD](./BE-003-template-messages-crud.md)
Feature Reference: [Turumba Messaging — Template Messages](../TURUMBA_MESSAGING.md#3-template-messages)

---

## Page Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Templates                                 [+ New Template]   │
├──────────────────────────────────────────────────────────────┤
│  [Advanced Filters]                                            │
│  Category ▾      is one of ▾  [Onboarding, Reminders]    ✕   │
│  Active ▾        is ▾         [yes]                      ✕   │
│  [+ Add Filter]                               [Clear All]     │
├──────────────────────────────────────────────────────────────┤
│  Name          │ Category    │ Channel │ Variables │ Status │… │
│────────────────┼─────────────┼─────────┼───────────┼────────┼──│
│  Welcome Msg   │ Onboarding  │ Any     │ 3 vars    │ Active │… │
│  OTP Code      │ Security    │ SMS     │ 1 var     │ Active │… │
│  Weekly Update │ Reminders   │ WA ⏳   │ 4 vars    │ Active │… │
│────────────────┼─────────────┼─────────┼───────────┼────────┼──│
│  Showing 1–3 of 12          │ ◀ 1 ▶   │ 10 per page ▾        │
└──────────────────────────────────────────────────────────────┘
```

---

## Column Definitions

| Column | Field | Sortable | Cell Renderer |
|--------|-------|----------|---------------|
| Name | `name` | Yes | Plain text, bold |
| Body Preview | `body` | No | Truncated ~50 chars with `{VARIABLES}` highlighted in a distinct color. Tooltip for full text |
| Category | `category` | Yes | Badge/chip. Show "—" if null |
| Channel | `channel_type` | Yes | Channel type badge with icon (SMS, Telegram, etc.). Show "Any" if null |
| Variables | `variables` | No | Count label (e.g., "3 vars") with tooltip listing variable names (e.g., "FIRST_NAME, CODE, DATE") |
| Fallback | `fallback_strategy` | No | Label: "Keep placeholder", "Use default", or "Skip contact" |
| Approval | `approval_status` | No | Color-coded badge (only shown if `channel_type` requires approval, e.g., WhatsApp). Hidden/dash for others |
| Active | `is_active` | No | Green dot / red dot or toggle indicator |
| Created | `created_at` | Yes | Relative time (e.g., "5 days ago") or formatted date |
| Actions | — | No | Dropdown menu: Preview, Edit, Duplicate, Delete |

### Approval Status Badge Colors

| Status | Color | Icon |
|--------|-------|------|
| Approved | Green | CheckCircle |
| Pending | Yellow | Clock |
| Rejected | Red | XCircle |
| N/A (null) | — | Show "—" or hide column cell |

---

## Filter Fields

Based on the BE-003 FilterSortConfig:

| Field | Label | Type | Operations |
|-------|-------|------|------------|
| `name` | Name | text | eq, contains, icontains |
| `category` | Category | select | eq, in |
| `channel_type` | Channel Type | select | eq, in |
| `language` | Language | select | eq, in |
| `is_active` | Active | boolean | eq |
| `approval_status` | Approval Status | select | eq, in |
| `fallback_strategy` | Fallback Strategy | select | eq |
| `created_by_user_id` | Created By | select | eq |
| `created_at` | Created At | date | ge, le, range |
| `updated_at` | Updated At | date | ge, le, range |

**Select options for `channel_type`:** sms, smpp, telegram, whatsapp, messenger, email (plus an implicit "Any" that means no filter)

**Select options for `category`:** Populated dynamically from existing templates (distinct categories from the API), or allow freeform if the API doesn't provide a categories endpoint

**Select options for `approval_status`:** pending, approved, rejected

**Select options for `fallback_strategy`:** keep_placeholder, use_default, skip_contact

**Select options for `language`:** Populated dynamically or common presets (en, am, etc.)

---

## URL State Management

Use `nuqs` to persist filter, sort, and pagination state in the URL:

```
/templates?filter=category:eq:Onboarding&filter=is_active:eq:true&sort=name:asc&page=1&limit=10
```

- [ ] Filter state synced with URL via `nuqs`
- [ ] Sort state synced with URL
- [ ] Page and page size synced with URL
- [ ] Default sort: `created_at:desc` (newest first)
- [ ] Navigating back/forward preserves table state
- [ ] Shareable URLs

---

## Template Preview

Clicking a template row (or "Preview" action) opens a preview panel — either a side panel (`<Sheet>`) or a modal (`<Dialog>`).

### Preview Content

| Section | Content |
|---------|---------|
| **Header** | Template name, category badge, channel type badge, active status |
| **Template Body** | Full body text with `{VARIABLE}` placeholders visually highlighted (colored chips or distinct styling) |
| **Variables** | List of extracted variables with their default values (if any) and fallback strategy |
| **Configuration** | Channel type restriction, language, approval status |
| **Rendered Example** | Preview of the body with example values replacing variables (e.g., `{FIRST_NAME}` → "Sarah", `{CODE}` → "ABC123") |
| **Metadata** | Created by, created at, last updated |

The rendered example section gives users a quick view of how the template will look when sent.

---

## API Integration

- **List templates:** `GET /v1/templates/?filter=...&sort=...&skip=...&limit=...` via the Turumba Gateway
- **Get template detail:** `GET /v1/templates/{id}`
- **Delete template:** `DELETE /v1/templates/{id}` (with confirmation dialog)

### API Service (`apps/turumba/lib/api/templates.ts`)

```tsx
import { apiClient } from "./client";

export async function listTemplates(params: {
  filters?: string[];
  sort?: string;
  skip?: number;
  limit?: number;
}) { ... }

export async function getTemplate(id: string) { ... }

export async function deleteTemplate(id: string) { ... }
```

### Data Fetching Hook (`apps/turumba/hooks/useTemplates.ts`)

- [ ] Reads filter/sort/page state from URL (via `nuqs`)
- [ ] Calls the templates API with the current params
- [ ] Returns `{ data, total, loading, error, refetch }`
- [ ] Refetches when URL state changes

---

## Tasks

### 1. Templates API & Hooks
- [ ] Create `apps/turumba/lib/api/templates.ts` — `listTemplates`, `getTemplate`, `deleteTemplate`
- [ ] Create `apps/turumba/hooks/useTemplates.ts` — data fetching hook with URL state

### 2. Template-Specific Renderers
- [ ] Body preview cell: truncated text with `{VARIABLE}` placeholders highlighted in a distinct color
- [ ] Variables count cell: "3 vars" label with tooltip listing names
- [ ] Approval status badge: green/yellow/red or dash for N/A
- [ ] Fallback strategy label: human-readable ("Keep placeholder", "Use default", "Skip contact")
- [ ] Category badge/chip

### 3. Templates Table Page
- [ ] Create `apps/turumba/app/(dashboard)/templates/page.tsx`
- [ ] Define column definitions for the `DataTable` component
- [ ] Define filter field definitions for the `TableFilter` component
- [ ] Wire up `DataTable` with templates data from `useTemplates` hook
- [ ] Wire up `TableFilter` with filter state
- [ ] Sync filter/sort/pagination with URL via `nuqs`
- [ ] Default sort: `created_at:desc`
- [ ] Implement row actions dropdown: Preview, Edit, Duplicate, Delete
- [ ] Delete action shows `<Dialog>` confirmation, calls `deleteTemplate`, shows success/error toast via `sonner`, refetches table
- [ ] Duplicate action creates a copy (navigates to create page with pre-filled data — future enhancement)
- [ ] "New Template" button in page header (navigates to create page — future task)
- [ ] Page header with title "Templates"

### 4. Template Preview Panel
- [ ] Create preview side panel (`<Sheet>`) or modal (`<Dialog>`)
- [ ] Display full template body with highlighted variables
- [ ] Variables list with default values and fallback strategy
- [ ] Rendered example with sample variable values
- [ ] Template metadata (channel type, language, approval status, created by, dates)

### 5. Navigation
- [ ] Add "Templates" link to the dashboard sidebar/navigation

---

## UI/UX Notes

- Use the `DataTable` and `TableFilter` components from `@repo/ui`
- Use `lucide-react` for icons (channel types, approval status, action menu)
- Use `sonner` for toast notifications (delete success/error)
- Use `<Dialog>` for delete confirmation
- Use `<Sheet>` for preview side panel
- `{VARIABLE}` placeholders in the body preview should be visually distinct — use a colored background (e.g., light blue chip/highlight) to make them stand out from plain text
- Variables tooltip should list names comma-separated (e.g., "FIRST_NAME, LAST_NAME, CODE")
- Empty state: "No templates yet. Create your first template to start sending personalized messages."
- Loading state: skeleton rows

---

## Acceptance Criteria

- [ ] Templates page displays all templates in a table with correct columns
- [ ] Name column is bold, body preview is truncated with highlighted variables
- [ ] Category column shows badge/chip
- [ ] Channel type column shows "Any" for null or channel badge with icon
- [ ] Variables column shows count with tooltip listing variable names
- [ ] Approval status shows color-coded badge (or dash for N/A)
- [ ] Sorting works on name, category, channel_type, created_at columns
- [ ] Filtering works: name search, category, channel_type, language, active, approval status, fallback strategy
- [ ] Pagination works with URL state persistence
- [ ] Preview panel shows full body with highlighted variables and rendered example
- [ ] Delete shows confirmation and removes the template
- [ ] "New Template" button present in header
- [ ] Loading skeleton and empty state display properly
- [ ] Responsive table with horizontal scroll on small screens
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Generic Table Builder** (`DataTable`) from `@repo/ui` — separate task
- **Advanced Table Filter** (`TableFilter`) from `@repo/ui` — separate task
- **Backend:** [BE-003 — Template Messages CRUD](./BE-003-template-messages-crud.md) (API must be available)
