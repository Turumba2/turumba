# RT-FE-003: Chat Widget App (Embeddable Vite Bundle)

**Type:** Frontend
**Service:** turumba_web_core
**Assignee:** nahomfix
**Priority:** P1 -- Webchat channel for visitors
**Phase:** 4 -- Frontend Integration
**Depends On:** RT-BE-003 (public session API + visitor token signing), RT-FE-001 (WebSocket patterns reference), RT-AWS-001 (WebSocket API for visitor connections)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 6.6](../../../TURUMBA_REALTIME_MESSAGING.md#66-widget-javascript), [Section 11.4](../../../TURUMBA_REALTIME_MESSAGING.md#114-chat-widget-embeddable), [Visitor Chat Workflow](../../../realtime/02-VISITOR-CHAT-FLOW.md)

---

## Summary

Build an embeddable chat widget as a new Turborepo app that compiles to a single `widget.js` IIFE bundle. Account users embed this script on their websites to enable live chat with visitors. The widget connects to the **same AWS API Gateway WebSocket** as agents using `?type=visitor`, handles session creation, message sending/receiving, auto-reconnect, and token refresh -- all in plain TypeScript with DOM manipulation. **No React, no framework -- bundle size target is under 50KB gzipped.**

---

## App Structure

**New Turborepo app:** `apps/widget/`

```
apps/widget/
  src/
    main.ts           -- Entry: reads data-key attr, initializes widget
    api.ts            -- GET /v1/public/chat/{key} + POST /session
    websocket.ts      -- AWS WebSocket client (?type=visitor&token=...)
    ui.ts             -- DOM manipulation (NO framework -- keep bundle < 50KB)
    storage.ts        -- localStorage: visitor_id, visitor_token, message cache
  vite.config.ts      -- Builds to single widget.js IIFE bundle
  package.json
  tsconfig.json
```

---

## Embed Snippet

Account admins copy this to their website:

```html
<script src="https://chat.turumba.io/widget.js"
        data-key="abc123..."
        data-position="bottom-right">
</script>
```

The `data-key` attribute is the `public_key` from the ChatEndpoint created in the Turumba dashboard. `data-position` is optional (defaults to `bottom-right`).

---

## Lifecycle (End-to-End)

### Phase 1: Widget Initialization (~50-150ms)

1. `main.ts` executes on page load
2. Reads `data-key` from the `<script>` tag's attributes
3. Checks `localStorage` for existing `visitor_id` (returning visitor)
4. Calls `GET /v1/public/chat/{key}` via the KrakenD gateway to get widget config
5. If chat endpoint not found or inactive: widget does NOT render, stop
6. Applies config: colors, position, welcome message, pre-chat form settings
7. Renders the launcher button (floating circle, positioned per config)

### Phase 2: Chat Window Open

8. Visitor clicks the launcher button
9. Chat window expands (animated)
10. If `pre_chat_form.enabled`: show form fields (name, email)
11. Visitor fills in and submits (or skips if no pre-chat form)

### Phase 3: Session Creation (~50-100ms)

12. Widget calls `POST /v1/public/chat/{key}/session`:
    ```json
    {
      "visitor_id": "vs_abc..." or null,
      "name": "Dawit",
      "email": "d@example.com"
    }
    ```
13. Messaging API returns:
    ```json
    {
      "visitor_token": "vt_eyJhbGc...",
      "visitor_id": "vs_abc123",
      "conversation_id": null,
      "ws_url": "wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}"
    }
    ```
14. Widget stores `visitor_id` in `localStorage`

### Phase 4: WebSocket Connection (~60ms)

15. Widget opens WebSocket: `wss://{ws_url}?token={visitor_token}&type=visitor`
16. `$connect` Lambda validates visitor token via Messaging API callback
17. Lambda stores connection in DynamoDB, auto-subscribes to `visitor:{visitor_id}` room
18. Widget shows "Connected" + welcome message

### Phase 5: Messaging

19. Visitor types and sends a message
20. Widget sends: `{ action: "visitor_message", content: "...", content_type: "text" }`
21. Lambda calls `/internal/visitor-message`, gets `{ message_id, conversation_id, created_at, is_new_conversation }`
22. If new conversation: Lambda subscribes visitor to `conv:{conversation_id}` room
23. Lambda sends ACK to visitor: `{ type: "ack", message_id, conversation_id, created_at }`
24. Widget renders message as "sent" on ACK
25. Visitor receives agent replies via `conversation:message` events on the conv room
26. Widget renders agent replies in the chat window

### Phase 6: Token Refresh

27. Widget monitors the `exp` claim in the visitor JWT
28. At ~50 min mark (before 1h expiry): call `POST /session` again with same `visitor_id`
29. Disconnect existing WebSocket
30. Reconnect with new token
31. Lambda re-validates, re-subscribes to rooms
32. ~300ms gap in connectivity

---

## Module Details

### `main.ts` -- Entry Point

```typescript
(function() {
  // Find script tag to read data attributes
  const script = document.currentScript as HTMLScriptElement;
  const publicKey = script?.getAttribute("data-key");
  const position = script?.getAttribute("data-position") || "bottom-right";

  if (!publicKey) return;

  // Initialize widget
  const widget = new TurumbaWidget(publicKey, position);
  widget.init();
})();
```

- Self-executing IIFE
- Reads `data-key` and `data-position` from the `<script>` tag
- Initializes the widget singleton

### `api.ts` -- REST API Calls

```typescript
const API_BASE = "https://api.turumba.io"; // or from data-api-url attribute

export async function fetchWidgetConfig(publicKey: string): Promise<WidgetConfig> {
  const res = await fetch(`${API_BASE}/v1/public/chat/${publicKey}`);
  if (!res.ok) throw new Error("Chat endpoint not found");
  return res.json();
}

export async function createSession(
  publicKey: string,
  data: { visitor_id: string | null; name?: string; email?: string }
): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE}/v1/public/chat/${publicKey}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Session creation failed");
  return res.json();
}
```

Uses native `fetch` -- no Axios dependency.

### `websocket.ts` -- Visitor WebSocket Client

```typescript
class VisitorWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnects = 5;
  private messageQueue: object[] = [];
  private onMessage: (data: any) => void;

  constructor(private getSession: () => Promise<SessionInfo>) {}

  async connect(wsUrl: string, token: string): Promise<void> {
    this.ws = new WebSocket(`${wsUrl}?token=${token}&type=visitor`);
    this.ws.onopen = () => this._onOpen();
    this.ws.onclose = (e) => this._onClose(e);
    this.ws.onmessage = (e) => this._onMessage(e);
  }

  sendMessage(content: string, contentType = "text"): void {
    this._send({ action: "visitor_message", content, content_type: contentType });
  }

  sendTyping(typing: boolean): void {
    this._send({ action: "visitor_typing", typing });
  }

  private async _reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnects) {
      // Show "Connection lost. Please refresh the page."
      return;
    }
    this.reconnectAttempts++;

    // Check if token expired -- if so, get new session first
    const session = await this.getSession();

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 15000);
    setTimeout(() => this.connect(session.ws_url, session.visitor_token), delay);
  }

  // ... _send, _onOpen (flush queue + reset attempts), _onMessage, _onClose
}
```

Key behaviors:
- Connect with visitor token: `wss://{url}?token={visitor_token}&type=visitor`
- Auto-reconnect with exponential backoff: 1s, 2s, 4s, 8s, 15s cap (max 5 retries)
- If token expired before reconnect: call `/session` to get new token first
- Queue outbound messages during reconnection, flush on reconnect
- Handle `ack` events: update message status to "sent"
- Handle `conversation:message` events: render agent replies
- Handle `conversation:typing` events: show/hide typing indicator
- Handle `error` events: show polite error message

### `ui.ts` -- DOM Manipulation

**No React, no framework.** All UI built via `document.createElement`, CSS classes, and event listeners.

Components rendered:
- **Launcher button:** Floating circle with chat icon, positioned per config (bottom-right or bottom-left). Bounce animation on load.
- **Chat window:** Expandable panel (e.g., 380px wide, 520px tall) with header, message list, compose area
- **Header:** Widget name (from config), minimize/close button
- **Welcome message:** First message in chat (from config)
- **Pre-chat form:** Name and email fields (if enabled), submit button
- **Message list:** Scrollable div. Visitor messages right-aligned, agent messages left-aligned. Auto-scroll to bottom on new messages.
- **Compose area:** Input field + send button. Enter to send.
- **Typing indicator:** Animated dots below message list
- **Connection status:** "Connecting...", "Connected", "Connection lost" indicators

**CSS isolation:** Use Shadow DOM to prevent CSS conflicts with the host website. All widget styles are encapsulated inside the shadow root.

```typescript
class WidgetUI {
  private shadow: ShadowRoot;
  private container: HTMLElement;

  constructor(hostElement: HTMLElement) {
    this.shadow = hostElement.attachShadow({ mode: "closed" });
    // Inject styles + DOM into shadow root
  }

  renderLauncher(config: WidgetConfig): void { /* ... */ }
  renderChatWindow(config: WidgetConfig): void { /* ... */ }
  renderPreChatForm(fields: FormField[]): void { /* ... */ }
  appendMessage(message: MessageData): void { /* ... */ }
  showTyping(visible: boolean): void { /* ... */ }
  showConnectionStatus(status: string): void { /* ... */ }
}
```

### `storage.ts` -- localStorage Persistence

```typescript
const STORAGE_PREFIX = "turumba_widget_";

export function getVisitorId(): string | null {
  return localStorage.getItem(`${STORAGE_PREFIX}visitor_id`);
}

export function setVisitorId(id: string): void {
  localStorage.setItem(`${STORAGE_PREFIX}visitor_id`, id);
}

export function getVisitorToken(): string | null {
  return localStorage.getItem(`${STORAGE_PREFIX}visitor_token`);
}

export function setVisitorToken(token: string): void {
  localStorage.setItem(`${STORAGE_PREFIX}visitor_token`, token);
}

export function getCachedMessages(): CachedMessage[] {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}messages`);
  return raw ? JSON.parse(raw) : [];
}

