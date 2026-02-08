# FE-004: Messages Table View

**Type:** Frontend
**App:** turumba (turumba_web_core)
**Assignee:** nahomfix
**GitHub Issue:** [Turumba2/turumba_web_core#10](https://github.com/Turumba2/turumba_web_core/issues/10)
**Feature Area:** Messaging

---

## Summary

Build the Messages table view page where users can see all sent and received messages across all delivery channels with advanced filtering, sorting, and pagination. This page uses the **Generic Table Builder** (`DataTable`) and **Advanced Table Filter** (`TableFilter`) shared components from `@repo/ui`. The page also includes a "New Message" action that navigates to the message compose UI (FE-001).

Backend API Reference: [BE-001 — Messages CRUD](./BE-001-messages-crud.md)
Feature Reference: [Turumba Messaging — Messages](../TURUMBA_MESSAGING.md#2-messages)

---

## Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Messages                                  [+ New Message]   │
├─────────────────────────────────────────────────────────────┤
│  [Advanced Filters]                                           │
│  Status ▾       is one of ▾  [delivered, sent]           ✕   │
│  Direction ▾    is ▾         [outbound]                  ✕   │
│  [+ Add Filter]                              [Clear All]     │
├─────────────────────────────────────────────────────────────┤
│  Direction │ Recipient    │ Body       │ Channel │ Status │ … │
│────────────┼──────────────┼────────────┼─────────┼────────┼───│
│  ↑ Sent    │ +2519123456  │ Hi John... │ SMS     │ ✓ Del  │ … │
│  ↓ Recv    │ @user42      │ Thanks...  │ TG      │ ✓ Del  │ … │
│  ↑ Sent    │ john@ex.com  │ Welcome... │ Email   │ ✗ Fail │ … │
│────────────┼──────────────┼────────────┼─────────┼────────┼───│
│  Showing 1–3 of 1,245     │ ◀ 1 2 3 … 125 ▶ │ 10 per page ▾ │
└─────────────────────────────────────────────────────────────┘
```

---

## Column Definitions

| Column | Field | Sortable | Cell Renderer |
|--------|-------|----------|---------------|
| Direction | `direction` | No | Arrow icon: ↑ outbound (blue), ↓ inbound (green), ⚙ system (gray) with label |
| Recipient / Sender | `delivery_address` | No | Truncated address (phone, email, username). Show contact name if `contact_id` is available (future enhancement) |
| Message | `message_body` | No | Truncated text (first ~60 chars), single line with ellipsis. Tooltip or expand on hover for full text |
| Channel | `channel_id` | No | Channel type badge with icon (resolved from channel data if available, or show channel ID) |
| Status | `status` | Yes | Color-coded badge (see status badges below) |
| Sent At | `sent_at` | Yes | Relative time (e.g., "2 min ago") or formatted datetime. Show `scheduled_at` for scheduled messages, `created_at` as fallback |
| Created | `created_at` | Yes | Formatted date |
| Actions | — | No | Dropdown menu: View Details, Delete |

### Status Badge Colors

| Status | Color | Icon |
|--------|-------|------|
| Scheduled | Blue | Clock |
| Queued | Gray | Loader |
| Sending | Yellow | Loader (animated) |
| Sent | Blue | Check |
| Delivered | Green | CheckCheck (double check) |
| Failed | Red | X |
| Permanently Failed | Dark Red | XCircle |

### Direction Icons

| Direction | Icon | Color | Label |
|-----------|------|-------|-------|
| Outbound | ArrowUp or Send | Blue | "Sent" |
| Inbound | ArrowDown or Inbox | Green | "Received" |
| System | Settings or Bot | Gray | "System" |

---

## Filter Fields

Based on the BE-001 FilterSortConfig:

| Field | Label | Type | Operations |
|-------|-------|------|------------|
| `direction` | Direction | select | eq |
| `status` | Status | select | eq, in |
| `delivery_address` | Recipient | text | eq, contains, icontains |
| `channel_id` | Channel | select | eq, in |
| `sent_by_user_id` | Sent By | select | eq |
| `template_id` | Template | select | eq |
| `group_message_id` | Group Message | select | eq |
| `scheduled_at` | Scheduled At | date | ge, le, range |
| `sent_at` | Sent At | date | ge, le, range |
| `delivered_at` | Delivered At | date | ge, le, range |
| `created_at` | Created At | date | ge, le, range |

**Select options for `direction`:** outbound, inbound, system

**Select options for `status`:** scheduled, queued, sending, sent, delivered, failed, permanently_failed

**Select options for `channel_id`:** Populated dynamically from the user's channels list (`GET /v1/channels/?filter=is_enabled:eq:true`), displayed as channel name + type badge

---

## URL State Management

Use `nuqs` to persist filter, sort, and pagination state in the URL:

```
/messages?filter=status:in:delivered,sent&filter=direction:eq:outbound&sort=created_at:desc&page=1&limit=25
```

- [ ] Filter state synced with URL via `nuqs`
- [ ] Sort state synced with URL
- [ ] Page and page size synced with URL
- [ ] Default sort: `created_at:desc` (newest first)
- [ ] Default page size: 25 (messages can be high volume)
- [ ] Navigating back/forward preserves table state
- [ ] Shareable URLs

---

## Message Detail View

Clicking a message row (or "View Details" action) opens a detail view — either a side panel (`<Sheet>`) or a detail page at `/messages/{id}`.

### Detail View Content

| Section | Fields |
|---------|--------|
| **Header** | Direction badge, status badge, delivery address |
| **Message Content** | Full `message_body` text |
| **Original Template** | `original_template` if present (collapsed/expandable) |
| **Delivery Info** | Channel (name + type), sent by (user name), direction |
| **Timestamps** | Created, Scheduled, Sent, Delivered, Failed (show only non-null) |
| **Metadata** | Rendered as key-value pairs from JSONB (e.g., SMS segment count, Telegram msg ID) |
| **Error Details** | If failed: rendered from `error_details` JSONB with error codes and messages |

---

## API Integration

- **List messages:** `GET /v1/messages/?filter=...&sort=...&skip=...&limit=...` via the Turumba Gateway
- **Get message detail:** `GET /v1/messages/{id}`
- **Delete message:** `DELETE /v1/messages/{id}` (with confirmation dialog)
- **List channels (for filter dropdown):** `GET /v1/channels/?filter=is_enabled:eq:true&limit=100`

### API Service (`apps/turumba/lib/api/messages.ts`)

```tsx
import { apiClient } from "./client";

export async function listMessages(params: {
  filters?: string[];
  sort?: string;
  skip?: number;
  limit?: number;
}) { ... }

export async function getMessage(id: string) { ... }

export async function deleteMessage(id: string) { ... }
```

### Data Fetching Hook (`apps/turumba/hooks/useMessages.ts`)

- [ ] Reads filter/sort/page state from URL (via `nuqs`)
- [ ] Calls the messages API with the current params
- [ ] Returns `{ data, total, loading, error, refetch }`
- [ ] Refetches when URL state changes

---

## Tasks

### 1. Messages API & Hooks
- [ ] Create `apps/turumba/lib/api/messages.ts` — `listMessages`, `getMessage`, `deleteMessage`
- [ ] Create `apps/turumba/hooks/useMessages.ts` — data fetching hook with URL state

### 2. Status & Direction Badges
- [ ] Create message status badge component with color and icon mapping (scheduled=blue/clock, queued=gray/loader, sending=yellow/loader, sent=blue/check, delivered=green/double-check, failed=red/X, permanently_failed=dark-red/XCircle)
- [ ] Create direction badge component with icon and color (outbound=blue/arrow-up, inbound=green/arrow-down, system=gray/settings)

### 3. Messages Table Page
- [ ] Create `apps/turumba/app/(dashboard)/messages/page.tsx`
- [ ] Define column definitions for the `DataTable` component
- [ ] Define filter field definitions for the `TableFilter` component
- [ ] Wire up `DataTable` with messages data from `useMessages` hook
- [ ] Wire up `TableFilter` with filter state
- [ ] Sync filter/sort/pagination with URL via `nuqs`
- [ ] Default sort: `created_at:desc`, default page size: 25
- [ ] Channel filter dropdown populated dynamically from channels API
- [ ] Implement row actions dropdown: View Details, Delete
- [ ] Delete action shows `<Dialog>` confirmation, calls `deleteMessage`, shows success/error toast via `sonner`, refetches table
- [ ] "New Message" button in page header (navigates to compose UI — FE-001)
- [ ] Page header with title "Messages"
- [ ] Message body column truncated with ellipsis, full text on hover tooltip

### 4. Message Detail View
- [ ] Create detail view (side panel via `<Sheet>` or page at `/messages/{id}`)
- [ ] Display full message body, original template, delivery info, timestamps, metadata, error details
- [ ] Status and direction badges in header
- [ ] Timestamps section shows only non-null values
- [ ] Metadata and error details rendered as formatted key-value pairs

### 5. Navigation
- [ ] Add "Messages" link to the dashboard sidebar/navigation

---

## UI/UX Notes

- Use the `DataTable` and `TableFilter` components from `@repo/ui`
- Use `lucide-react` for icons (direction arrows, status icons, action menu)
- Use `sonner` for toast notifications (delete success/error)
- Use `<Dialog>` for delete confirmation
- Use `<Sheet>` for side panel detail view (or a separate page per Figma)
- Use `<Tooltip>` for truncated message body hover preview
- Message body column should have a max width to prevent the table from becoming too wide
- Empty state: "No messages yet. Send your first message to get started."
- Loading state: skeleton rows
- High-volume friendly: default 25 per page, efficient pagination

---

## Acceptance Criteria

- [ ] Messages page displays all messages in a table with correct columns
- [ ] Direction column shows icon + label (Sent, Received, System) with correct colors
- [ ] Status column shows color-coded badge with icon for each status
- [ ] Message body column is truncated with tooltip for full text
- [ ] Channel column shows channel type badge (resolved from channel data)
- [ ] Sorting works on status, sent_at, created_at columns
- [ ] Filtering works: direction, status, delivery_address, channel, date ranges
- [ ] Channel filter dropdown populated dynamically from user's channels
- [ ] Pagination works with default 25 per page
- [ ] URL reflects current filter/sort/page state, shareable
- [ ] Default sort is `created_at:desc` (newest first)
- [ ] View Details opens detail view with full message info
- [ ] Delete shows confirmation and removes the message
- [ ] "New Message" button navigates to compose UI
- [ ] Loading skeleton and empty state display properly
- [ ] Responsive table with horizontal scroll on small screens
- [ ] No TypeScript errors, lint passes cleanly

---

## Dependencies

- **Generic Table Builder** (`DataTable`) from `@repo/ui` — separate task
- **Advanced Table Filter** (`TableFilter`) from `@repo/ui` — separate task
- **Backend:** [BE-001 — Messages CRUD](./BE-001-messages-crud.md) (API must be available)
- **Backend:** [BE-002 — Delivery Channels CRUD](./BE-002-delivery-channels-crud.md) (for channel filter dropdown)
- **FE-001:** [Create New Message](./FE-001-create-new-message.md) (for "New Message" button navigation)
