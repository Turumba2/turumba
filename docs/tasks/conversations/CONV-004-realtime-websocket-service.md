# CONV-004: Real-Time WebSocket Service (turumba_realtime)

**Type:** Backend (New Service)
**Service:** turumba_realtime (NEW — Node.js)
**Priority:** P1 — Required for live agent inbox experience
**Feature Area:** Customer Support — Real-Time Communication
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md)

---

## Summary

Build `turumba_realtime` — a standalone Node.js service that bridges domain events from RabbitMQ to connected browser clients via Socket.IO WebSockets. This service is a **pure event relay** with authentication and room management. It handles no business logic, stores no data in a database, and exposes no REST API.

**What it does:**
1. Consumes conversation/message/agent events from RabbitMQ
2. Routes events to the correct Socket.IO rooms (per-account, per-conversation, per-user)
3. Manages agent presence (online/away/offline) via Redis
4. Relays typing indicators between agents in the same conversation
5. Validates Cognito JWT on WebSocket connection handshake

**What it does NOT do:**
- Process or store messages
- Make routing decisions
- Call other APIs
- Handle any business logic

**Tech Stack:**
- Node.js (>= 20 LTS)
- Socket.IO 4.x (WebSocket server with room/namespace management)
- amqplib (RabbitMQ client)
- ioredis (Redis client for Socket.IO adapter + presence)
- jsonwebtoken + jwks-rsa (Cognito JWT validation)
- TypeScript

---

## Part 1: Project Structure

### Repository: `turumba_realtime`

```
turumba_realtime/
├── src/
│   ├── index.ts                 # Entry point — start server
│   ├── config.ts                # Environment variables
│   ├── server.ts                # HTTP + Socket.IO server setup
│   ├── auth/
│   │   └── jwt.ts               # Cognito JWT validation middleware
│   ├── rabbitmq/
│   │   ├── connection.ts        # RabbitMQ connection with reconnect
│   │   ├── consumer.ts          # Message consumer setup
│   │   └── handlers.ts          # Event handlers (route to Socket.IO rooms)
│   ├── redis/
│   │   ├── client.ts            # Redis connection
│   │   └── presence.ts          # Agent presence tracking
│   ├── socket/
│   │   ├── namespaces.ts        # Socket.IO namespace configuration
│   │   ├── agent-handlers.ts    # /agents namespace event handlers
│   │   └── customer-handlers.ts # /customers namespace event handlers (future)
│   └── types/
│       └── events.ts            # Shared event type definitions
├── Dockerfile
├── docker-compose.yml           # For standalone dev
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Dependencies (`package.json`)

```json
{
  "name": "turumba_realtime",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "lint": "eslint src/",
    "format": "prettier --write src/"
  },
  "dependencies": {
    "socket.io": "^4.7.0",
    "@socket.io/redis-adapter": "^8.3.0",
    "amqplib": "^0.10.0",
    "ioredis": "^5.4.0",
    "jsonwebtoken": "^9.0.0",
    "jwks-rsa": "^3.1.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.0.0",
    "@types/node": "^20.0.0",
    "@types/amqplib": "^0.10.0",
    "@types/jsonwebtoken": "^9.0.0",
    "eslint": "^9.0.0",
    "prettier": "^3.0.0"
  }
}
```

---

## Part 2: Configuration (`src/config.ts`)

```typescript
export const config = {
  port: parseInt(process.env.PORT || "3200"),
  rabbitmq: {
    url: process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672",
    exchange: "messaging",
    queues: {
      realtime: "realtime.events",
    },
    bindings: [
      "conversation.created",
      "conversation.assigned",
      "conversation.status_changed",
      "conversation.resolved",
      "conversation.routed",
      "conversation.message.created",
      "conversation.message.sent",
      "agent.presence.*",
    ],
  },
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
    presenceTtlSeconds: 60,
    typingTtlSeconds: 5,
  },
  auth: {
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID || "",
    awsRegion: process.env.AWS_REGION || "us-east-1",
    jwksUri: "", // Computed from pool ID + region
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || "http://localhost:3600,http://localhost:3500").split(","),
  },
};

