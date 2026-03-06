# RT-FE-001: WebSocket Client + Real-Time React Hooks

**Type:** Frontend
**Service:** turumba_web_core
**Assignee:** nahomfix
**Priority:** P1 -- Foundation for live updates
**Phase:** 4 -- Frontend Integration
**Depends On:** RT-AWS-001 (WebSocket API must be deployed)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 11.1-11.2](../../../TURUMBA_REALTIME_MESSAGING.md#111-agent-websocket-manager), [WebSocket Lifecycle](../../../realtime/06-WEBSOCKET-LIFECYCLE.md)

---

## Summary

Build a WebSocket client manager and React hooks that connect the Turumba agent frontend to the AWS API Gateway WebSocket API. Uses the **native browser WebSocket API** (zero dependencies -- no socket.io, no third-party libraries). The manager handles connection lifecycle, Cognito JWT authentication, room subscriptions, exponential backoff reconnection, and event dispatch to React hooks. Hooks integrate with React Query for cache invalidation and Zustand for local state.

---

## Part 1: WebSocket Manager

### File: `apps/turumba/lib/realtime/websocket-manager.ts`

A singleton class wrapping the native `WebSocket` API.

```typescript
type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";
type EventHandler = (data: any) => void;

interface WebSocketManagerOptions {
  url: string;                        // wss://{api-gateway-url}
  getToken: () => string | null;      // Cognito JWT getter
  maxReconnectAttempts?: number;      // default: 5
  heartbeatInterval?: number;         // default: 30000ms (30s)
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private subscribedRooms: Set<string> = new Set();
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private messageQueue: object[] = [];          // queue outbound during reconnection
  private _connectionState: ConnectionState = "disconnected";

  constructor(private options: WebSocketManagerOptions) {}

  get connectionState(): ConnectionState { return this._connectionState; }

  connect(): void {
    const token = this.options.getToken();
    if (!token) return;

    this._connectionState = "connecting";
    this.ws = new WebSocket(
      `${this.options.url}?token=${token}&type=agent`
    );

    this.ws.onopen = () => this._onOpen();
    this.ws.onclose = (e) => this._onClose(e);
    this.ws.onmessage = (e) => this._onMessage(e);
    this.ws.onerror = () => {}; // onclose will fire after onerror
  }

  disconnect(): void {
    this._stopHeartbeat();
    this.reconnectAttempts = this.options.maxReconnectAttempts ?? 5; // prevent reconnect
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this._connectionState = "disconnected";
  }

  subscribe(room: string): void {
    this.subscribedRooms.add(room);
    this._send({ action: "subscribe", room });
  }

  unsubscribe(room: string): void {
    this.subscribedRooms.delete(room);
    this._send({ action: "unsubscribe", room });
  }

  sendTyping(conversationId: string, typing: boolean): void {
    this._send({ action: "typing", conversation_id: conversationId, typing });
  }

  setPresence(status: "online" | "away" | "offline"): void {
    this._send({ action: "presence", status });
  }

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);
    // Return unsubscribe function
    return () => this.off(eventType, handler);
  }

  off(eventType: string, handler: EventHandler): void {
    this.listeners.get(eventType)?.delete(handler);
  }

  // --- Private methods ---

  private _onOpen(): void {
    this._connectionState = "connected";
    this.reconnectAttempts = 0;
    this._startHeartbeat();

    // Re-subscribe to all rooms (important after reconnect)
    for (const room of this.subscribedRooms) {
      this._send({ action: "subscribe", room });
    }

    // Flush queued messages
    for (const msg of this.messageQueue) {
      this._send(msg);
    }
    this.messageQueue = [];
  }

  private _onClose(event: CloseEvent): void {
    this._stopHeartbeat();
    if (!event.wasClean) {
      this._reconnect();
    } else {
      this._connectionState = "disconnected";
    }
  }

  private _onMessage(event: MessageEvent): void {
    const message = JSON.parse(event.data);
    const handlers = this.listeners.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(message.data);
      }
    }
  }

  private _reconnect(): void {
    const max = this.options.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts >= max) {
      this._connectionState = "disconnected";
      // Emit a special event so UI can show "Connection lost" banner
      this._emitInternal("connection:failed", {});
      return;
    }

    this._connectionState = "reconnecting";
    this.reconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 30s)
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    setTimeout(() => this.connect(), delay);
  }

  private _send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else if (this._connectionState === "reconnecting") {
      // Queue messages during reconnection
      this.messageQueue.push(data);
    }
  }

  private _startHeartbeat(): void {
    const interval = this.options.heartbeatInterval ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      this.setPresence("online"); // heartbeat doubles as presence refresh
    }, interval);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _emitInternal(type: string, data: any): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }
  }
}
```

### Key Behaviors

- **Connect with Cognito JWT:** `wss://{api-gateway-url}?token={jwt}&type=agent`
- **Uses native browser WebSocket API** -- zero dependencies, no socket.io
- **Auto-reconnect with exponential backoff:** 1s, 2s, 4s, 8s, 16s. Max 5 retries, then emit `connection:failed` event so the UI can show a banner
- **Room subscription management:** `subscribe(room)`, `unsubscribe(room)`. Rooms are tracked in a Set and re-subscribed after reconnect
- **Event dispatch via EventEmitter pattern:** `on(type, handler)` returns an unsubscribe function. `off(type, handler)` for explicit removal
- **Heartbeat every 30s:** Uses `setPresence("online")` as the heartbeat, which refreshes the TTL in `ws_presence` (API Gateway idle timeout is 10 min)
- **Token refresh:** On Cognito token refresh, call `disconnect()` then `connect()` with the new token. Room subscriptions are restored automatically in `_onOpen()`
- **Connection state:** Exposed as `connectionState` property -- `"connecting"`, `"connected"`, `"disconnected"`, `"reconnecting"`
- **Outbound message queue:** Messages sent during reconnection are queued and flushed when the connection reopens

### Singleton Instance

```typescript
// apps/turumba/lib/realtime/index.ts
import { WebSocketManager } from "./websocket-manager";
import { getAccessToken } from "@/lib/auth"; // Cognito token getter

const WS_URL = process.env.NEXT_PUBLIC_WS_URL!;

export const realtimeManager = new WebSocketManager({
  url: WS_URL,
  getToken: getAccessToken,
  maxReconnectAttempts: 5,
  heartbeatInterval: 30000,
});

export { useRealtimeConnection } from "./use-realtime-connection";
export { useConversationRealtime } from "./use-conversation-realtime";
export { useInboxRealtime } from "./use-inbox-realtime";
export { usePresence } from "./use-presence";
export type * from "./types";
```

### Token Refresh Handling

When the Cognito token is about to expire:
1. Amplify refreshes the Cognito token automatically
2. `disconnect()` the current WebSocket
3. `connect()` with the new token (via `getToken()` which returns the fresh token)
4. Room subscriptions are automatically restored in `_onOpen()`
5. Approximately 200ms gap in connectivity

---

## Part 2: React Hooks

### `useRealtimeConnection` -- Global connection hook

**File:** `apps/turumba/lib/realtime/use-realtime-connection.ts`

```typescript
export function useRealtimeConnection(accountId: string) {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");

  useEffect(() => {
    realtimeManager.connect();
    realtimeManager.subscribe(`account:${accountId}`);

    const unsubState = realtimeManager.on("connection:state", (data) => {
      setConnectionState(data.state);
    });

    const unsubFailed = realtimeManager.on("connection:failed", () => {
      setConnectionState("disconnected");
    });

    return () => {
      realtimeManager.unsubscribe(`account:${accountId}`);
      realtimeManager.disconnect();
      unsubState();
      unsubFailed();
    };
  }, [accountId]);

  return { connectionState };
}
```

Call this **once** in the dashboard layout component to establish the global WebSocket connection. Subscribes to the `account:{accountId}` room for inbox-level events.

### `useConversationRealtime` -- Per-conversation hook

**File:** `apps/turumba/lib/realtime/use-conversation-realtime.ts`

```typescript
export function useConversationRealtime(conversationId: string) {
  const queryClient = useQueryClient();
  const [typingUsers, setTypingUsers] = useState<Map<string, boolean>>(new Map());
  const seenMessageIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    realtimeManager.subscribe(`conv:${conversationId}`);

    const unsubMessage = realtimeManager.on("conversation:message", (data) => {
      if (data.conversation_id !== conversationId) return;

      // Deduplicate by message_id
      if (seenMessageIds.current.has(data.message_id)) return;
      seenMessageIds.current.add(data.message_id);

      // Update React Query cache (append message to list)
      queryClient.setQueryData(
        ["conversations", conversationId, "messages"],
        (old: any) => {
          if (!old) return old;
          return { ...old, data: [...(old.data || []), data] };
        }
      );
    });

    const unsubTyping = realtimeManager.on("conversation:typing", (data) => {
      if (data.conversation_id !== conversationId) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (data.typing) {
          next.set(data.user_id, true);
        } else {
          next.delete(data.user_id);
        }
        return next;
      });
    });

    return () => {
      realtimeManager.unsubscribe(`conv:${conversationId}`);
      unsubMessage();
      unsubTyping();
    };
  }, [conversationId, queryClient]);

  return { typingUsers };
}
```

Subscribes to the `conv:{conversationId}` room on mount, unsubscribes on unmount. Listens for `conversation:message` events and updates the React Query cache (optimistic append). Deduplicates by `message_id` to prevent double rendering from both direct push and worker push paths. Tracks typing state per user.

### `useInboxRealtime` -- Inbox list updates

**File:** `apps/turumba/lib/realtime/use-inbox-realtime.ts`

```typescript
export function useInboxRealtime(accountId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubNew = realtimeManager.on("conversation:new", (data) => {
      // Invalidate conversations list cache so inbox refreshes
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });

    const unsubUpdated = realtimeManager.on("conversation:updated", (data) => {
      // Invalidate to pick up status, assignee, last_message_at changes
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });

    const unsubAssignment = realtimeManager.on("notification:assignment", (data) => {
      // Show toast notification for new assignment
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      // toast.info("You have been assigned a new conversation");
    });

    return () => {
      unsubNew();
      unsubUpdated();
      unsubAssignment();
    };
  }, [accountId, queryClient]);
}
```

Listens on the account room for `conversation:new`, `conversation:updated`, and `notification:assignment` events. Invalidates the React Query conversations list cache so the inbox refreshes. Shows a toast notification on new assignment.

### `usePresence` -- Agent presence tracking

**File:** `apps/turumba/lib/realtime/use-presence.ts`

```typescript
export function usePresence(accountId: string) {
  const [presenceMap, setPresenceMap] = useState<Map<string, { status: string; lastSeen?: string }>>(
    new Map()
  );

  useEffect(() => {
    const unsub = realtimeManager.on("agent:presence", (data) => {
      setPresenceMap((prev) => {
        const next = new Map(prev);
        next.set(data.user_id, {
          status: data.status,
          lastSeen: new Date().toISOString(),
        });
        return next;
      });
    });

    // Send own presence as online on connect
    realtimeManager.setPresence("online");

    // Set offline on page unload
    const handleUnload = () => realtimeManager.setPresence("offline");
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      unsub();
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [accountId]);

  return { presenceMap };
}
```

Listens for `agent:presence` events and maintains a `Map<userId, { status, lastSeen }>`. Sends own presence as `"online"` on mount. Sets `"offline"` on `beforeunload`.

---

## Part 3: TypeScript Types

### File: `apps/turumba/lib/realtime/types.ts`

```typescript
// Connection states
export type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

// Server -> Client events (pushed via realtime_push_worker or direct push)
export interface ConversationNewEvent {
  conversation_id: string;
  channel_id?: string;
  chat_endpoint_id?: string;
  contact_identifier: string;
  status: string;
  created_at: string;
}

export interface ConversationUpdatedEvent {
  conversation_id: string;
  status?: string;
  assignee_id?: string;
  labels?: string[];
  priority?: string;
  last_message_at?: string;
}

export interface ConversationMessageEvent {
  conversation_id: string;
  message_id: string;
  sender_type: "contact" | "agent" | "system";
  content: string;
  is_private: boolean;
  created_at: string;
  sender_id?: string;
  already_pushed?: boolean;
}

export interface TypingEvent {
  user_id: string;
  conversation_id: string;
  typing: boolean;
}

export interface PresenceEvent {
  user_id: string;
  status: "online" | "away" | "offline";
}

export interface AssignmentNotificationEvent {
  conversation_id: string;
  assigned_by?: string;
}

// Client -> Server actions
export interface SubscribeAction {
  action: "subscribe";
  room: string;
}

export interface UnsubscribeAction {
  action: "unsubscribe";
  room: string;
}

export interface TypingAction {
  action: "typing";
  conversation_id: string;
  typing: boolean;
}

export interface PresenceAction {
  action: "presence";
  status: "online" | "away" | "offline";
}

// WebSocket message wrapper (server -> client)
export interface WebSocketMessage<T = unknown> {
  type: string;
  data: T;
}
```

---

## Tasks

### WebSocket Manager
- [ ] Create `apps/turumba/lib/realtime/websocket-manager.ts`
- [ ] Implement connect with Cognito JWT (`?token={jwt}&type=agent`)
- [ ] Implement disconnect (graceful close)
- [ ] Implement room subscribe/unsubscribe with tracked Set
- [ ] Implement typing indicator send (debounced on caller side)
- [ ] Implement presence update send
- [ ] Implement event listener registration (`on`/`off`) with unsubscribe return
- [ ] Implement auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, max 5 retries)
- [ ] Implement `connection:failed` event emission after max retries
- [ ] Implement heartbeat every 30s (via `setPresence("online")`)
- [ ] Implement room re-subscription after reconnect
- [ ] Implement outbound message queue during reconnection
- [ ] Handle token refresh: disconnect + reconnect with new token
- [ ] Expose `connectionState` property

