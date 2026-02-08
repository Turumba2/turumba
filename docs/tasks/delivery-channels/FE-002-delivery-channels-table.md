# FE-002: Delivery Channels Table View

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#8](https://github.com/Turumba2/turumba_web_core/issues/8)
**Feature Area:** Delivery Channels

---

## Summary

Build the Delivery Channels table view page where users can see all their configured delivery channels with filtering, sorting, and pagination. This page uses the **Generic Table Builder** (`DataTable`) and **Advanced Table Filter** (`TableFilter`) shared components from `@repo/ui`.

Backend API Reference: [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md)
Feature Reference: [Turumba Messaging — Delivery Channels](../TURUMBA_MESSAGING.md#1-delivery-channels)

---

## Page Layout

```
┌─────────────────────────────────────────────────────┐
│  Delivery Channels                    [+ Add Channel] │
├─────────────────────────────────────────────────────┤
│  [Advanced Filters]                                   │
│  Channel Type ▾  is one of ▾  [sms, telegram]    ✕   │
│  Status ▾        is ▾         [connected]        ✕   │
│  [+ Add Filter]                       [Clear All]     │
├─────────────────────────────────────────────────────┤
│  Name        │ Type     │ Status    │ Priority │ ... │
│──────────────┼──────────┼───────────┼──────────┼─────│
│  Marketing   │ SMS      │ Connected │ 5        │ ••• │
│  Support Bot │ Telegram │ Connected │ 3        │ ••• │
│  Bulk SMS    │ SMPP     │ Error     │ 1        │ ••• │
│──────────────┼──────────┼───────────┼──────────┼─────│
│  Showing 1–3 of 3       │ ◀ 1 ▶    │ 10 per page ▾  │
└─────────────────────────────────────────────────────┘
```

---

## Column Definitions

| Column | Field | Sortable | Cell Renderer |
|--------|-------|----------|---------------|
| Name | `name` | Yes | Plain text |
| Type | `channel_type` | Yes | Badge/chip with channel icon (e.g., SMS icon, Telegram icon) |
| Status | `status` | Yes | Color-coded badge: green=connected, gray=disconnected, yellow=rate_limited, red=error, muted=disabled |
| Sender | `sender_name` | No | Plain text, show "—" if null |
| Priority | `priority` | Yes | Numeric |
| Enabled | `is_enabled` | No | Toggle switch or green/red dot |
| Created | `created_at` | Yes | Relative time (e.g., "3 days ago") or formatted date |
| Actions | — | No | Dropdown menu: View, Edit, Delete |

---

## Filter Fields

Based on the BE-002 FilterSortConfig:

| Field | Label | Type | Operations |
|-------|-------|------|------------|
| `name` | Name | text | eq, contains, icontains |
| `channel_type` | Channel Type | select | eq, in |
| `status` | Status | select | eq, in |
| `is_enabled` | Enabled | boolean | eq |
| `priority` | Priority | number | eq, ge, le |
| `created_at` | Created At | date | ge, le, range |
| `updated_at` | Updated At | date | ge, le, range |

**Select options for `channel_type`:** sms, smpp, telegram, whatsapp, messenger, email

**Select options for `status`:** connected, disconnected, rate_limited, error, disabled

---

## URL State Management

Use `nuqs` to persist filter, sort, and pagination state in the URL:

```
/channels?filter=channel_type:in:sms,telegram&filter=status:eq:connected&sort=priority:desc&page=1&limit=10
```

- [ ] Filter state synced with URL via `nuqs`
- [ ] Sort state synced with URL
- [ ] Page and page size synced with URL
- [ ] Navigating back/forward preserves table state
- [ ] Shareable URLs — opening the URL applies the same filters/sort/pagination

---

## API Integration

- **List channels:** `GET /v1/channels/?filter=...&sort=...&skip=...&limit=...` via the Turumba Gateway
- **Delete channel:** `DELETE /v1/channels/{id}` (with confirmation dialog)

### API Service (`apps/turumba/lib/api/channels.ts`)

```tsx
import { apiClient } from "./client";

export async function listChannels(params: {
  filters?: string[];
  sort?: string;
  skip?: number;
  limit?: number;
}) { ... }

export async function deleteChannel(id: string) { ... }
```

### Data Fetching Hook (`apps/turumba/hooks/useChannels.ts`)

- [ ] Reads filter/sort/page state from URL (via `nuqs`)
- [ ] Calls the channels API with the current params
- [ ] Returns `{ data, total, loading, error, refetch }`
- [ ] Refetches when URL state changes

---

## Tasks

### 1. Channels API & Hook
- [ ] Create `apps/turumba/lib/api/channels.ts` — `listChannels`, `deleteChannel`
- [ ] Create `apps/turumba/hooks/useChannels.ts` — data fetching hook with URL state

### 2. Status & Type Badges
- [ ] Create channel status badge component with color mapping (connected=green, disconnected=gray, rate_limited=yellow, error=red, disabled=muted)
- [ ] Create channel type badge/chip with icons (SMS, SMPP, Telegram, WhatsApp, Messenger, Email) using `lucide-react`

### 3. Channels Table Page
- [ ] Create `apps/turumba/app/(dashboard)/channels/page.tsx`
- [ ] Define column definitions for the `DataTable` component
- [ ] Define filter field definitions for the `TableFilter` component
- [ ] Wire up `DataTable` with channels data from `useChannels` hook
- [ ] Wire up `TableFilter` with filter state
- [ ] Sync filter/sort/pagination with URL via `nuqs`
- [ ] Implement row actions dropdown: View, Edit, Delete
- [ ] Delete action shows `<Dialog>` confirmation, calls `deleteChannel`, shows success/error toast via `sonner`, refetches table
- [ ] "Add Channel" button in page header (navigates to create page — page itself is a future task)
- [ ] Page header with title "Delivery Channels"

### 4. Navigation
- [ ] Add "Channels" link to the dashboard sidebar/navigation

---

## UI/UX Notes

- Use the `DataTable` and `TableFilter` components from `@repo/ui`
- Use `lucide-react` for icons (channel type icons, action menu dots)
- Use `sonner` for toast notifications (delete success/error)
- Use `<Dialog>` from `@repo/ui` for delete confirmation
- Empty state should suggest adding a channel: "No delivery channels yet. Add your first channel to start sending messages."
- Table should be responsive — horizontal scroll on mobile

---

## Acceptance Criteria

- [ ] Channels page displays all channels in a table with correct columns
- [ ] Sorting works: clicking column headers changes sort, visual indicator shown
- [ ] Filtering works: adding/removing filter conditions updates the table
- [ ] Pagination works: page navigation, page size change, total count display
- [ ] URL state: filters, sort, page are reflected in the URL and restored on page load
- [ ] Delete action shows confirmation dialog and removes the channel on confirm
- [ ] Status badges are color-coded correctly
- [ ] Channel type badges show correct icons/labels
- [ ] Loading state shows skeleton rows
- [ ] Empty state shows helpful message with action to add a channel
- [ ] Responsive table with horizontal scroll on small screens
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Generic Table Builder** (`DataTable`) component from `@repo/ui` — separate task
- **Advanced Table Filter** (`TableFilter`) component from `@repo/ui` — separate task
- **Backend:** [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md) (API must be available)
- Existing `@repo/ui` components: Button, DropdownMenu, Dialog, Skeleton, Empty
