# FE-009: Scheduled Messages Table View

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#15](https://github.com/Turumba2/turumba_web_core/issues/15)
**Feature Area:** Scheduled Messages
**Figma:** (link to Figma design)

---

## Summary

Build the Scheduled Messages table view page where users can browse, filter, and manage their scheduled message sends. Each scheduled message is a scheduling configuration that defines what to send, who to send to, and when — supporting both one-time and recurring schedules with timezone awareness. The table highlights upcoming triggers, recurring cadence, send type (single vs group), and schedule status. The page uses the **Generic Table Builder** (`DataTable`) and **Advanced Table Filter** (`TableFilter`) shared components from `@repo/ui`.

Backend API Reference: [BE-005 — Scheduled Messages CRUD](./BE-005-scheduled-messages-crud.md)
Feature Reference: [Turumba Messaging — Scheduled Messages](../TURUMBA_MESSAGING.md#5-scheduled-messages)

---

## Page Layout

```
┌────────────────────────────────────────────────────────────────────┐
│  Scheduled Messages                          [+ New Schedule]       │
├────────────────────────────────────────────────────────────────────┤
│  [Advanced Filters]                                                  │
│  Status ▾       is one of ▾  [pending]                          ✕   │
│  Recurring ▾    is ▾         [yes]                              ✕   │
│  [+ Add Filter]                                      [Clear All]    │
├────────────────────────────────────────────────────────────────────┤
│  Name            │ Type   │ Status  │ Next Trigger     │ Recurrence│…│
│──────────────────┼────────┼─────────┼──────────────────┼───────────┼──│
│  Morning Report  │ 👥 Grp │ ● Pend  │ Tomorrow, 8:00AM │ 🔁 Daily  │…│
│  Welcome OTP     │ 👤 Sngl│ ✓ Done  │ —                │ Once      │…│
│  Weekly Digest   │ 👥 Grp │ ⏸ Pause │ (paused)         │ 🔁 Wk:Mon│…│
│  Payment Remind  │ 👤 Sngl│ ✗ Fail  │ —                │ Once      │…│
│──────────────────┼────────┼─────────┼──────────────────┼───────────┼──│
│  Showing 1–4 of 28          │ ◀ 1 ▶  │ 10 per page ▾                │
└────────────────────────────────────────────────────────────────────┘
```

---

## Route

- `apps/turumba/app/(dashboard)/scheduled-messages/page.tsx`

---

## Column Definitions

| Column | Field | Sortable | Cell Renderer |
|--------|-------|----------|---------------|
| Name | `name` | Yes | Plain text, bold. Show "Untitled" in muted text if null |
| Send Type | `send_type` | No | Badge with icon: "Single" (User icon, blue) or "Group" (Users icon, purple) |
| Status | `status` | Yes | Color-coded badge with icon (see status badges below) |
| Next Trigger | `next_trigger_at` | Yes | Formatted datetime with relative indicator (e.g., "Tomorrow, 8:00 AM" or "in 3 hours"). Show "—" if completed/cancelled/failed. Show "(paused)" in muted text if paused |
| Recurrence | `is_recurring` + `recurrence_rule` | No | "Once" for one-time. For recurring: repeat icon + human-readable rule (e.g., "Daily", "Weekly: Mon, Wed, Fri", "Monthly: 15th"). Show trigger count badge (e.g., "×12") |
| Channel | `channel_id` | No | Channel type badge with icon (resolved from channel data). Show "—" if null |
| Recipient | computed | No | **Single:** delivery address (truncated) or contact name. **Group:** contact group count (e.g., "3 groups") with tooltip listing group names |
| Scheduled At | `scheduled_at` | Yes | Original scheduled datetime with timezone |
| Triggers | `trigger_count` | No | Count badge (e.g., "12 triggers"). Show "—" for pending one-time |
| Created | `created_at` | Yes | Relative time (e.g., "5 days ago") |
| Actions | — | No | Dropdown menu: View Details, View Result, Pause/Resume, Cancel, Delete |

### Status Badge Colors

| Status | Color | Icon |
|--------|-------|------|
| Pending | Blue | Clock |
| Triggered | Yellow (animated) | Loader |
| Completed | Green | CheckCircle |
| Failed | Red | XCircle |
| Cancelled | Muted/Gray | Ban |
| Paused | Orange | PauseCircle |

### Send Type Badges

| Send Type | Color | Icon | Label |
|-----------|-------|------|-------|
| Single | Blue | User | "Single" |
| Group | Purple | Users | "Group" |

### Recurrence Display

Human-readable formatting of `recurrence_rule`:

| Raw Rule | Display |
|----------|---------|
| `null` (one-time) | "Once" |
| `daily` | "🔁 Daily" |
| `weekly:mon,wed,fri` | "🔁 Weekly: Mon, Wed, Fri" |
| `monthly:15` | "🔁 Monthly: 15th" |
| `monthly:1,15` | "🔁 Monthly: 1st, 15th" |

For recurring schedules, also show the trigger count as a small badge (e.g., "×12").

---

## Filter Fields

Based on the BE-005 FilterSortConfig:

| Field | Label | Type | Operations |
|-------|-------|------|------------|
| `name` | Name | text | eq, contains, icontains |
| `status` | Status | select | eq, in |
| `send_type` | Send Type | select | eq |
| `is_recurring` | Recurring | boolean | eq |
| `channel_id` | Channel | select | eq, in |
| `template_id` | Template | select | eq |
| `created_by_user_id` | Created By | select | eq |
| `scheduled_at` | Scheduled At | date | ge, le, range |
| `next_trigger_at` | Next Trigger | date | ge, le, range |
| `last_triggered_at` | Last Triggered | date | ge, le, range |
| `created_at` | Created At | date | ge, le, range |

**Select options for `status`:** pending, triggered, completed, failed, cancelled, paused

**Select options for `send_type`:** single, group

**Select options for `channel_id`:** Populated dynamically from the user's channels list (`GET /v1/channels/?filter=is_enabled:eq:true`)

---

## URL State Management

Use `nuqs` to persist filter, sort, and pagination state in the URL:

```
/scheduled-messages?filter=status:eq:pending&filter=is_recurring:eq:true&sort=next_trigger_at:asc&page=1&limit=10
```

- [ ] Filter state synced with URL via `nuqs`
- [ ] Sort state synced with URL
- [ ] Page and page size synced with URL
- [ ] Default sort: `next_trigger_at:asc` (soonest trigger first)
- [ ] Navigating back/forward preserves table state
- [ ] Shareable URLs

---

## Scheduled Message Detail View

Clicking a row (or "View Details" action) opens a detail panel (`<Sheet>`).

### Detail Panel Content

| Section | Content |
|---------|---------|
| **Header** | Name, status badge, send type badge, recurring indicator |
| **Schedule** | Scheduled at (with timezone), next trigger at, last triggered at (show only non-null). For recurring: recurrence rule in human-readable format, recurrence end date (or "Indefinite"), trigger count |
| **Message** | Template name and body preview with highlighted `{VARIABLE}` placeholders. If `message_body` was used directly, show the body text |
| **Recipient** | **Single:** delivery address, contact name (if `contact_id`). **Group:** list of contact group names, excluded contacts count |
| **Custom Values** | Key-value display of template variable overrides |
| **Channel** | Channel name + type badge |
| **Result** | Link to the created Message (single: `/messages/{message_id}`) or Group Message (group: `/group-messages/{group_message_id}`). Show "Not yet triggered" if null |
| **Metadata** | Created by, created at, last updated |

---

## Row Actions

| Action | Availability | Description |
|--------|-------------|-------------|
| **View Details** | Always | Open detail panel/sheet |
| **View Result** | When `message_id` or `group_message_id` is set | Navigate to the resulting message or group message. **Single:** `/messages/{message_id}` detail view. **Group:** `/group-messages/{group_message_id}` detail view |
| **Pause** | Only for `pending` recurring schedules | Confirmation dialog, calls `PATCH` with `status: "paused"` |
| **Resume** | Only for `paused` schedules | Calls `PATCH` with `status: "pending"`, shows success toast |
| **Cancel** | Only for `pending` or `paused` statuses | Confirmation dialog, calls `PATCH` with `status: "cancelled"` |
| **Delete** | Only for `cancelled`, `completed`, `failed` statuses | Confirmation dialog, calls `deleteScheduledMessage` |

---

## API Integration

### API Service (`apps/turumba/lib/api/scheduled-messages.ts`)

```tsx
import { apiClient } from "./client";

export async function listScheduledMessages(params: {
  filters?: string[];
  sort?: string;
  skip?: number;
  limit?: number;
}) { ... }

export async function getScheduledMessage(id: string) { ... }

export async function updateScheduledMessage(id: string, data: {
  name?: string;
  status?: string;
  channel_id?: string;
  template_id?: string;
  message_body?: string;
  scheduled_at?: string;
  timezone?: string;
  is_recurring?: boolean;
  recurrence_rule?: string;
  recurrence_end_at?: string;
  custom_values?: Record<string, string>;
}) { ... }

export async function deleteScheduledMessage(id: string) { ... }
```

### Data Fetching Hook (`apps/turumba/hooks/useScheduledMessages.ts`)

- [ ] Reads filter/sort/page state from URL (via `nuqs`)
- [ ] Calls the scheduled messages API with the current params
- [ ] Returns `{ data, total, loading, error, refetch }`
- [ ] Refetches when URL state changes

---

## Tasks

### 1. Scheduled Messages API & Hooks
- [ ] Create `apps/turumba/lib/api/scheduled-messages.ts` — `listScheduledMessages`, `getScheduledMessage`, `updateScheduledMessage`, `deleteScheduledMessage`
- [ ] Create `apps/turumba/hooks/useScheduledMessages.ts` — data fetching hook with URL state

### 2. Status Badges, Send Type Badges & Recurrence Display
- [ ] Scheduled message status badge component with color and icon mapping (pending=blue/Clock, triggered=yellow/Loader, completed=green/CheckCircle, failed=red/XCircle, cancelled=muted/Ban, paused=orange/PauseCircle)
- [ ] Send type badge component (single=blue/User, group=purple/Users)
- [ ] Recurrence rule formatter: parse `recurrence_rule` string into human-readable text (e.g., "weekly:mon,wed,fri" → "Weekly: Mon, Wed, Fri")
- [ ] Trigger count badge for recurring schedules

### 3. Scheduled Messages Table Page
- [ ] Create `apps/turumba/app/(dashboard)/scheduled-messages/page.tsx`
- [ ] Define column definitions for the `DataTable` component
- [ ] Define filter field definitions for the `TableFilter` component
- [ ] Wire up `DataTable` with scheduled messages data from `useScheduledMessages` hook
- [ ] Wire up `TableFilter` with filter state
- [ ] Sync filter/sort/pagination with URL via `nuqs`
- [ ] Default sort: `next_trigger_at:asc` (soonest first)
- [ ] Channel filter dropdown populated dynamically from channels API
- [ ] Implement row actions dropdown: View Details, View Result, Pause/Resume, Cancel, Delete
- [ ] Pause action: confirmation dialog, calls `PATCH` with status `paused`, success/error toast, refetch (only for pending recurring)
- [ ] Resume action: calls `PATCH` with status `pending`, success toast, refetch (only for paused)
- [ ] Cancel action: confirmation dialog, calls `PATCH` with status `cancelled`, success/error toast, refetch
- [ ] Delete action: confirmation dialog, calls `deleteScheduledMessage`, success/error toast, refetch
- [ ] "View Result" navigates to message or group message detail based on send_type
- [ ] "New Schedule" button in page header (navigates to create page — future task)
- [ ] Page header with title "Scheduled Messages"

### 4. Scheduled Message Detail Panel
- [ ] Create detail side panel (`<Sheet>`)
- [ ] Header with name, status badge, send type badge, recurring indicator
- [ ] Schedule section: scheduled_at with timezone, next/last trigger, recurrence rule, end date, trigger count
- [ ] Message section: template body preview with highlighted variables, or direct message body
- [ ] Recipient section: single (address + contact) or group (group names + excluded count)
- [ ] Custom values display
- [ ] Channel info
- [ ] Result link: navigate to created message or group message (if triggered)
- [ ] Metadata (created by, dates)

### 5. Navigation
- [ ] Add "Scheduled Messages" link to the dashboard sidebar/navigation

---

## UI/UX Notes

- **Follow the Figma design exactly** for layout, spacing, colors, and component styles
- Use the `DataTable` and `TableFilter` components from `@repo/ui`
- Use `lucide-react` for icons (Clock, User, Users, Loader, CheckCircle, XCircle, Ban, PauseCircle, Play, Calendar, Repeat, Send)
- Use `sonner` for toast notifications (pause/resume/cancel/delete success/error)
- Use `<Dialog>` for pause/cancel/delete confirmation
- Use `<Sheet>` for detail side panel
- The "Next Trigger" column is the most important — make it visually prominent. Consider highlighting overdue triggers (past `next_trigger_at` for pending schedules) in a warning color
- Recurring schedules should be visually distinct from one-time — use a repeat icon and the recurrence rule text
- The recurrence formatter should handle edge cases gracefully (unknown rules show raw text)
- Paused schedules should appear visually muted/dimmed in the table row
- Empty state: "No scheduled messages yet. Schedule your first message to send it at the perfect time."
- Loading state: skeleton rows
- Consider showing a "Due soon" indicator for schedules triggering within the next hour

---

## Acceptance Criteria

- [ ] Scheduled messages page displays all scheduled messages in a table with correct columns
- [ ] Status column shows color-coded badge with icon for all 6 statuses
- [ ] Send type column shows "Single" or "Group" badge with appropriate icon
- [ ] Next Trigger column shows formatted datetime with relative indicator, handles paused/completed/failed states
- [ ] Recurrence column shows "Once" for one-time or human-readable rule for recurring, with trigger count
- [ ] Recipient column shows delivery address (single) or group count with tooltip (group)
- [ ] Channel column shows channel type badge
- [ ] Sorting works on name, status, next_trigger_at, scheduled_at, created_at columns
- [ ] Filtering works: name search, status, send type, recurring, channel, template, date ranges
- [ ] Pagination works with URL state persistence
- [ ] Default sort is `next_trigger_at:asc` (soonest first)
- [ ] View Details opens detail panel with full schedule info, message preview, recipient details, result link
- [ ] "View Result" navigates to the created message or group message
- [ ] Pause works with confirmation (only for pending recurring schedules)
- [ ] Resume works (only for paused schedules)
- [ ] Cancel works with confirmation (only for pending/paused)
- [ ] Delete works with confirmation (only for cancelled/completed/failed)
- [ ] "New Schedule" button present in header
- [ ] Loading skeleton and empty state display properly
- [ ] Responsive table with horizontal scroll on small screens
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Generic Table Builder** (`DataTable`) from `@repo/ui` — separate task
- **Advanced Table Filter** (`TableFilter`) from `@repo/ui` — separate task
- **Backend:** [BE-005 — Scheduled Messages CRUD](./BE-005-scheduled-messages-crud.md) (API must be available)
- **Backend:** [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md) (for channel filter dropdown)
- **FE-004:** [Messages Table View](./FE-004-messages-table.md) (for "View Result" navigation — single)
- **FE-007:** [Group Messages Table View](./FE-007-group-messages-table.md) (for "View Result" navigation — group)
- `@repo/ui`: Button, Input, Select, Card, Label, Field, Dialog, Sheet, Separator, Tooltip
