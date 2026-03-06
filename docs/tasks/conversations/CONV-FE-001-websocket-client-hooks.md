# CONV-FE-001: WebSocket Client + Real-Time Hooks

**Type:** Frontend
**Service:** turumba_web_core
**Priority:** P1 — Required for real-time conversation experience
**Phase:** 4 — Frontend Integration
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md) §5.6, §11

---

## Summary

Build a WebSocket client manager and React hooks that connect the Turumba frontend to the AWS API Gateway WebSocket API. This replaces the originally planned `socket.io-client` with the **native browser WebSocket API** (zero dependencies). The manager handles connection lifecycle, authentication, room subscriptions, reconnection, and event dispatch.

---

## Part 1: WebSocket Manager

### File: `apps/turumba/lib/realtime/websocket-manager.ts`

A singleton class that wraps the native `WebSocket` API:

```typescript
type EventHandler = (data: any) => void;

interface WebSocketManagerOptions {
  url: string;
  getToken: () => string | null;
  reconnectInterval?: number;     // default: 3000ms
  maxReconnectAttempts?: number;  // default: 10
  heartbeatInterval?: number;     // default: 30000ms
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private subscribedRooms: Set<string> = new Set();
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timer | null = null;

  constructor(private options: WebSocketManagerOptions) {}

  connect(): void {
    const token = this.options.getToken();
    if (!token) return;

    this.ws = new WebSocket(`${this.options.url}?token=${token}`);
    this.ws.onopen = () => this._onOpen();
    this.ws.onclose = (e) => this._onClose(e);
    this.ws.onmessage = (e) => this._onMessage(e);
    this.ws.onerror = (e) => this._onError(e);
  }

  disconnect(): void { /* graceful close */ }

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
    /* register listener, return unsubscribe function */
  }

  off(eventType: string, handler: EventHandler): void {
    /* remove listener */
  }

  // Private methods
  private _onOpen(): void {
    this.reconnectAttempts = 0;
    this._startHeartbeat();
    // Re-subscribe to all rooms (after reconnect)
    for (const room of this.subscribedRooms) {
      this._send({ action: "subscribe", room });
    }
  }

  private _onClose(event: CloseEvent): void {
    this._stopHeartbeat();
    if (!event.wasClean) this._reconnect();
  }

  private _onMessage(event: MessageEvent): void {
    const message = JSON.parse(event.data);
    const handlers = this.listeners.get(message.type);
    if (handlers) {
      for (const handler of handlers) handler(message.data);
    }
  }

  private _reconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = this.options.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    setTimeout(() => this.connect(), Math.min(delay, 30000));
  }

  private _send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private _startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this._send({ action: "ping" });
    }, this.options.heartbeatInterval);
  }
}
```

### Singleton Instance

```typescript
// apps/turumba/lib/realtime/index.ts
import { WebSocketManager } from "./websocket-manager";
import { getAccessToken } from "@/lib/auth"; // Cognito token getter

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3200/ws";

export const realtimeManager = new WebSocketManager({
  url: WS_URL,
  getToken: getAccessToken,
  reconnectInterval: 3000,
  maxReconnectAttempts: 10,
  heartbeatInterval: 30000,
});
```

### Token Refresh Handling

When the Cognito token is about to expire:
1. Disconnect the current WebSocket
2. Refresh the token via Amplify
3. Reconnect with the new token
4. Room subscriptions are automatically restored in `_onOpen()`

---

## Part 2: React Hooks

### `useRealtimeConnection` — Global connection hook

```typescript
// apps/turumba/lib/realtime/use-realtime-connection.ts
export function useRealtimeConnection(accountId: string) {
  useEffect(() => {
    realtimeManager.connect();
    realtimeManager.subscribe(`account:${accountId}`);

    return () => {
      realtimeManager.unsubscribe(`account:${accountId}`);
      realtimeManager.disconnect();
    };
  }, [accountId]);
}
```

Call this once in the dashboard layout to establish the global connection.

### `useConversationRealtime` — Per-conversation hook

```typescript
// apps/turumba/lib/realtime/use-conversation-realtime.ts
export function useConversationRealtime(conversationId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    realtimeManager.subscribe(`conv:${conversationId}`);

    const unsubMessage = realtimeManager.on("conversation:message", (data) => {
      if (data.conversation_id === conversationId) {
        // Append to React Query cache for this conversation's messages
        queryClient.setQueryData(
          ["conversations", conversationId, "messages"],
          (old) => ({ ...old, data: [...(old?.data || []), data] })
        );
      }
    });

    const unsubTyping = realtimeManager.on("conversation:typing", (data) => {
      if (data.conversation_id === conversationId) {
        // Update typing state
      }
    });

    return () => {
      realtimeManager.unsubscribe(`conv:${conversationId}`);
      unsubMessage();
      unsubTyping();
    };
  }, [conversationId]);
}
```