// Compute JWKS URI
config.auth.jwksUri =
  `https://cognito-idp.${config.auth.awsRegion}.amazonaws.com/${config.auth.cognitoUserPoolId}/.well-known/jwks.json`;
```

### Environment Variables (`.env.example`)

```
PORT=3200
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
REDIS_URL=redis://redis:6379
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
AWS_REGION=us-east-1
CORS_ORIGINS=http://localhost:3600,http://localhost:3500
```

---

## Part 3: Auth Middleware (`src/auth/jwt.ts`)

```typescript
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { config } from "../config";

const client = jwksClient({ jwksUri: config.auth.jwksUri, cache: true, rateLimit: true });

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    callback(err, key?.getPublicKey());
  });
}

export interface TokenPayload {
  sub: string;           // Cognito user ID
  email: string;
  "custom:account_ids"?: string;  // Comma-separated account IDs (if set as custom claim)
}

export function verifyToken(token: string): Promise<TokenPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ["RS256"] }, (err, decoded) => {
      if (err) return reject(err);
      resolve(decoded as TokenPayload);
    });
  });
}
```

### Socket.IO Connection Auth

```typescript
// In src/socket/namespaces.ts
io.of("/agents").use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace("Bearer ", "");
    if (!token) return next(new Error("Authentication required"));

    const payload = await verifyToken(token);
    socket.data.userId = payload.sub;
    socket.data.email = payload.email;
    socket.data.accountIds = payload["custom:account_ids"]?.split(",") || [];
    next();
  } catch (err) {
    next(new Error("Invalid token"));
  }
});
```

---

## Part 4: RabbitMQ Consumer (`src/rabbitmq/`)

### Connection (`src/rabbitmq/connection.ts`)

```typescript
import amqplib, { Connection, Channel } from "amqplib";
import { config } from "../config";

let connection: Connection;
let channel: Channel;

export async function connectRabbitMQ(): Promise<Channel> {
  connection = await amqplib.connect(config.rabbitmq.url);
  channel = await connection.createChannel();

  // Assert exchange
  await channel.assertExchange(config.rabbitmq.exchange, "topic", { durable: true });

  // Assert realtime queue
  await channel.assertQueue(config.rabbitmq.queues.realtime, { durable: true });

  // Bind all event patterns
  for (const binding of config.rabbitmq.bindings) {
    await channel.bindQueue(config.rabbitmq.queues.realtime, config.rabbitmq.exchange, binding);
  }

  // Handle connection loss
  connection.on("close", () => {
    console.error("RabbitMQ connection lost, reconnecting...");
    setTimeout(connectRabbitMQ, 5000);
  });

  return channel;
}
```

### Event Handlers (`src/rabbitmq/handlers.ts`)

```typescript
import { Channel, ConsumeMessage } from "amqplib";
import { Server } from "socket.io";
import { updatePresence } from "../redis/presence";

export function setupConsumer(channel: Channel, io: Server) {
  channel.consume("realtime.events", async (msg: ConsumeMessage | null) => {
    if (!msg) return;

    try {
      const event = JSON.parse(msg.content.toString());
      const routingKey = msg.fields.routingKey;
      await routeEvent(io, routingKey, event);
      channel.ack(msg);
    } catch (err) {
      console.error("Failed to process event:", err);
      channel.nack(msg, false, false); // Dead-letter on parse failure
    }
  });
}