export function setCachedMessages(messages: CachedMessage[]): void {
  // Keep last 50 messages to avoid storage bloat
  const trimmed = messages.slice(-50);
  localStorage.setItem(`${STORAGE_PREFIX}messages`, JSON.stringify(trimmed));
}

export function isTokenExpiringSoon(token: string, bufferMinutes = 10): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const expMs = payload.exp * 1000;
    return Date.now() > expMs - bufferMinutes * 60 * 1000;
  } catch {
    return true;
  }
}
```

Persists across page loads:
- `visitor_id` -- returning visitor identification
- `visitor_token` -- avoid re-creating session on page refresh
- Message cache (last 50 messages) -- show previous messages when reopening widget

---

## Vite Configuration

### `vite.config.ts`

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      name: "TurumbaWidget",
      formats: ["iife"],
      fileName: () => "widget.js",
    },
    outDir: "dist",
    minify: "terser",
    target: "es2020",
    rollupOptions: {
      output: {
        // No code splitting -- single file
        inlineDynamicImports: true,
      },
    },
  },
});
```

- **Output:** Single `widget.js` IIFE bundle
- **No code splitting** -- must be a single file
- **Minified** with Terser
- **Target:** es2020 (broad browser support)
- **No external dependencies** -- fully self-contained

### `package.json`

