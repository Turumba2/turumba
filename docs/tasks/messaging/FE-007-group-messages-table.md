# FE-007: Group Messages Table View

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#13](https://github.com/Turumba2/turumba_web_core/issues/13)
**Feature Area:** Group Messaging
**Figma:** (link to Figma design)

---

## Summary

Build the Group Messages table view page where users can browse, filter, and manage their group message campaigns. Each group message represents a bulk send operation — one message dispatched to an entire contact group through a selected delivery channel. The table shows real-time progress tracking (sent, delivered, failed, pending counts) with visual progress bars. The page uses the **Generic Table Builder** (`DataTable`) and **Advanced Table Filter** (`TableFilter`) shared components from `@repo/ui`.

Backend API Reference: [BE-004 — Group Messages CRUD](./BE-004-group-messages-crud.md)
Feature Reference: [Turumba Messaging — Group Messaging](../TURUMBA_MESSAGING.md#4-group-messaging)

---

## Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Group Messages                              [+ New Group Send]   │
├──────────────────────────────────────────────────────────────────┤
│  [Advanced Filters]                                                │
│  Status ▾       is one of ▾  [completed, processing]          ✕   │
│  [+ Add Filter]                                    [Clear All]    │
├──────────────────────────────────────────────────────────────────┤
│  Name          │ Status     │ Progress         │ Channel │ Sched │…│
│────────────────┼────────────┼──────────────────┼─────────┼───────┼──│
│  March Welcome │ ✓ Complete │ ████████ 500/500 │ SMS     │ —     │…│
│  OTP Blast     │ ◑ Process  │ ████░░░░ 231/500 │ SMS     │ —     │…│
│  Weekly News   │ ● Draft    │ — / 1,200        │ TG      │ Mar 10│…│
│────────────────┼────────────┼──────────────────┼─────────┼───────┼──│
│  Showing 1–3 of 45          │ ◀ 1 ▶  │ 10 per page ▾              │
└──────────────────────────────────────────────────────────────────┘
```

---

## Route

- `apps/turumba/app/(dashboard)/group-messages/page.tsx`

---

## Column Definitions

| Column | Field | Sortable | Cell Renderer |
|--------|-------|----------|---------------|
| Name | `name` | Yes | Plain text, bold. Show "Untitled" in muted text if null |
| Status | `status` | Yes | Color-coded badge with icon (see status badges below) |
| Progress | computed | No | Progress bar with `{sent_count + delivered_count} / {total_recipients}` label. Color reflects status |
| Template | `template_id` | No | Template name (resolved if possible), or "—" if null |
| Channel | `channel_id` | No | Channel type badge with icon (resolved from channel data). Show "—" if null |
| Recipients | `total_recipients` | Yes | Formatted number (e.g., "5,000") |
| Scheduled | `scheduled_at` | Yes | Formatted datetime or "—" if null |
| Created | `created_at` | Yes | Relative time (e.g., "2 hours ago") |
| Created By | `created_by_user_id` | No | User name (if resolvable) or "—" |
| Actions | — | No | Dropdown menu: View Details, View Messages, Cancel, Delete |

### Status Badge Colors

| Status | Color | Icon |
|--------|-------|------|
| Draft | Gray | FileEdit |
| Queued | Blue | Clock |
| Processing | Yellow (animated) | Loader |
| Completed | Green | CheckCircle |
| Partially Failed | Orange | AlertTriangle |
| Failed | Red | XCircle |
| Cancelled | Muted/Gray | Ban |

### Progress Bar

- Visual progress bar showing `(sent_count + delivered_count) / total_recipients` as a percentage
- Bar color reflects status:
  - Processing: blue (animated/pulsing)
  - Completed: green
  - Partially Failed: orange
  - Failed: red
  - Draft/Queued: gray (empty bar)
- Text label: `"342 / 500"` format with counts
- If `total_recipients` is 0 (draft before processing), show "—"

---

## Filter Fields

Based on the BE-004 FilterSortConfig:

| Field | Label | Type | Operations |
|-------|-------|------|------------|
| `name` | Name | text | eq, contains, icontains |
| `status` | Status | select | eq, in |
| `channel_id` | Channel | select | eq, in |
| `template_id` | Template | select | eq |
| `created_by_user_id` | Created By | select | eq |
| `total_recipients` | Recipients | number | ge, le |
| `scheduled_at` | Scheduled At | date | ge, le, range |
| `started_at` | Started At | date | ge, le, range |
| `completed_at` | Completed At | date | ge, le, range |
| `created_at` | Created At | date | ge, le, range |

**Select options for `status`:** draft, queued, processing, completed, partially_failed, failed, cancelled

**Select options for `channel_id`:** Populated dynamically from the user's channels list (`GET /v1/channels/?filter=is_enabled:eq:true`)

---

## URL State Management

Use `nuqs` to persist filter, sort, and pagination state in the URL:

```
/group-messages?filter=status:in:completed,processing&sort=created_at:desc&page=1&limit=10
```

- [ ] Filter state synced with URL via `nuqs`
- [ ] Sort state synced with URL
- [ ] Page and page size synced with URL
- [ ] Default sort: `created_at:desc` (newest first)
- [ ] Navigating back/forward preserves table state
- [ ] Shareable URLs

---

## Group Message Detail View

Clicking a row (or "View Details" action) opens a detail panel (`<Sheet>`).

| Section | Content |
|---------|---------|
| **Header** | Name, status badge, channel type badge |
| **Progress** | Large progress bar with detailed counts: Sent, Delivered, Failed, Pending |
| **Template** | Template name and body preview with highlighted `{VARIABLE}` placeholders |
| **Recipients** | Contact groups targeted (list of group names), excluded contacts count |
| **Custom Values** | Key-value display of template variable overrides (e.g., MEETING_LINK, EVENT_DATE) |
| **Timing** | Scheduled at, Started at, Completed at (show only non-null) |
| **Metadata** | Created by, created at, last updated |

---

## Row Actions

| Action | Description |
|--------|-------------|
| **View Details** | Open detail panel/sheet |
| **View Messages** | Navigate to `/messages?filter=group_message_id:eq:{id}` — shows individual messages for this group send |
| **Cancel** | Only for `draft`, `queued`, `processing` statuses. Confirmation dialog, calls `PATCH` with `status: "cancelled"` |
| **Delete** | Confirmation dialog. Only for `draft`, `cancelled`, `completed`, `failed` statuses |

---

## API Integration

### API Service (`apps/turumba/lib/api/group-messages.ts`)

```tsx
import { apiClient } from "./client";

export async function listGroupMessages(params: {
  filters?: string[];
  sort?: string;
  skip?: number;
  limit?: number;
}) { ... }

export async function getGroupMessage(id: string) { ... }

export async function updateGroupMessage(id: string, data: {
  name?: string;
  status?: string;
  channel_id?: string;
  template_id?: string;
  contact_group_ids?: string[];
  exclude_contact_ids?: string[];
  scheduled_at?: string;
  custom_values?: Record<string, string>;
}) { ... }

export async function deleteGroupMessage(id: string) { ... }
```

### Data Fetching Hook (`apps/turumba/hooks/useGroupMessages.ts`)

- [ ] Reads filter/sort/page state from URL (via `nuqs`)
- [ ] Calls the group messages API with the current params
- [ ] Returns `{ data, total, loading, error, refetch }`
- [ ] Refetches when URL state changes

---

## Tasks

### 1. Group Messages API & Hooks
- [ ] Create `apps/turumba/lib/api/group-messages.ts` — `listGroupMessages`, `getGroupMessage`, `updateGroupMessage`, `deleteGroupMessage`
- [ ] Create `apps/turumba/hooks/useGroupMessages.ts` — data fetching hook with URL state

### 2. Status Badges & Progress Bar
- [ ] Group message status badge component with color and icon mapping (draft=gray/FileEdit, queued=blue/Clock, processing=yellow/Loader, completed=green/CheckCircle, partially_failed=orange/AlertTriangle, failed=red/XCircle, cancelled=muted/Ban)
- [ ] Progress bar component: visual bar + text count, color by status, animated pulse for processing

### 3. Group Messages Table Page
- [ ] Create `apps/turumba/app/(dashboard)/group-messages/page.tsx`
- [ ] Define column definitions for the `DataTable` component
- [ ] Define filter field definitions for the `TableFilter` component
- [ ] Wire up `DataTable` with group messages data from `useGroupMessages` hook
- [ ] Wire up `TableFilter` with filter state
- [ ] Sync filter/sort/pagination with URL via `nuqs`
- [ ] Default sort: `created_at:desc`
- [ ] Channel filter dropdown populated dynamically from channels API
- [ ] Implement row actions dropdown: View Details, View Messages, Cancel, Delete
- [ ] Cancel action: confirmation dialog, calls `PATCH` with status `cancelled`, success/error toast, refetch
- [ ] Delete action: confirmation dialog, calls `deleteGroupMessage`, success/error toast, refetch
- [ ] "View Messages" action navigates to `/messages?filter=group_message_id:eq:{id}`
- [ ] "New Group Send" button in page header (navigates to `/group-messages/new`)
- [ ] Page header with title "Group Messages"

### 4. Group Message Detail Panel
- [ ] Create detail side panel (`<Sheet>`)
- [ ] Header with name, status badge, channel badge
- [ ] Large progress section with bar and detailed counts (Sent, Delivered, Failed, Pending)
- [ ] Template body preview with highlighted variables
- [ ] Contact groups list, excluded contacts count
- [ ] Custom values display
- [ ] Timing section (scheduled, started, completed — non-null only)
- [ ] Metadata (created by, dates)

### 5. Navigation
- [ ] Add "Group Messages" link to the dashboard sidebar/navigation

---

## UI/UX Notes

- **Follow the Figma design exactly** for layout, spacing, colors, and component styles
- Use the `DataTable` and `TableFilter` components from `@repo/ui`
- Use `lucide-react` for icons (status icons, channel icons, Users, Ban, Send, Eye)
- Use `sonner` for toast notifications (cancel/delete success/error)
- Use `<Dialog>` for cancel/delete confirmation
- Use `<Sheet>` for detail side panel
- Progress bar should feel satisfying — smooth transitions, animated pulse during processing
- Empty state: "No group messages yet. Create your first group send to reach multiple contacts at once."
- Loading state: skeleton rows
- Consider polling for status updates when there are `processing` group messages visible in the table

---

## Acceptance Criteria

- [ ] Group messages page displays all group messages in a table with correct columns
- [ ] Status column shows color-coded badge with icon for each status
- [ ] Progress column shows visual progress bar with sent/total label
- [ ] Progress bar color and animation match the current status
- [ ] Channel column shows channel type badge
- [ ] Recipients column shows formatted count
- [ ] Sorting works on name, status, total_recipients, scheduled_at, created_at columns
- [ ] Filtering works: name search, status, channel, template, recipients range, date ranges
- [ ] Pagination works with URL state persistence
- [ ] Default sort is `created_at:desc` (newest first)
- [ ] View Details opens detail panel with progress, template, recipients, custom values
- [ ] "View Messages" navigates to messages table filtered by group_message_id
- [ ] Cancel action works with confirmation (only for draft, queued, processing statuses)
- [ ] Delete works with confirmation (only for draft, cancelled, completed, failed statuses)
- [ ] "New Group Send" button present in header
- [ ] Loading skeleton and empty state display properly
- [ ] Responsive table with horizontal scroll on small screens
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Generic Table Builder** (`DataTable`) from `@repo/ui` — separate task
- **Advanced Table Filter** (`TableFilter`) from `@repo/ui` — separate task
- **Backend:** [BE-004 — Group Messages CRUD](./BE-004-group-messages-crud.md) (API must be available)
- **Backend:** [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md) (for channel filter dropdown)
- `@repo/ui`: Button, Input, Select, Card, Label, Field, Dialog, Sheet, Separator, Tooltip