async function routeEvent(io: Server, routingKey: string, event: any) {
  const agents = io.of("/agents");
  const accountRoom = `account:${event.account_id}`;

  switch (routingKey) {
    case "conversation.created":
      agents.to(accountRoom).emit("conversation:new", {
        conversation_id: event.conversation_id,
        channel_id: event.channel_id,
        contact_identifier: event.contact_identifier,
        status: event.status,
        created_at: event.created_at,
      });
      break;

    case "conversation.message.created":
    case "conversation.message.sent":
      // Push to all agents viewing this conversation
      agents.to(`conv:${event.conversation_id}`).emit("conversation:message", {
        conversation_id: event.conversation_id,
        message_id: event.message_id,
        sender_type: event.sender_type,
        message_body: event.message_body,
        is_private: event.is_private,
        created_at: event.created_at,
      });
      // Also update inbox list for the account
      agents.to(accountRoom).emit("conversation:updated", {
        conversation_id: event.conversation_id,
        last_message_at: event.created_at,
      });
      break;

    case "conversation.assigned":
      // Notify the assigned agent
      if (event.assignee_id) {
        agents.to(`user:${event.assignee_id}`).emit("notification:assignment", {
          conversation_id: event.conversation_id,
          assigned_by: event.assigned_by,
          rule_name: event.rule_name,
        });
      }
      // Update inbox for all agents in the account
      agents.to(accountRoom).emit("conversation:updated", {
        conversation_id: event.conversation_id,
        assignee_id: event.assignee_id,
        status: event.status,
      });
      break;

    case "conversation.status_changed":
    case "conversation.resolved":
    case "conversation.routed":
      agents.to(accountRoom).emit("conversation:updated", {
        conversation_id: event.conversation_id,
        status: event.status,
        assignee_id: event.assignee_id,
        labels: event.labels,
        priority: event.priority,
      });
      break;

    default:
      if (routingKey.startsWith("agent.presence.")) {
        agents.to(accountRoom).emit("agent:presence", {
          user_id: event.user_id,
          status: event.status,
        });
      }
      break;
  }
}
```

---

## Part 5: Socket.IO Server (`src/socket/`)

### Namespace Configuration (`src/socket/namespaces.ts`)

```typescript
import { Server } from "socket.io";
import { verifyToken } from "../auth/jwt";
import { setPresence, removePresence } from "../redis/presence";

export function setupAgentNamespace(io: Server) {
  const agents = io.of("/agents");

  // Auth middleware
  agents.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error("Authentication required"));
      const payload = await verifyToken(token);
      socket.data.userId = payload.sub;
      socket.data.email = payload.email;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  agents.on("connection", async (socket) => {
    const userId = socket.data.userId;

    // Join user-specific room (for direct notifications)
    socket.join(`user:${userId}`);

    // Join account rooms (agent sees all conversations in their accounts)
    // Account IDs come from the token or a subsequent "subscribe" event
    // For MVP, the client sends account_id after connection
    socket.on("account:subscribe", (data: { account_id: string }) => {
      socket.join(`account:${data.account_id}`);
    });

    // Join conversation room (agent opens a conversation)
    socket.on("conversation:join", (data: { conversation_id: string }) => {
      socket.join(`conv:${data.conversation_id}`);
    });

    // Leave conversation room
    socket.on("conversation:leave", (data: { conversation_id: string }) => {
      socket.leave(`conv:${data.conversation_id}`);
    });

    // Typing indicators
    socket.on("conversation:typing:start", (data: { conversation_id: string }) => {
      socket.to(`conv:${data.conversation_id}`).emit("conversation:typing", {
        user_id: userId,
        typing: true,
      });
    });

    socket.on("conversation:typing:stop", (data: { conversation_id: string }) => {
      socket.to(`conv:${data.conversation_id}`).emit("conversation:typing", {
        user_id: userId,
        typing: false,
      });
    });

    // Agent presence
    socket.on("agent:status", async (data: { status: "online" | "away" | "offline" }) => {
      await setPresence(userId, data.status);
      // Broadcast to all account rooms this agent belongs to
      for (const room of socket.rooms) {
        if (room.startsWith("account:")) {
          socket.to(room).emit("agent:presence", { user_id: userId, status: data.status });
        }
      }
    });

    // Set initial presence
    await setPresence(userId, "online");

    // Clean up on disconnect
    socket.on("disconnect", async () => {
      await removePresence(userId);
      // Broadcast offline to account rooms
      for (const room of socket.rooms) {
        if (room.startsWith("account:")) {
          socket.to(room).emit("agent:presence", { user_id: userId, status: "offline" });
        }
      }
    });
  });
}
```

---

## Part 6: Redis Presence (`src/redis/`)

### Client (`src/redis/client.ts`)

```typescript
import Redis from "ioredis";
import { config } from "../config";

