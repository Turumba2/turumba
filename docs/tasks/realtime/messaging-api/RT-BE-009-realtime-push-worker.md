# RT-BE-009: Realtime Push Worker + RabbitMQ Topology

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P1 -- Delivers events to connected clients
**Phase:** 3 -- Realtime Infrastructure
**Depends On:** RT-BE-008 (push_to_room utility)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 7.4](../../../TURUMBA_REALTIME_MESSAGING.md#74-realtime_push_worker), [Realtime Push Workflow](../../../realtime/05-REALTIME-PUSH.md)

---

## Summary

Implement the `realtime_push_worker` -- a standalone Python process that consumes conversation events from RabbitMQ and pushes them to connected agent and visitor browsers via the `push_to_room` utility (RT-BE-008). This worker is the **primary delivery mechanism** for non-message events (conversation created, assigned, status changed) and serves as a **backup delivery path** for message events that were already pushed directly.

The worker also declares the new `realtime.events` queue and its bindings on the existing `messaging` RabbitMQ exchange.

---

## Architecture

```
outbox_worker publishes events to RabbitMQ "messaging" exchange
    |
    | routing_key: conversation.*
    v
"realtime.events" queue (durable, DLX: messaging.dlx)
    |
    v
realtime_push_worker (this task)
    |
    v
For each event:
    1. Parse event (extract event_type, account_id, conversation_id, etc.)
    2. Check already_pushed flag:
       - conversation.message.* with already_pushed=true -> ACK and skip
       - Otherwise -> proceed
    3. Determine target rooms by event type
    4. For each room: push_to_room(room, ws_event)
    5. ACK the RabbitMQ message
```

### Two Push Paths

| Path | Trigger | Events | Latency | Role |
|------|---------|--------|---------|------|
| **Direct push** | Agent reply endpoint, visitor message handler | `conversation.message.*` | ~5-15ms | Primary delivery for messages |
| **Worker push** (this task) | RabbitMQ consumption | All `conversation.*` events | ~35-80ms | Primary for non-message events; backup for messages |

The deduplication contract: message events pushed directly carry `already_pushed: true`. The worker checks this flag and skips re-pushing to avoid duplicate delivery. Non-message events (assigned, status_changed, created) always flow through the worker.

---

## Implementation

### File: `src/workers/realtime_push_worker.py`

Follow the same standalone worker pattern as `outbox_worker.py`:
- Top-level `main()` function with signal handlers
- Connect to RabbitMQ on startup
- Declare topology (exchange, queue, bindings)
- Consume messages in a loop
- Graceful shutdown on SIGTERM/SIGINT

### Startup -- RabbitMQ Topology

On startup, declare the following (idempotent -- safe to run multiple times):

```python
async def setup_topology(channel: aio_pika.Channel) -> aio_pika.Queue:
    """Declare the realtime.events queue and bind to conversation routing keys."""

    # Existing exchange (already declared by outbox_worker, but declare is idempotent)
    exchange = await channel.declare_exchange(
        "messaging", aio_pika.ExchangeType.TOPIC, durable=True
    )

    # Existing DLX (idempotent)
    dlx = await channel.declare_exchange(
        "messaging.dlx", aio_pika.ExchangeType.TOPIC, durable=True
    )
    dlq = await channel.declare_queue("messaging.dlq", durable=True)
    await dlq.bind(dlx, routing_key="#")

    # NEW: realtime.events queue
    queue = await channel.declare_queue(
        "realtime.events",
        durable=True,
        arguments={
            "x-dead-letter-exchange": "messaging.dlx",
            "x-dead-letter-routing-key": "realtime.dlq",
        },
    )

    # Bind to all conversation event routing keys
    await queue.bind(exchange, routing_key="conversation.*")
    await queue.bind(exchange, routing_key="conversation.message.*")

    return queue
```

### Processing Loop

```python
async def process_message(
    message: aio_pika.IncomingMessage,
    push_service: RealtimePushService,
) -> None:
    """Process a single RabbitMQ message."""
    async with message.process(requeue=True):
        try:
            payload = json.loads(message.body.decode("utf-8"))
            event_type = message.routing_key or payload.get("event_type", "")

            # Extract fields
            account_id = payload.get("account_id")
            conversation_id = payload.get("conversation_id")
            assignee_id = payload.get("assignee_id")
            already_pushed = payload.get("already_pushed", False)
            is_private = payload.get("is_private", False)

            # DEDUP CHECK: skip message events that were already pushed directly
            if already_pushed and event_type.startswith("conversation.message."):
                logger.debug(
                    "Skipping already-pushed message event: %s (conversation: %s)",
                    event_type, conversation_id,
                )
                return  # ACK via context manager

            # Determine target rooms and build WS event
            rooms = determine_target_rooms(event_type, account_id, conversation_id, assignee_id)
            ws_event = build_ws_event(event_type, payload)

            # Push to each room
            for room in rooms:
                skip_visitors = is_private and room.startswith("conv:")
                await push_service.push_to_room(room, ws_event, skip_visitors=skip_visitors)

        except Exception:
            logger.exception("Failed to process realtime event: %s", message.routing_key)
            raise  # Will NACK and requeue via context manager
```

### Room Routing Logic

```python
def determine_target_rooms(
    event_type: str,
    account_id: str | None,
    conversation_id: str | None,
    assignee_id: str | None,
) -> list[str]:
    """
    Map event type to target WebSocket rooms.

    Returns a list of room identifiers to push the event to.
    """
    rooms: list[str] = []

    if event_type == "conversation.created":
        if account_id:
            rooms.append(f"account:{account_id}")

    elif event_type.startswith("conversation.message."):
        if conversation_id:
            rooms.append(f"conv:{conversation_id}")
        if account_id:
            rooms.append(f"account:{account_id}")

    elif event_type == "conversation.assigned":
        if assignee_id:
            rooms.append(f"user:{assignee_id}")
        if account_id:
            rooms.append(f"account:{account_id}")

    elif event_type in ("conversation.status_changed", "conversation.resolved"):
        if account_id:
            rooms.append(f"account:{account_id}")

    else:
        # Unknown event type -- push to account room as fallback
        if account_id:
            rooms.append(f"account:{account_id}")
        logger.warning("Unknown conversation event type: %s", event_type)

    return rooms
```

### WebSocket Event Payloads

Map internal domain events to client-facing WebSocket event types:

```python
def build_ws_event(event_type: str, payload: dict) -> dict:
    """
    Build the WebSocket event payload for the client.

    Maps internal event types to client-facing event types
    as defined in spec Section 7.5.
    """
    ws_type_map = {
        "conversation.created": "conversation:new",
        "conversation.message.created": "conversation:message",
        "conversation.message.sent": "conversation:message",
        "conversation.assigned": "conversation:updated",
        "conversation.status_changed": "conversation:updated",
        "conversation.resolved": "conversation:updated",
    }

    ws_type = ws_type_map.get(event_type, "conversation:updated")

    # Build client-facing payload (strip internal fields)
    data = {k: v for k, v in payload.items() if k != "already_pushed"}

    return {"type": ws_type, "data": data}
```

### WebSocket Event Reference (from spec Section 7.5)

| Internal Event | WS Event Type | Target Rooms | Payload Fields |
|---|---|---|---|
| `conversation.created` | `conversation:new` | `account:{id}` | `conversation_id, channel_id?, chat_endpoint_id?, contact_identifier, status, created_at` |
| `conversation.message.created` | `conversation:message` | `conv:{id}`, `account:{id}` | `conversation_id, message_id, sender_type, content, is_private, created_at` |
| `conversation.message.sent` | `conversation:message` | `conv:{id}`, `account:{id}` | `conversation_id, message_id, sender_type, content, is_private, created_at` |
| `conversation.assigned` | `conversation:updated` | `user:{assignee_id}`, `account:{id}` | `conversation_id, assignee_id, assigned_by` |
| `conversation.status_changed` | `conversation:updated` | `account:{id}` | `conversation_id, status, previous_status` |
| `conversation.resolved` | `conversation:updated` | `account:{id}` | `conversation_id, resolved_at` |

### Private Message Filtering

For `is_private: true` events pushed to `conv:{id}` rooms:

```python
skip_visitors = is_private and room.startswith("conv:")
await push_service.push_to_room(room, ws_event, skip_visitors=skip_visitors)
```

This passes `skip_visitors=True` to `push_to_room`, which filters out visitor connections (see RT-BE-008). Private notes (internal agent-to-agent notes) are never delivered to visitor WebSocket connections.

### Graceful Shutdown

```python
import signal

async def main():
    loop = asyncio.get_event_loop()
    shutdown_event = asyncio.Event()

    def signal_handler():
        logger.info("Shutdown signal received")
        shutdown_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, signal_handler)

    # Connect to RabbitMQ
    connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
    channel = await connection.channel()
    await channel.set_qos(prefetch_count=10)

    # Initialize push service
    push_service = RealtimePushService(settings)
    await push_service.initialize()

    # Declare topology
    queue = await setup_topology(channel)

    # Start consuming
    async with queue.iterator() as queue_iter:
        async for message in queue_iter:
            if shutdown_event.is_set():
                break
            await process_message(message, push_service)

    await connection.close()
    logger.info("Realtime push worker shut down")
```

### Run Command

```bash
python -m src.workers.realtime_push_worker
```

---

## Configuration

No new environment variables beyond what RT-BE-008 adds. The worker reuses:

- `RABBITMQ_URL` -- existing (from outbox worker)
- `AWS_REGION` -- from RT-BE-008
- `WS_API_GATEWAY_ENDPOINT` -- from RT-BE-008
- `WS_CONNECTIONS_TABLE` -- from RT-BE-008
- `WS_SUBSCRIPTIONS_TABLE` -- from RT-BE-008

### Optional Worker-Specific Config

Add to `src/config/config.py`:

```python
# Realtime Push Worker
REALTIME_WORKER_PREFETCH_COUNT: int = 10    # RabbitMQ prefetch (concurrent messages)
```

---

## Tasks

### 1. Worker File
- [ ] Create `src/workers/realtime_push_worker.py`
- [ ] Follow the same pattern as existing workers (outbox_worker, dispatch_worker)
- [ ] Import `RealtimePushService` from `src/realtime/push` (RT-BE-008)

### 2. RabbitMQ Topology
- [ ] Declare `messaging` exchange (idempotent, topic, durable)
- [ ] Declare `messaging.dlx` / `messaging.dlq` (idempotent)
- [ ] Declare `realtime.events` queue (durable, with dead-letter routing to `messaging.dlx`)
- [ ] Bind `realtime.events` to `conversation.*` and `conversation.message.*` routing keys

### 3. Event Processing
- [ ] Parse incoming RabbitMQ message body as JSON
- [ ] Extract `event_type` from routing key (fallback to payload field)
- [ ] Extract `account_id`, `conversation_id`, `assignee_id`, `already_pushed`, `is_private`
- [ ] Dedup check: if `already_pushed=true` AND `event_type` starts with `conversation.message.` -> ACK and skip
- [ ] Implement `determine_target_rooms()` mapping event types to room lists
- [ ] Implement `build_ws_event()` mapping internal events to client-facing payloads

### 4. Room Routing
- [ ] `conversation.created` -> `["account:{account_id}"]`
- [ ] `conversation.message.*` -> `["conv:{conversation_id}", "account:{account_id}"]`
- [ ] `conversation.assigned` -> `["user:{assignee_id}", "account:{account_id}"]`
- [ ] `conversation.status_changed` -> `["account:{account_id}"]`
- [ ] `conversation.resolved` -> `["account:{account_id}"]`

### 5. Private Message Filtering
- [ ] For events with `is_private=true`, pass `skip_visitors=True` when pushing to `conv:*` rooms
- [ ] Do NOT pass `skip_visitors` for `account:*` or `user:*` rooms (no visitors there)

### 6. Push Execution
- [ ] Call `push_service.push_to_room(room, ws_event, skip_visitors)` for each target room
- [ ] ACK the RabbitMQ message after all pushes complete
- [ ] On processing error: log exception, let context manager NACK with requeue
- [ ] Dead-letter after max redelivery attempts (RabbitMQ default or configured)

### 7. Lifecycle
- [ ] Graceful shutdown on SIGTERM / SIGINT
- [ ] Close RabbitMQ connection on shutdown
- [ ] Log startup, shutdown, and per-event processing (debug level)

### 8. Optional Config
- [ ] Add `REALTIME_WORKER_PREFETCH_COUNT` to `src/config/config.py` (default: 10)

### 9. Unit Tests
- [ ] **Test: determine_target_rooms** -- verify correct room lists for each event type
- [ ] **Test: determine_target_rooms with missing fields** -- verify graceful handling of None values
- [ ] **Test: build_ws_event** -- verify internal event types map to correct WS event types
- [ ] **Test: build_ws_event strips already_pushed** -- verify `already_pushed` field not in client payload
- [ ] **Test: dedup skip** -- mock message with `already_pushed=true` and `conversation.message.sent` routing key, verify `push_to_room` not called
- [ ] **Test: non-message events not skipped** -- mock `conversation.assigned` with `already_pushed=true`, verify push still happens (dedup only applies to message events)
- [ ] **Test: private message filtering** -- mock event with `is_private=true`, verify `skip_visitors=True` passed for `conv:*` room but not for `account:*` room
- [ ] **Test: process_message success** -- mock push_service, verify correct rooms and events pushed
- [ ] **Test: process_message error** -- mock push_service raising exception, verify exception propagates (for NACK)

---

## Acceptance Criteria

- [ ] `realtime_push_worker.py` implemented as a standalone process in `src/workers/`
- [ ] `realtime.events` queue declared on `messaging` exchange with `conversation.*` bindings
- [ ] Dead-letter routing to existing `messaging.dlx` / `messaging.dlq`
- [ ] Events correctly routed to target rooms based on event type
- [ ] `already_pushed` deduplication prevents double-push of message events
- [ ] Private messages (`is_private=true`) filter out visitor connections via `skip_visitors`
- [ ] WebSocket event payloads match spec Section 7.5 format
- [ ] Graceful shutdown on SIGTERM/SIGINT
- [ ] Run via `python -m src.workers.realtime_push_worker`
- [ ] Unit tests passing, Ruff clean, coverage threshold met (80%)

---

## Notes

- This worker should be deployed as its own container/service (per improvement recommendation in `docs/improvements/RECOMMENDATIONS.md`). Different scaling profile from the REST API.
- Add a `realtime_push_worker` service entry to `docker-compose.yml` sharing the same codebase image but with a different command.
- The worker can be scaled horizontally -- multiple instances consuming from the same `realtime.events` queue. RabbitMQ ensures each message is delivered to exactly one consumer.
- `prefetch_count=10` allows processing up to 10 events concurrently. Tune based on load testing.
- The `conversation.message.*` binding pattern matches both `conversation.message.created` and `conversation.message.sent` routing keys.

## Blocks

- **RT-BE-010** (Agent Reply + IM Dispatch) -- emits events that this worker consumes
