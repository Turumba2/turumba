# Workflow 05: Realtime Push Pipeline

How events reach agent and visitor browsers. Two paths: **direct push** (fire-and-forget, < 10ms) for message events, and **worker push** (via RabbitMQ, ~100ms) for non-message events. Both use the same `push_to_room` utility.

**Spec reference:** [TURUMBA_REALTIME_MESSAGING.md — Sections 7.4, 8.1.1](../TURUMBA_REALTIME_MESSAGING.md#74-realtime_push_worker)

---

## Two Push Paths

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         EVENT SOURCES                                   │
│                                                                         │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐       │
│  │ Agent Reply Endpoint │    │ /internal/visitor-message         │       │
│  │ POST /conv/{id}/msgs │    │ (Lambda callback)                │       │
│  └──────────┬───────────┘    └──────────────┬───────────────────┘       │
│             │                               │                           │
│             ▼                               ▼                           │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │              DIRECT PUSH PATH (fire-and-forget)              │       │
│  │              For: conversation.message events                │       │
│  │              Latency: ~5-15ms                                │       │
│  │                                                              │       │
│  │  1. push_to_room("conv:{id}", message_event)       (~5ms)   │       │
│  │  2. push_to_room("account:{id}", updated_event)    (~5ms)   │       │
│  │  3. Return response to caller                               │       │
│  │                                                              │       │
│  │  Background: persist to DB + emit outbox event               │       │
│  │  (event marked with already_pushed: true)                    │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ───────────── Meanwhile, in the background ──────────────              │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │ Outbox → RabbitMQ → realtime_push_worker                     │       │
│  │                                                              │       │
│  │ conversation.message.* with already_pushed: true             │       │
│  │   → Worker SKIPS re-pushing (already delivered)              │       │
│  │   → ACKs the RabbitMQ message                                │       │
│  │   → No duplicate delivery to clients                         │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐       │
│  │ Conversation assigned│    │ Conversation status changed      │       │
│  │ (PATCH /conv/{id})   │    │ (PATCH /conv/{id})               │       │
│  └──────────┬───────────┘    └──────────────┬───────────────────┘       │
│             │                               │                           │
│             ▼                               ▼                           │
│  ┌──────────────────────────────────────────────────────────────┐       │
│  │              WORKER PUSH PATH (via RabbitMQ)                 │       │
│  │              For: non-message events                         │       │
│  │              Latency: ~50-200ms                              │       │
│  │                                                              │       │
│  │  1. DB update + outbox event (no already_pushed flag)        │       │
│  │  2. outbox_worker publishes to RabbitMQ             (~50ms)  │       │
│  │  3. realtime_push_worker consumes                   (~10ms)  │       │
│  │  4. push_to_room(target_rooms, event)               (~5ms)   │       │
│  │  5. ACK RabbitMQ message                                     │       │
│  └──────────────────────────────────────────────────────────────┘       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## `push_to_room` Utility — Detailed Flow

```
push_to_room(room, event_payload, skip_visitors=False)
    │                                                    Timing
    │                                                    ──────
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. QUERY ROOM SUBSCRIBERS                       (~2ms)      │
│                                                             │
│    DynamoDB Query:                                          │
│      Table: ws_subscriptions                                │
│      PK: room = "conv:{conversation_id}"                    │
│      Returns: [                                             │
│        { connection_id: "conn_A", user_id: "agent-1" },    │
│        { connection_id: "conn_B", user_id: "agent-2" },    │
│        { connection_id: "conn_C", user_id: "vs_abc123" }   │
│      ]                                                      │
│                                                             │
│    ├── Empty list → no subscribers, return early            │
│    └── Has subscribers → continue                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. LOOKUP CONNECTION TYPES (if skip_visitors)   (~1ms)      │
│                                                             │
│    Only needed when skip_visitors=True (private messages)   │
│                                                             │
│    DynamoDB BatchGetItem:                                   │
│      Table: ws_connections                                  │
│      Keys: [conn_A, conn_B, conn_C]                         │
│      Returns: [                                             │
│        { connection_id: "conn_A", connection_type: "agent" }│
│        { connection_id: "conn_B", connection_type: "agent" }│
│        { connection_id: "conn_C", connection_type: "visitor"}│
│      ]                                                      │
│                                                             │
│    Filter out visitors for private messages:                │
│    conn_C → SKIP (visitor + is_private)                     │
│    Remaining: [conn_A, conn_B]                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PUSH TO EACH CONNECTION (parallel)           (~2-5ms)    │
│                                                             │
│    For each connection_id:                                  │
│                                                             │
│    POST https://{api-id}.execute-api.{region}                │
│         .amazonaws.com/{stage}/@connections/{connection_id}  │
│    Body: JSON(event_payload)                                │
│                                                             │
│    ┌─────────────────────────────────────────────────┐      │
│    │ conn_A (agent-1):                               │      │
│    │   ├── 200 OK → delivered                       │      │
│    │   ├── 410 GoneException → stale connection     │      │
│    │   │   → cleanup (step 4)                       │      │
│    │   └── 5xx/timeout → log, skip, don't block     │      │
│    │                                                 │      │
│    │ conn_B (agent-2):                               │      │
│    │   ├── 200 OK → delivered                       │      │
│    │   └── ...                                       │      │
│    │                                                 │      │
│    │ conn_C (visitor, if not skipped):               │      │
│    │   ├── 200 OK → visitor sees message            │      │
│    │   └── ...                                       │      │
│    └─────────────────────────────────────────────────┘      │
│                                                             │
│    Connections are pushed in parallel (asyncio.gather)       │
│    Total time ≈ max(individual push times)                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼ (only on 410 GoneException)
┌─────────────────────────────────────────────────────────────┐
│ 4. CLEANUP STALE CONNECTIONS                    (~3ms)      │
│                                                             │
│    For each 410 response:                                   │
│                                                             │
│    a. Query ws_subscriptions by connection_id-index:         │
│       Get all rooms this connection was subscribed to        │
│                                                             │
│    b. Batch delete from ws_subscriptions                     │
│       (all room memberships for this connection)            │
│                                                             │
│    c. Delete from ws_connections                             │
│       (remove the connection record)                        │
│                                                             │
│    d. If agent connection: update ws_presence                │
│       (decrement connection_count, set offline if 0)        │
│                                                             │
│    This is fire-and-forget — cleanup failures are logged    │
│    but don't affect the push operation.                     │
└─────────────────────────────────────────────────────────────┘
```

---

## `realtime_push_worker` — Detailed Flow

```
Worker: turumba_messaging_api/src/workers/realtime_push_worker.py
Queue:  "realtime.events" on "messaging" exchange
Bindings: conversation.* routing keys

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  While True:                                                            │
│    message = consume from "realtime.events" queue                       │
│    │                                                        Timing     │
│    ▼                                                        ──────     │
│  ┌─────────────────────────────────────────────────────┐               │
│  │ 1. PARSE EVENT                           (~0.1ms)   │               │
│  │                                                     │               │
│  │    event_type = message.routing_key                 │               │
│  │    payload = JSON.parse(message.body)               │               │
│  │                                                     │               │
│  │    Extract: account_id, conversation_id,            │               │
│  │             assignee_id, already_pushed             │               │
│  └──────────────────────┬──────────────────────────────┘               │
│                         │                                              │
│                         ▼                                              │
│  ┌─────────────────────────────────────────────────────┐               │
│  │ 2. CHECK DEDUP FLAG                      (~0.1ms)   │               │
│  │                                                     │               │
│  │    if already_pushed AND event_type is              │               │
│  │       conversation.message.*:                       │               │
│  │                                                     │               │
│  │      → SKIP push (already delivered via direct path)│               │
│  │      → ACK the RabbitMQ message                     │               │
│  │      → continue to next message                     │               │
│  │                                                     │               │
│  │    else:                                            │               │
│  │      → proceed to push                              │               │
│  └──────────────────────┬──────────────────────────────┘               │
│                         │                                              │
│                    Not already pushed                                   │
│                         │                                              │
│                         ▼                                              │
│  ┌─────────────────────────────────────────────────────┐               │
│  │ 3. DETERMINE TARGET ROOMS                (~0.1ms)   │               │
│  │                                                     │               │
│  │    Event Type                → Target Rooms         │               │
│  │    ─────────────────────────────────────────────    │               │
│  │    conversation.created      → [account:{id}]       │               │
│  │                                                     │               │
│  │    conversation.message.*    → [conv:{id},           │               │
│  │                                 account:{id}]       │               │
│  │                                                     │               │
│  │    conversation.assigned     → [user:{assignee},     │               │
│  │                                 account:{id}]       │               │
│  │                                                     │               │
│  │    conversation.status_changed → [account:{id}]      │               │
│  │                                                     │               │
│  │    conversation.resolved     → [account:{id}]        │               │
│  └──────────────────────┬──────────────────────────────┘               │
│                         │                                              │
│                         ▼                                              │
│  ┌─────────────────────────────────────────────────────┐               │
│  │ 4. PUSH TO ROOMS                        (~5-15ms)   │               │
│  │                                                     │               │
│  │    For each target room:                            │               │
│  │      push_to_room(room, event_payload)              │               │
│  │      (see push_to_room flow above)                  │               │
│  │                                                     │               │
│  │    Private message filtering:                       │               │
│  │      If event has is_private: true AND room         │               │
│  │      is conv:{id} → pass skip_visitors=True         │               │
│  └──────────────────────┬──────────────────────────────┘               │
│                         │                                              │
│                         ▼                                              │
│  ┌─────────────────────────────────────────────────────┐               │
│  │ 5. ACK MESSAGE                           (~0.1ms)   │               │
│  │                                                     │               │
│  │    channel.basic_ack(delivery_tag)                   │               │
│  └─────────────────────────────────────────────────────┘               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Room Types and Their Purpose

```
┌─────────────────────────────────────────────────────────────┐
│ Room: "account:{account_id}"                                │
│ Subscribers: All agents with this account_id                │
│ Auto-joined: On agent WebSocket $connect                    │
│                                                             │
│ Events received:                                            │
│ ├── conversation:new        (new conversation in inbox)     │
│ ├── conversation:updated    (status, assignee, priority)    │
│ ├── conversation:message    (inbox sort order update)       │
│ └── agent:presence          (who's online)                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Room: "conv:{conversation_id}"                              │
│ Subscribers: Agents viewing this thread + visitor (webchat) │
│ Joined: Agent subscribes when opening conversation          │
│         Visitor auto-subscribed on first message            │
│                                                             │
│ Events received:                                            │
│ ├── conversation:message    (live message in thread)        │
│ ├── conversation:typing     (typing indicators)             │
│ └── conversation:updated    (status changes)                │
│                                                             │
│ Private note filtering:                                     │
│   is_private messages → visitor connections SKIPPED          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Room: "user:{user_id}"                                      │
│ Subscribers: All connections for this agent                 │
│ Auto-joined: On agent WebSocket $connect                    │
│                                                             │
│ Events received:                                            │
│ └── notification:assignment (you've been assigned a conv)   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Room: "visitor:{visitor_id}"                                │
│ Subscribers: Visitor's WebSocket connection                 │
│ Auto-joined: On visitor WebSocket $connect                  │
│                                                             │
│ Events received:                                            │
│ ├── system messages (token refresh notices)                 │
│ └── NOT used for conversation messages                      │
│     (those flow through conv:{id} room)                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Timing Summary

### Direct Push (message events)

| Step | Time | Cumulative |
|------|------|------------|
| Generate message_id + build event | 0.1ms | 0.1ms |
| push_to_room: DynamoDB query (subscribers) | 2ms | 2.1ms |
| push_to_room: DynamoDB batch get (connection types) | 1ms | 3.1ms |
| push_to_room: @connections POST (parallel) | 2-5ms | 5-8ms |
| **Total: event visible to recipients** | | **5-8ms** |

### Worker Push (non-message events)

| Step | Time | Cumulative |
|------|------|------------|
| DB commit + outbox write | 10ms | 10ms |
| outbox_worker polls / pg_notify wake | 10-50ms | 20-60ms |
| outbox_worker publishes to RabbitMQ | 5ms | 25-65ms |
| realtime_push_worker consumes | 5ms | 30-70ms |
| push_to_room (same as above) | 5-8ms | 35-78ms |
| **Total: event visible to recipients** | | **35-80ms** |

---

## Infrastructure Requirements

The `push_to_room` utility runs in the Messaging API process. It needs:

| Resource | Access Type | Used For |
|----------|------------|----------|
| DynamoDB `ws_subscriptions` | Query (PK: room) | Find who's in a room |
| DynamoDB `ws_connections` | BatchGetItem (PK: connection_id) | Get connection_type for filtering |
| API Gateway Management API | POST @connections/{id} | Deliver event payload |

**Environment variables:**

```
AWS_REGION=us-east-1
WS_API_GATEWAY_ENDPOINT=https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
WS_CONNECTIONS_TABLE=ws_connections
WS_SUBSCRIPTIONS_TABLE=ws_subscriptions
```

AWS credentials via IAM role (production) or access keys (local dev).

---

## Deduplication Contract

```
Event emitted with already_pushed: true
    │
    ├── realtime_push_worker:
    │   Check flag → skip WS push → ACK
    │   (event still processed for any other consumers)
    │
    └── Client-side (frontend):
        Receives event with already_pushed: true
        Dedup by message_id → already rendered → skip
```

Both server-side (worker) and client-side deduplication prevent double delivery. The `message_id` is the dedup key across the entire pipeline.
