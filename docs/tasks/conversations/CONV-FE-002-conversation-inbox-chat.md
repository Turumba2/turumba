# CONV-FE-002: Conversation Inbox + Chat View UI

**Type:** Frontend
**Service:** turumba_web_core
**Priority:** P1 — Core agent experience
**Phase:** 4 — Frontend Integration
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md) §11

---

## Summary

Wire the existing conversation UI components (ConversationTab, ConversationSidebar, ConversationChatView, ContactInfoPanel) from mock data to real REST API calls and WebSocket events. Build the conversation service layer, add canned response picker, typing indicators, agent presence, and assignment notifications.

The UI components are already built — this task is about **connecting them to real data**.

---

## Part 1: Conversation Feature Module

### Structure

```
apps/turumba/features/conversations/
├── components/
│   ├── conversation-inbox.tsx        # Inbox list (wire existing ConversationSidebar)
│   ├── conversation-chat.tsx         # Chat view (wire existing ConversationChatView)
│   ├── conversation-compose.tsx      # Message input + canned response picker
│   ├── conversation-header.tsx       # Status, assignee, labels, priority
│   ├── contact-info-panel.tsx        # Wire existing ContactInfoPanel
│   ├── typing-indicator.tsx          # "Agent X is typing..."
│   ├── presence-badge.tsx            # Online/away/offline dot
│   ├── canned-response-picker.tsx    # Slash-command autocomplete
│   └── assignment-toast.tsx          # "You've been assigned to..."
├── services/
│   ├── conversation-api.ts           # REST API calls
│   ├── conversation-message-api.ts   # Conversation message API calls
│   └── canned-response-api.ts       # Canned response API calls
├── hooks/
│   ├── use-conversations.ts          # React Query hooks for conversation list
│   ├── use-conversation-messages.ts  # React Query hooks for message thread
│   └── use-canned-responses.ts       # React Query hooks for canned responses
├── types/
│   └── index.ts                      # TypeScript models
└── index.ts                          # Barrel exports
```

---

## Part 2: Service Layer

### `services/conversation-api.ts`

```typescript
import { apiClient } from "@/lib/api/client";

export const conversationApi = {
  list: (params?: {
    filter?: string;
    sort?: string;
    skip?: number;
    limit?: number;
  }) => apiClient.get("/v1/conversations/", { params }),

  get: (id: string) => apiClient.get(`/v1/conversations/${id}`),

  update: (id: string, data: {
    status?: string;
    assignee_id?: string;
    priority?: string;
    labels?: string[];
  }) => apiClient.patch(`/v1/conversations/${id}`, data),

  close: (id: string) => apiClient.delete(`/v1/conversations/${id}`),
};
```

### `services/conversation-message-api.ts`

```typescript
export const conversationMessageApi = {
  list: (conversationId: string, params?: { skip?: number; limit?: number }) =>
    apiClient.get(`/v1/conversations/${conversationId}/messages`, { params }),

  create: (conversationId: string, data: {
    message_body: string;
    is_private?: boolean;
    media_url?: string;
  }) => apiClient.post(`/v1/conversations/${conversationId}/messages`, data),
};
```

### `services/canned-response-api.ts`

```typescript
export const cannedResponseApi = {
  list: (params?: { filter?: string }) =>
    apiClient.get("/v1/canned-responses/", { params }),
};
```

---

## Part 3: React Query Hooks

### `hooks/use-conversations.ts`

```typescript
export function useConversations(filters?: {
  status?: string;
  assignee_id?: string;
  sort?: string;
}) {
  return useQuery({
    queryKey: ["conversations", filters],
    queryFn: () => conversationApi.list({
      filter: buildFilterString(filters),
      sort: filters?.sort || "last_message_at:desc",
    }),
  });
}

export function useConversation(id: string) {
  return useQuery({
    queryKey: ["conversations", id],
    queryFn: () => conversationApi.get(id),
    enabled: !!id,
  });
}

export function useUpdateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => conversationApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }),
  });
}
```

### `hooks/use-conversation-messages.ts`

```typescript
export function useConversationMessages(conversationId: string) {
  return useQuery({
    queryKey: ["conversations", conversationId, "messages"],
    queryFn: () => conversationMessageApi.list(conversationId, { limit: 50 }),
    enabled: !!conversationId,
  });
}

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => conversationMessageApi.create(conversationId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["conversations", conversationId, "messages"],
      });
    },
  });
}
```

---

