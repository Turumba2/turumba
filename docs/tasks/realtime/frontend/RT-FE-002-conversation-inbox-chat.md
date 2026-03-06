# RT-FE-002: Conversation Inbox + Chat View UI

**Type:** Frontend
**Service:** turumba_web_core
**Assignee:** nahomfix
**Priority:** P1 -- Main agent interface
**Phase:** 4 -- Frontend Integration
**Depends On:** RT-FE-001 (WebSocket client + hooks), RT-GW-001 (gateway routes for conversation endpoints)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 11.3](../../../TURUMBA_REALTIME_MESSAGING.md#113-conversation-inbox-ui)

---

## Summary

Build the conversation inbox and chat view UI for the Turumba agent dashboard. This is a split-pane layout with a filterable conversation list on the left and a real-time message thread with reply compose on the right. The UI integrates with the REST API for data fetching and with the WebSocket hooks from RT-FE-001 for live updates (new messages, typing indicators, presence badges, assignment notifications).

---

## Feature Module Structure

**Path:** `apps/turumba/features/conversations/`

```
features/conversations/
  components/
    ConversationInbox.tsx       -- Left panel: filterable list of conversations
    ConversationChatView.tsx    -- Right panel: message thread + reply compose
    ConversationFilters.tsx     -- Status, assignee, team, channel filters
    MessageBubble.tsx           -- Single message (inbound/outbound/private note)
    ReplyCompose.tsx            -- Textarea + send + private note toggle
    TypingIndicator.tsx         -- Animated dots when someone is typing
    AgentPresenceBadge.tsx      -- Green/yellow/grey dot for agent online status
    ChatEndpointManager.tsx     -- Admin UI for managing chat endpoints
  services/
    conversations.ts            -- REST API calls for conversations
    chat-endpoints.ts           -- REST API calls for chat endpoint CRUD
  store/
    inbox-store.ts              -- Zustand: active conversation, filters, sidebar state
  types/
    index.ts                    -- TypeScript types for conversations and messages
  index.ts                      -- Barrel export
```

Import from `@/features/conversations`, not from internal paths.

---

## Services (API Integration)

All API calls use the shared Axios client from `lib/api/client.ts`, which automatically injects the Cognito JWT and `account_id`.

### `conversations.ts`

```typescript
// List conversations (inbox view)
export const listConversations = (params: ConversationListParams) =>
  apiClient.get<ListResponse<Conversation>>("/v1/conversations/", { params });

// Get single conversation
export const getConversation = (id: string) =>
  apiClient.get<SuccessResponse<Conversation>>(`/v1/conversations/${id}`);

// Update conversation (status, assignee, team, priority, labels)
export const updateConversation = (id: string, data: ConversationUpdate) =>
  apiClient.patch<SuccessResponse<Conversation>>(`/v1/conversations/${id}`, data);

// Close conversation (soft-close via DELETE)
export const closeConversation = (id: string) =>
  apiClient.delete(`/v1/conversations/${id}`);

// List messages for a conversation (paginated, chronological)
export const listConversationMessages = (
  conversationId: string,
  params?: { skip?: number; limit?: number }
) =>
  apiClient.get<ListResponse<ConversationMessage>>(
    `/v1/conversations/${conversationId}/messages`,
    { params }
  );

// Send message (agent reply or private note)
export const sendConversationMessage = (
  conversationId: string,
  data: { content: string; is_private?: boolean }
) =>
  apiClient.post<SuccessResponse<{ message_id: string; created_at: string; status: string }>>(
    `/v1/conversations/${conversationId}/messages`,
    data
  );
```

### `chat-endpoints.ts`

```typescript
export const listChatEndpoints = (params?: PaginationParams) =>
  apiClient.get<ListResponse<ChatEndpoint>>("/v1/chat-endpoints/", { params });

export const getChatEndpoint = (id: string) =>
  apiClient.get<SuccessResponse<ChatEndpoint>>(`/v1/chat-endpoints/${id}`);

export const createChatEndpoint = (data: ChatEndpointCreate) =>
  apiClient.post<SuccessResponse<ChatEndpoint>>("/v1/chat-endpoints/", data);

export const updateChatEndpoint = (id: string, data: ChatEndpointUpdate) =>
  apiClient.patch<SuccessResponse<ChatEndpoint>>(`/v1/chat-endpoints/${id}`, data);

export const deleteChatEndpoint = (id: string) =>
  apiClient.delete(`/v1/chat-endpoints/${id}`);
```

---

## React Query Hooks

### Conversation Hooks

```typescript
// List with filters and pagination
export function useConversations(filters: ConversationListParams) {
  return useQuery({
    queryKey: ["conversations", filters],
    queryFn: () => listConversations(filters),
  });
}

// Single conversation detail
export function useConversation(id: string) {
  return useQuery({
    queryKey: ["conversations", id],
    queryFn: () => getConversation(id),
    enabled: !!id,
  });
}

// Paginated message list for a conversation
export function useConversationMessages(conversationId: string) {
  return useQuery({
    queryKey: ["conversations", conversationId, "messages"],
    queryFn: () => listConversationMessages(conversationId),
    enabled: !!conversationId,
  });
}

// Send message mutation with optimistic update
export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { content: string; is_private?: boolean }) =>
      sendConversationMessage(conversationId, data),
    onMutate: async (newMessage) => {
      // Optimistically add message to cache
      const tempId = crypto.randomUUID();
      queryClient.setQueryData(
        ["conversations", conversationId, "messages"],
        (old: any) => ({
          ...old,
          data: [...(old?.data || []), {
            id: tempId,
            content: newMessage.content,
            is_private: newMessage.is_private ?? false,
            sender_type: "agent",
            direction: "outbound",
            created_at: new Date().toISOString(),
            _optimistic: true,
          }],
        })
      );
      return { tempId };
    },
    onSuccess: (response, _variables, context) => {
      // Replace optimistic message with confirmed one
      // Dedup handled by useConversationRealtime hook (RT-FE-001)
    },
    onError: (_error, _variables, context) => {
      // Remove optimistic message, show error
      queryClient.invalidateQueries({
        queryKey: ["conversations", conversationId, "messages"],
      });
    },
  });
}

// Update conversation mutation (status, assignee, labels, priority)
export function useUpdateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ConversationUpdate }) =>
      updateConversation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
}
```

---

## UI Components

All built on `@repo/ui` + Radix UI primitives + Tailwind v4 with CVA variants.

### `ConversationInbox.tsx` -- Split-pane layout

The main page component. Renders a split-pane layout:
- **Left panel** (~350px): Scrollable conversation list with filters at top
- **Right panel** (remaining width): Chat view for the active conversation, or empty state

Uses `useInboxRealtime(accountId)` from RT-FE-001 for live inbox updates.

```
+------------------+-------------------------------------------+
| Filters bar      | Conversation header                       |
+------------------+  (subject, contact, status, assign btn)   |
| Conversation 1   +-------------------------------------------+
| [unread badge]   |                                           |
|                  | Message bubbles (scrollable)               |
| Conversation 2   |   [inbound - grey, left-aligned]          |
|                  |   [outbound - blue, right-aligned]        |
| Conversation 3   |   [private note - yellow bg, lock icon]   |
| [assigned to me] |                                           |
|                  |                                           |
| Conversation 4   | Typing indicator                          |
|                  +-------------------------------------------+
| ...              | Reply compose                             |
|                  | [textarea] [send] [private note toggle]   |
+------------------+-------------------------------------------+
```

### `ConversationFilters.tsx` -- Filter bar

Filter controls at the top of the inbox list:
- **Status dropdown:** All, Open, Assigned, Pending, Resolved
- **Assignee filter:** Me, Unassigned, All (uses current user ID)
- **Team filter:** dropdown of teams (fetched from Account API)
- **Sort by:** `last_message_at` DESC (default) or `created_at`

Filters stored in the Zustand `inbox-store.ts` and synced to URL via `nuqs`.

### `ConversationChatView.tsx` -- Message thread

The right panel showing the active conversation:
- **Header:** Contact name/identifier, conversation subject, status change dropdown, "Assign to me" button, priority selector, labels
- **Message list:** Scrollable container, auto-scroll to bottom on new messages, load older messages on scroll-up (pagination)
- **Typing indicator:** Shows at bottom of message list when another agent or visitor is typing

Uses `useConversationRealtime(conversationId)` from RT-FE-001 for live messages and typing.

### `MessageBubble.tsx` -- Single message

Three visual styles based on message type:
- **Inbound** (from contact/visitor): Left-aligned, grey background
- **Outbound** (from agent): Right-aligned, blue/primary background, white text
- **Private note** (internal agent note): Yellow/amber background, lock icon, full width

Displays: content, sender name (enriched), timestamp (relative), delivery status indicator.

### `ReplyCompose.tsx` -- Reply textarea

- Textarea with auto-resize
- **Enter** to send, **Shift+Enter** for newline
- Private note toggle button (lock icon, switches background to yellow when active)
- Send button (disabled when empty)
- Sends typing indicator via WebSocket while typing (debounced: send every 3s while typing, send `typing: false` 5s after last keystroke)

### `TypingIndicator.tsx` -- Animated dots

Shows "X is typing..." with animated dots at the bottom of the chat view. Displays the user name if available (from presence map or enriched data). Auto-hides after 5s if no new typing event received.

### `AgentPresenceBadge.tsx` -- Presence dot

Small colored dot indicator:
- Green: online
- Yellow/amber: away
- Grey: offline

Used next to agent names in the assignment dropdown and conversation headers.

### `ChatEndpointManager.tsx` -- Admin UI

CRUD interface for managing chat endpoints:
- List of chat endpoints with name, public key, status (active/inactive)
- Create dialog with name, welcome message, widget config (color, position), pre-chat form toggle
- Edit dialog
- Toggle active/inactive
- Copy embed snippet button

---

## Zustand Store

### `inbox-store.ts`

```typescript
interface InboxState {
  activeConversationId: string | null;
  filters: {
    status: string | null;        // "open", "assigned", "pending", "resolved", or null (all)
    assigneeId: string | null;    // user_id, "unassigned", or null (all)
    teamId: string | null;
    sort: string;                 // "last_message_at:desc" (default)
  };
  setActiveConversation: (id: string | null) => void;
  setFilter: (key: string, value: string | null) => void;
  resetFilters: () => void;
}
```

---

## TypeScript Types

### `types/index.ts`

```typescript
export interface Conversation {
  id: string;
  account_id: string;
  channel_id: string | null;
  chat_endpoint_id: string | null;
  contact_id: string;
  contact_identifier: string;
  assignee_id: string | null;
  team_id: string | null;
  status: "open" | "assigned" | "pending" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  subject: string | null;
  labels: string[];
  first_reply_at: string | null;
  resolved_at: string | null;
  last_message_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  // Enriched from Account API
  contact: { name?: string; phone?: string; email?: string } | null;
  assignee: { name?: string; email?: string } | null;
  team: { name?: string } | null;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  content: string;
  content_type: string;
  direction: "inbound" | "outbound";
  sender_type: "contact" | "agent" | "system";
  sender_id: string | null;
  is_private: boolean;
  created_at: string;
}

export interface ConversationUpdate {
  status?: string;
  assignee_id?: string | null;
  team_id?: string | null;
  priority?: string;
  subject?: string;
  labels?: string[];
}

export interface ConversationListParams {
  filter?: string;
  sort?: string;
  skip?: number;
  limit?: number;
}

export interface ChatEndpoint {
  id: string;
  account_id: string;
  name: string;
  public_key: string;
  is_active: boolean;
  welcome_message: string | null;
  offline_message: string | null;
  widget_config: {
    color: string;
    position: string;
    launcher_text: string;
  } | null;
  pre_chat_form: {
    enabled: boolean;
    fields: { name: string; label: string; required: boolean }[];
  } | null;
  created_at: string;
  updated_at: string;
}

export interface ChatEndpointCreate {
  name: string;
  welcome_message?: string;
  offline_message?: string;
  widget_config?: Record<string, unknown>;
  pre_chat_form?: Record<string, unknown>;
}

export interface ChatEndpointUpdate {
  name?: string;
  is_active?: boolean;
  welcome_message?: string;
  offline_message?: string;
  widget_config?: Record<string, unknown>;
  pre_chat_form?: Record<string, unknown>;
}
```

---

## Tasks

### Services
- [ ] Create `features/conversations/services/conversations.ts` with all conversation + message API calls
- [ ] Create `features/conversations/services/chat-endpoints.ts` with chat endpoint CRUD
- [ ] Create React Query hooks: `useConversations`, `useConversation`, `useConversationMessages`, `useSendMessage`, `useUpdateConversation`

### Store
- [ ] Create `features/conversations/store/inbox-store.ts` (Zustand) with active conversation, filters, actions
- [ ] Sync filter state to URL params via `nuqs`

### Components
- [ ] Create `ConversationInbox.tsx` -- split-pane layout with conversation list + chat view
- [ ] Create `ConversationFilters.tsx` -- status, assignee, team, sort filters
- [ ] Create `ConversationChatView.tsx` -- message thread + header + reply compose
- [ ] Create `MessageBubble.tsx` -- inbound (grey/left), outbound (blue/right), private note (yellow/lock)
- [ ] Create `ReplyCompose.tsx` -- textarea with Enter to send, Shift+Enter newline, private note toggle
- [ ] Create `TypingIndicator.tsx` -- animated dots with user name
- [ ] Create `AgentPresenceBadge.tsx` -- green/yellow/grey dot
- [ ] Create `ChatEndpointManager.tsx` -- CRUD UI for chat endpoints with embed snippet copy

### Real-time Integration
- [ ] Wire `useRealtimeConnection` in dashboard layout (from RT-FE-001)
- [ ] Wire `useConversationRealtime` in `ConversationChatView` for live messages + typing
- [ ] Wire `useInboxRealtime` in `ConversationInbox` for live list updates
- [ ] Wire `usePresence` for agent presence badges in assignment dropdown
- [ ] Implement typing indicator send in `ReplyCompose` (debounced: every 3s while typing, false after 5s idle)
- [ ] Implement message deduplication by `message_id` (optimistic + real-time)
- [ ] Show toast notification on `notification:assignment` event

### Types + Exports
- [ ] Create `features/conversations/types/index.ts`
- [ ] Create `features/conversations/index.ts` barrel export

### Pages
- [ ] Create conversation inbox page (route: `/conversations`)
- [ ] Create chat endpoint management page (route: `/chat-endpoints`)

---

## Acceptance Criteria

- [ ] Split-pane inbox layout renders with conversation list and chat view
- [ ] Conversations list fetched from REST API with filtering, sorting, pagination
- [ ] Clicking a conversation loads its message history in the chat view
- [ ] Messages display correctly: inbound (left/grey), outbound (right/blue), private note (yellow/lock)
- [ ] Agent can send a reply via the compose textarea (Enter to send)
- [ ] Agent can send a private note (toggle, yellow background)
- [ ] Optimistic message rendering: message appears immediately before server confirmation
- [ ] Real-time messages appear in the chat view without page refresh (via WebSocket)
- [ ] Messages deduplicated by `message_id` (no double rendering)
- [ ] Typing indicator shows when another agent or visitor is typing
- [ ] Agent typing sends WebSocket frames (debounced)
- [ ] Auto-scroll to bottom on new messages
- [ ] Load older messages on scroll-up
- [ ] Inbox list refreshes on real-time events (`conversation:new`, `conversation:updated`)
- [ ] Toast notification on new conversation assignment
- [ ] Agent presence badges display correct status (online/away/offline)
- [ ] Status, assignee, team, priority updates via dropdown/buttons
- [ ] Chat endpoint CRUD works (create, list, edit, toggle active, delete)
- [ ] Filter state synced to URL params via `nuqs`

---

## Dependencies

- **RT-FE-001** -- WebSocket client + React hooks for real-time events
- **RT-GW-001** -- Gateway routes for `/v1/conversations/`, `/v1/chat-endpoints/`
- **RT-BE-001** -- Conversation CRUD endpoints
- **RT-BE-004** -- Message extensions (conversation messages nested endpoints)

## Blocks

- None -- this is the final agent-facing UI.