```json
{
  "name": "@repo/widget",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 4000",
    "build": "vite build",
    "preview": "vite preview --port 4000"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "terser": "^5.0.0",
    "typescript": "^5.0.0"
  }
}
```

### `tsconfig.json`

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

---

## Local Development

```bash
cd turumba_web_core/apps/widget
pnpm dev    # Serves widget.js at http://localhost:4000/widget.js
```

Test by creating a local HTML file:

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Test Page</h1>
  <script src="http://localhost:4000/src/main.ts"
          data-key="your-test-public-key"
          data-position="bottom-right">
  </script>
</body>
</html>
```

In development, `data-key` should match a ChatEndpoint `public_key` created in the local Messaging API.

---

## Tasks

### Project Setup
- [ ] Create `apps/widget/` directory in Turborepo
- [ ] Create `package.json` with Vite + TypeScript dev dependencies
- [ ] Create `tsconfig.json` extending shared config
- [ ] Create `vite.config.ts` with IIFE bundle output config
- [ ] Verify `turbo dev --filter=widget` starts Vite dev server on port 4000
- [ ] Verify `turbo build --filter=widget` produces a single `dist/widget.js` file

### Core Modules
- [ ] Create `src/main.ts` -- IIFE entry, read `data-key` from script tag, initialize widget
- [ ] Create `src/api.ts` -- `fetchWidgetConfig()` + `createSession()` using native `fetch`
- [ ] Create `src/websocket.ts` -- visitor WebSocket client with reconnect + token refresh
- [ ] Create `src/ui.ts` -- all DOM manipulation with Shadow DOM isolation
- [ ] Create `src/storage.ts` -- localStorage for visitor_id, token, message cache

### Widget Lifecycle
- [ ] Implement widget initialization: read config, render launcher button
- [ ] Implement launcher click: expand chat window with animation
- [ ] Implement pre-chat form: collect name/email, submit
- [ ] Implement session creation: `POST /session`, store visitor_id + token
- [ ] Implement WebSocket connection: `wss://...?token={visitor_token}&type=visitor`
- [ ] Implement message sending: `{ action: "visitor_message", content, content_type }`
- [ ] Implement ACK handling: update message status to "sent"
- [ ] Implement receiving agent replies: `conversation:message` events
- [ ] Implement typing indicator: send `visitor_typing`, display agent typing
- [ ] Implement auto-reconnect: exponential backoff (1s, 2s, 4s, 8s, 15s cap, max 5 retries)
- [ ] Implement token refresh: before expiry, call `/session` again, reconnect WebSocket
- [ ] Implement message queue: queue outbound during reconnection, flush on reconnect
- [ ] Implement error handling: `conversation_not_allowed` error, connection failures