## Part 4: UI Components

### Conversation Inbox

Wire the existing `ConversationSidebar` to real data:
- Use `useConversations()` hook for the list
- Use `useInboxRealtime()` hook for live updates (from CONV-FE-001)
- Filter tabs: All, Mine, Unassigned, Bot
- Sort by `last_message_at:desc`
- Show unread indicator, priority badge, channel icon
- Click to select conversation → load chat view

### Conversation Chat View

Wire the existing `ConversationChatView` to real data:
- Use `useConversationMessages()` hook for message history
- Use `useConversationRealtime()` hook for live messages (from CONV-FE-001)
- Messages rendered chronologically
- Differentiate sender types (contact, agent, bot, system) visually
- Internal notes (`is_private`) styled differently (e.g., yellow background, "Internal note" label)
- Auto-scroll to bottom on new messages

### Compose Area

- Text input for agent replies
- "Send" button → `POST /conversations/{id}/messages`
- "Internal note" toggle → sets `is_private: true`
- Typing indicator: send `typing:start` on keypress, `typing:stop` after 3s idle
- Canned response picker: type `/` to trigger autocomplete from `useCanedResponses()`

### Conversation Header

- Show conversation status, priority, assignee
- Actions: Assign to me, Change status, Set priority, Add labels
- Each action calls `PATCH /conversations/{id}`

### Typing Indicator

```typescript
function TypingIndicator({ conversationId }: { conversationId: string }) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  useEffect(() => {
    const unsub = realtimeManager.on("conversation:typing", (data) => {
      if (data.conversation_id === conversationId) {
        if (data.typing) {
          setTypingUsers((prev) => [...new Set([...prev, data.user_id])]);
        } else {
          setTypingUsers((prev) => prev.filter((id) => id !== data.user_id));
        }
      }
    });
    return unsub;
  }, [conversationId]);

  if (typingUsers.length === 0) return null;
  return <div className="text-sm text-muted-foreground">Someone is typing...</div>;
}
```

### Assignment Toast

When `notification:assignment` event is received, show a toast notification with a link to the assigned conversation.

---

## Tasks

### Service Layer
- [ ] Create `features/conversations/services/conversation-api.ts`
- [ ] Create `features/conversations/services/conversation-message-api.ts`
- [ ] Create `features/conversations/services/canned-response-api.ts`
- [ ] Create TypeScript types for all conversation entities

### React Query Hooks
- [ ] Create `use-conversations.ts` (list, get, update mutations)
- [ ] Create `use-conversation-messages.ts` (list, send mutation)
- [ ] Create `use-canned-responses.ts` (list)

### Inbox UI
- [ ] Wire ConversationSidebar to `useConversations()` + `useInboxRealtime()`
- [ ] Implement filter tabs (All, Mine, Unassigned, Bot)
- [ ] Show channel icon, priority badge, unread indicator
- [ ] Conversation selection loads chat view

### Chat View UI
- [ ] Wire ConversationChatView to `useConversationMessages()` + `useConversationRealtime()`
- [ ] Render messages with sender type differentiation
- [ ] Style internal notes distinctly
- [ ] Auto-scroll on new messages
- [ ] Infinite scroll for message history (load older messages)

### Compose Area
- [ ] Message input with send button
- [ ] Internal note toggle
- [ ] Typing indicator (send on keypress, stop after idle)
- [ ] Canned response picker (/ autocomplete)

### Header + Actions
- [ ] Display status, assignee, priority, labels
- [ ] Assign to me action
- [ ] Change status action
- [ ] Set priority action

### Notifications
- [ ] Assignment toast notification
- [ ] Presence badges on agent avatars

---

## Acceptance Criteria

- [ ] Conversation inbox loads real data with filters and sorting
- [ ] Inbox updates in real-time when new conversations arrive
- [ ] Chat view shows full message history with pagination
- [ ] New messages appear in real-time without page refresh
- [ ] Agent can reply (text + internal notes)
- [ ] Canned response picker works with `/` trigger
- [ ] Typing indicators show when other agents are typing
- [ ] Agent presence shown on avatars
- [ ] Assignment notifications appear as toast
- [ ] Conversation status/assignee/priority can be changed from header

---

## Dependencies

- **CONV-BE-001** — Conversation, CannedResponse CRUD endpoints
- **CONV-BE-002** — Conversation message endpoints
- **CONV-FE-001** — WebSocket client + real-time hooks

## Blocks

None — this is the final frontend deliverable.