export const redis = new Redis(config.redis.url);
```

### Presence Tracking (`src/redis/presence.ts`)

```typescript
import { redis } from "./client";
import { config } from "../config";

const PRESENCE_KEY = "agent:presence";

export async function setPresence(userId: string, status: string): Promise<void> {
  await redis.hset(PRESENCE_KEY, userId, JSON.stringify({
    status,
    last_seen: new Date().toISOString(),
  }));
  // Set TTL on the individual field using a separate key for heartbeat
  await redis.set(`agent:heartbeat:${userId}`, "1", "EX", config.redis.presenceTtlSeconds);
}

export async function removePresence(userId: string): Promise<void> {
  await redis.hdel(PRESENCE_KEY, userId);
  await redis.del(`agent:heartbeat:${userId}`);
}

export async function getPresence(userId: string): Promise<string | null> {
  const data = await redis.hget(PRESENCE_KEY, userId);
  if (!data) return null;
  return JSON.parse(data).status;
}

export async function getAllPresence(): Promise<Record<string, string>> {
  const all = await redis.hgetall(PRESENCE_KEY);
  const result: Record<string, string> = {};
  for (const [userId, data] of Object.entries(all)) {
    result[userId] = JSON.parse(data).status;
  }
  return result;
}
```

---

## Part 7: Entry Point (`src/index.ts`)

```typescript
import { createServer } from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { redis } from "./redis/client";
import { connectRabbitMQ } from "./rabbitmq/connection";
import { setupConsumer } from "./rabbitmq/handlers";
import { setupAgentNamespace } from "./socket/namespaces";
import { config } from "./config";
import Redis from "ioredis";