### UI
- [ ] Implement Shadow DOM container for CSS isolation
- [ ] Implement launcher button (floating, configurable position, configurable color)
- [ ] Implement chat window (header with name, message list, compose area)
- [ ] Implement message rendering (visitor right, agent left, auto-scroll)
- [ ] Implement typing indicator (animated dots)
- [ ] Implement connection status indicator
- [ ] Implement pre-chat form UI
- [ ] Implement welcome message display

### Persistence
- [ ] Store `visitor_id` in localStorage (returning visitor support)
- [ ] Store `visitor_token` in localStorage (avoid re-session on page refresh)
- [ ] Cache last 50 messages in localStorage
- [ ] Restore cached messages when widget reopens

---

## Acceptance Criteria

- [ ] Widget loads from a single `<script>` tag with `data-key` attribute
- [ ] Widget renders launcher button styled per chat endpoint config (color, position)
- [ ] Widget does NOT render if chat endpoint not found or inactive
- [ ] Pre-chat form collects name/email when enabled
- [ ] Session created with visitor token and WebSocket URL
- [ ] WebSocket connects as visitor (`?type=visitor&token=...`)
- [ ] Visitor can send messages, receives ACK, messages render as "sent"
- [ ] Agent replies appear in real time via WebSocket push
- [ ] Typing indicators work both directions (visitor typing seen by agents, agent typing seen by visitor)
- [ ] Auto-reconnect with exponential backoff on connection loss
- [ ] Token refresh before expiry: new session, reconnect, no disruption
- [ ] Messages queued during reconnection are sent when connection restores
- [ ] Returning visitors identified via localStorage `visitor_id`
- [ ] Message cache restored from localStorage when widget reopens
- [ ] Shadow DOM prevents CSS conflicts with host website
- [ ] **Bundle size under 50KB gzipped**
- [ ] NO React, NO framework -- plain TypeScript + DOM manipulation
- [ ] Works on any website (no assumptions about host page)
- [ ] Builds to a single `widget.js` IIFE file (no code splitting)

---

## Dependencies

- **RT-BE-003** -- ChatEndpoint model + public session API + visitor token signing
- **RT-AWS-001** -- WebSocket API Gateway (visitor `$connect` + `visitor_message` + `visitor_typing` routes)
- **RT-GW-001** -- Gateway routes for `/v1/public/chat/{key}` and `/v1/public/chat/{key}/session`

## Blocks

- None -- this is an end-user facing deliverable.