### `useInboxRealtime` — Inbox list updates

```typescript
// apps/turumba/lib/realtime/use-inbox-realtime.ts
export function useInboxRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubNew = realtimeManager.on("conversation:new", (data) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });

    const unsubUpdated = realtimeManager.on("conversation:updated", (data) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });

    const unsubAssignment = realtimeManager.on("notification:assignment", (data) => {
      // Show toast notification
    });

    return () => { unsubNew(); unsubUpdated(); unsubAssignment(); };
  }, []);
}
```

### `usePresence` — Agent presence

```typescript
// apps/turumba/lib/realtime/use-presence.ts
export function usePresence() {
  const [presenceMap, setPresenceMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsub = realtimeManager.on("agent:presence", (data) => {
      setPresenceMap((prev) => ({ ...prev, [data.user_id]: data.status }));
    });

    // Set own presence to online
    realtimeManager.setPresence("online");

    // Set offline on page unload
    const handleUnload = () => realtimeManager.setPresence("offline");
    window.addEventListener("beforeunload", handleUnload);

    return () => { unsub(); window.removeEventListener("beforeunload", handleUnload); };
  }, []);

  return { presenceMap };
}
```

---

## Part 3: Event Types

```typescript
// apps/turumba/lib/realtime/types.ts

// Server → Client events
interface ConversationNewEvent {
  conversation_id: string;
  channel_id: string;
  contact_identifier: string;
  status: string;
  created_at: string;
}

interface ConversationUpdatedEvent {
  conversation_id: string;
  status?: string;
  assignee_id?: string;
  labels?: string[];
  priority?: string;
  last_message_at?: string;
}

interface ConversationMessageEvent {
  conversation_id: string;
  message_id: string;
  sender_type: "contact" | "agent" | "bot" | "system";
  message_body: string;
  is_private: boolean;
  created_at: string;
}

interface TypingEvent {
  user_id: string;
  conversation_id: string;
  typing: boolean;
}

interface PresenceEvent {
  user_id: string;
  status: "online" | "away" | "offline";
}

interface AssignmentEvent {
  conversation_id: string;
  assigned_by?: string;
  rule_name?: string;
}
```

---

## Tasks

### WebSocket Manager
- [ ] Create `apps/turumba/lib/realtime/websocket-manager.ts`
- [ ] Implement connect/disconnect with JWT token
- [ ] Implement room subscribe/unsubscribe
- [ ] Implement typing indicator send
- [ ] Implement presence update send
- [ ] Implement event listener registration (on/off)
- [ ] Implement auto-reconnect with exponential backoff
- [ ] Implement heartbeat/keepalive
- [ ] Implement room re-subscription after reconnect
- [ ] Handle token refresh (disconnect + reconnect with new token)

### React Hooks
- [ ] Create `use-realtime-connection.ts` — global connection hook
- [ ] Create `use-conversation-realtime.ts` — per-conversation messages + typing
- [ ] Create `use-inbox-realtime.ts` — inbox list invalidation + assignment notifications
- [ ] Create `use-presence.ts` — agent presence tracking
- [ ] Integrate hooks with React Query cache invalidation

### Types + Exports
- [ ] Create `lib/realtime/types.ts` with all event type interfaces
- [ ] Create `lib/realtime/index.ts` with singleton manager + re-exports
- [ ] Add `NEXT_PUBLIC_WS_URL` to `.env.example`

---

## Tests

- [ ] WebSocket manager connects with token
- [ ] WebSocket manager reconnects on unexpected close
- [ ] WebSocket manager re-subscribes to rooms after reconnect
- [ ] WebSocket manager dispatches events to registered listeners
- [ ] Room subscribe/unsubscribe sends correct WebSocket frames
- [ ] Typing indicator sends correct frame format
- [ ] Token refresh triggers graceful disconnect + reconnect

---

## Acceptance Criteria

- [ ] WebSocket connection established on dashboard load
- [ ] Auto-subscribe to account room on connect
- [ ] Subscribe/unsubscribe to conversation rooms works
- [ ] Events dispatched to React hooks correctly
- [ ] Auto-reconnect with exponential backoff (up to 30s)
- [ ] Room subscriptions restored after reconnect
- [ ] Works with local dev WebSocket server (ws://localhost:3200/ws)

---

## Dependencies

- **CONV-AWS-001** — WebSocket endpoint URL (or local dev server)

## Blocks

- **CONV-FE-002** (Conversation UI) — uses these hooks for real-time updates