### React Hooks
- [ ] Create `use-realtime-connection.ts` -- global connection + account room subscribe on mount
- [ ] Create `use-conversation-realtime.ts` -- per-conversation messages + typing with dedup
- [ ] Create `use-inbox-realtime.ts` -- inbox list invalidation + assignment toast
- [ ] Create `use-presence.ts` -- agent presence map + own presence on mount + offline on unload
- [ ] Integrate all hooks with React Query cache invalidation/optimistic updates

### Types + Exports
- [ ] Create `lib/realtime/types.ts` with all event type interfaces
- [ ] Create `lib/realtime/index.ts` with singleton manager + hook re-exports
- [ ] Add `NEXT_PUBLIC_WS_URL` to `.env.example`

---

## Tests

- [ ] WebSocket manager connects with Cognito JWT token in query params
- [ ] WebSocket manager reconnects on unexpected close with exponential backoff
- [ ] WebSocket manager stops reconnecting after 5 attempts and emits `connection:failed`
- [ ] WebSocket manager re-subscribes to all tracked rooms after reconnect
- [ ] WebSocket manager dispatches events to registered listeners by type
- [ ] Room subscribe/unsubscribe sends correct WebSocket frame format
- [ ] Typing indicator sends correct frame format
- [ ] Presence update sends correct frame format
- [ ] Token refresh triggers graceful disconnect + reconnect with new token
- [ ] Outbound messages queued during reconnection are flushed on reconnect
- [ ] `useConversationRealtime` deduplicates messages by `message_id`
- [ ] `useInboxRealtime` invalidates React Query cache on `conversation:new` events
- [ ] `usePresence` updates map on `agent:presence` events

---

## Acceptance Criteria

- [ ] WebSocket connection established on dashboard layout mount
- [ ] Auto-subscribe to `account:{accountId}` room on connect
- [ ] Subscribe/unsubscribe to conversation rooms works correctly
- [ ] Events dispatched to React hooks and update UI state
- [ ] Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, 16s, max 5 retries)
- [ ] Connection lost banner shown after max retries exhausted
- [ ] Room subscriptions restored after reconnect
- [ ] Heartbeat keeps connection alive (every 30s)
- [ ] Messages deduplicated by `message_id` to prevent double rendering
- [ ] React Query cache updated correctly on real-time events
- [ ] Works with local dev WebSocket server (`ws://localhost:8001`) via `NEXT_PUBLIC_WS_URL`
- [ ] Zero external WebSocket dependencies (native `WebSocket` API only)

---

## Dependencies

- **RT-AWS-001** -- WebSocket endpoint URL (or local dev server for development)

## Blocks

- **RT-FE-002** (Conversation Inbox + Chat UI) -- uses these hooks for real-time updates