async function main() {
  // HTTP server (Socket.IO attaches to this)
  const httpServer = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // Socket.IO with Redis adapter for horizontal scaling
  const io = new Server(httpServer, {
    cors: {
      origin: config.cors.origins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Redis adapter (Pub/Sub for multi-instance sync)
  const pubClient = new Redis(config.redis.url);
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  // Setup Socket.IO namespaces
  setupAgentNamespace(io);

  // Connect to RabbitMQ and start consuming
  const channel = await connectRabbitMQ();
  setupConsumer(channel, io);

  // Start server
  httpServer.listen(config.port, () => {
    console.log(`turumba_realtime listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
```

---

## Part 8: Docker

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3200
CMD ["node", "dist/index.js"]
```

### Docker Compose Integration (add to `turumba_gateway/docker-compose.yml`)

```yaml
turumba_realtime:
  image: turumba_realtime:latest
  platform: linux/amd64
  ports:
    - "3200:3200"
  environment:
    - RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
    - REDIS_URL=redis://redis:6379
    - COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID}
    - AWS_REGION=${AWS_REGION}
    - CORS_ORIGINS=http://localhost:3600,http://localhost:3500,http://localhost:3000
    - PORT=3200
  networks:
    - gateway-network
  depends_on:
    - rabbitmq
    - redis
```

If Redis is not yet in docker-compose, add:

```yaml
redis:
  image: redis:7-alpine
  platform: linux/amd64
  ports:
    - "6379:6379"
  networks:
    - gateway-network
  volumes:
    - redis_data:/data
```

---

## Part 9: Socket.IO Client Events Reference

### Events: Server → Client (Push)

| Event | Room | Payload | Description |
|---|---|---|---|
| `conversation:new` | `account:{id}` | `{ conversation_id, channel_id, contact_identifier, status, created_at }` | New conversation opened |
| `conversation:updated` | `account:{id}` + `conv:{id}` | `{ conversation_id, status?, assignee_id?, labels?, priority?, last_message_at? }` | Conversation state changed |
| `conversation:message` | `conv:{id}` | `{ conversation_id, message_id, sender_type, message_body, is_private, created_at }` | New message in conversation |
| `conversation:typing` | `conv:{id}` | `{ user_id, typing: bool }` | Typing indicator |
| `agent:presence` | `account:{id}` | `{ user_id, status: "online"/"away"/"offline" }` | Agent presence changed |
| `notification:assignment` | `user:{assignee_id}` | `{ conversation_id, assigned_by, rule_name? }` | Agent assigned to conversation |
| `queue:update` | `account:{id}` | `{ unassigned_count, oldest_waiting_seconds }` | Queue stats updated |

### Events: Client → Server (Actions)

| Event | Payload | Effect |
|---|---|---|
| `account:subscribe` | `{ account_id }` | Join account room to receive inbox updates |
| `conversation:join` | `{ conversation_id }` | Join conversation room for live messages |
| `conversation:leave` | `{ conversation_id }` | Leave conversation room |
| `conversation:typing:start` | `{ conversation_id }` | Broadcast typing indicator to others in room |
| `conversation:typing:stop` | `{ conversation_id }` | Stop typing indicator |
| `agent:status` | `{ status: "online"/"away"/"offline" }` | Set own presence |

### Client Connection Example (Frontend)

```typescript
import { io } from "socket.io-client";

const socket = io("http://localhost:3200/agents", {
  auth: { token: cognitoJwtToken },
  transports: ["websocket"],
});

// Subscribe to account
socket.emit("account:subscribe", { account_id: currentAccountId });

// Listen for new conversations
socket.on("conversation:new", (data) => {
  // Add to inbox list
});

// Listen for messages in current conversation
socket.on("conversation:message", (data) => {
  // Append to message thread
});

// Listen for assignment notifications
socket.on("notification:assignment", (data) => {
  // Show toast notification
});

// Join a specific conversation
socket.emit("conversation:join", { conversation_id: "..." });

// Send typing indicator
socket.emit("conversation:typing:start", { conversation_id: "..." });
```

---

## Tasks

### 1. Project Setup
- [ ] Create `turumba_realtime` repository
- [ ] Initialize Node.js project with TypeScript
- [ ] Configure `package.json` with all dependencies
- [ ] Configure `tsconfig.json`
- [ ] Create `.env.example`
- [ ] Create `Dockerfile`
- [ ] Create `README.md` with setup and architecture overview

### 2. Configuration
- [ ] Create `src/config.ts` with all environment variables
- [ ] Compute JWKS URI from Cognito pool ID + region

### 3. Auth Middleware
- [ ] Create `src/auth/jwt.ts`
- [ ] Implement Cognito JWT validation with JWKS key fetching
- [ ] Cache JWKS keys (via jwks-rsa built-in cache)
- [ ] Extract `sub`, `email`, account IDs from token
- [ ] Return clear error messages for missing/invalid tokens

### 4. Redis Layer
- [ ] Create `src/redis/client.ts` — Redis connection
- [ ] Create `src/redis/presence.ts` — presence tracking functions
- [ ] `setPresence(userId, status)` — HSET with heartbeat TTL
- [ ] `removePresence(userId)` — cleanup on disconnect
- [ ] `getPresence(userId)` — get single agent status
- [ ] `getAllPresence()` — get all agents (for initial load)

### 5. RabbitMQ Consumer
- [ ] Create `src/rabbitmq/connection.ts` — connect with auto-reconnect
- [ ] Assert `messaging` exchange (topic, durable)
- [ ] Assert `realtime.events` queue (durable)
- [ ] Bind all conversation/message/agent event patterns
- [ ] Create `src/rabbitmq/handlers.ts` — event routing logic
- [ ] Route `conversation.created` → `account:{id}` room
- [ ] Route `conversation.message.*` → `conv:{id}` + `account:{id}` rooms
- [ ] Route `conversation.assigned` → `user:{id}` + `account:{id}` rooms
- [ ] Route `conversation.status_changed` → `account:{id}` room
- [ ] Route `conversation.resolved` → `account:{id}` room
- [ ] Route `agent.presence.*` → `account:{id}` room
- [ ] ACK messages after processing, NACK on parse failure

### 6. Socket.IO Server
- [ ] Create `src/server.ts` — HTTP server + Socket.IO setup
- [ ] Configure CORS for allowed origins
- [ ] Configure Redis adapter for horizontal scaling
- [ ] Create `src/socket/namespaces.ts` — `/agents` namespace
- [ ] Auth middleware on connection (validate JWT)
- [ ] `account:subscribe` — join account room
- [ ] `conversation:join` / `conversation:leave` — room management
- [ ] `conversation:typing:start` / `conversation:typing:stop` — relay typing
- [ ] `agent:status` — set presence + broadcast
- [ ] Auto-set presence to "online" on connect
- [ ] Auto-set presence to "offline" on disconnect
- [ ] Health check endpoint at `/health`

### 7. Entry Point
- [ ] Create `src/index.ts` — orchestrate startup (Redis → RabbitMQ → Socket.IO → listen)
- [ ] Graceful shutdown on SIGTERM/SIGINT

### 8. Docker Integration
- [ ] Multi-stage Dockerfile (builder + runtime)
- [ ] Add `turumba_realtime` service to gateway's `docker-compose.yml`
- [ ] Add Redis service to `docker-compose.yml` (if not already present)
- [ ] Verify service starts and connects to RabbitMQ + Redis

### 9. Tests
- [ ] JWT validation: valid token accepted
- [ ] JWT validation: expired token rejected
- [ ] JWT validation: missing token rejected
- [ ] Socket.IO: connection with valid auth succeeds
- [ ] Socket.IO: connection without auth rejected
- [ ] Socket.IO: `account:subscribe` joins correct room
- [ ] Socket.IO: `conversation:join` / `leave` works
- [ ] Socket.IO: typing indicators relayed to room members
- [ ] Socket.IO: `agent:status` updates presence in Redis
- [ ] Socket.IO: disconnect removes presence
- [ ] RabbitMQ: `conversation.created` event routed to account room
- [ ] RabbitMQ: `conversation.message.created` routed to conv + account rooms
- [ ] RabbitMQ: `conversation.assigned` routed to user + account rooms
- [ ] RabbitMQ: malformed message NACKed (not re-queued)
- [ ] Redis: presence set and retrieved correctly
- [ ] Redis: presence removed on cleanup
- [ ] Health endpoint returns 200

---

## Acceptance Criteria

- [ ] New `turumba_realtime` service repository created with TypeScript + Socket.IO
- [ ] Cognito JWT validation on WebSocket connection handshake
- [ ] Socket.IO `/agents` namespace with room management
- [ ] RabbitMQ consumer processes all conversation/message/agent events
- [ ] Events correctly routed to account, conversation, and user rooms
- [ ] Agent presence tracked via Redis with heartbeat TTL
- [ ] Typing indicators relayed between agents in same conversation
- [ ] Redis adapter enables horizontal scaling (multi-instance)
- [ ] Docker image builds and runs in the gateway Docker Compose stack
- [ ] Health check endpoint at `/health` returns 200
- [ ] Graceful shutdown (close connections on SIGTERM)
- [ ] All tests passing, ESLint clean

---

## Dependencies

- **CONV-001** — Defines the conversation event types consumed by this service
- **RabbitMQ** — must be running (already in gateway docker-compose)
- **Redis** — must be added to docker-compose if not already present
- **AWS Cognito** — for JWT validation (same pool as Account API)

## Blocks

- Frontend Socket.IO client integration (agent inbox, conversation thread, notifications)
