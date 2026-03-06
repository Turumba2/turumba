# CONV-BE-006: Realtime Push Worker + RabbitMQ Topology

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P1 — Required for real-time push to agents
**Phase:** 3 — Real-Time Infrastructure
**Architecture Reference:** [Conversation Architecture](../../plans/conversations/ARCHITECTURE.md) §5.5

---

## Summary

Create a new Python worker (`realtime_push_worker`) that bridges RabbitMQ conversation events to connected WebSocket clients via the AWS API Gateway Management API. The worker follows the exact same pattern as existing workers (`dispatch_worker`, `inbound_message_worker`, etc.) — it consumes from a dedicated RabbitMQ queue, queries DynamoDB for room subscribers, and pushes events to their WebSocket connections.

---

## Part 1: RabbitMQ Topology

### New Queue

Add `realtime.events` queue to the RabbitMQ topology (in `src/events/rabbitmq.py` or equivalent):

```python
REALTIME_QUEUE = "realtime.events"

# Bindings on the "messaging" topic exchange
REALTIME_BINDINGS = [
    "conversation.created",
    "conversation.assigned",
    "conversation.status_changed",
    "conversation.resolved",
    "conversation.message.created",
    "conversation.message.sent",
]
```

The queue is durable. Messages are ACKed after successful processing.

---

## Part 2: realtime_push_worker

### File: `src/workers/realtime_push_worker.py`

```python
"""
Realtime Push Worker

Consumes conversation events from RabbitMQ and pushes them to
connected WebSocket clients via AWS API Gateway Management API.

Usage:
    python -m src.workers.realtime_push_worker
"""

class RealtimePushWorker:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb")
        self.connections_table = self.dynamodb.Table(settings.WS_CONNECTIONS_TABLE)
        self.subscriptions_table = self.dynamodb.Table(settings.WS_SUBSCRIPTIONS_TABLE)
        self.api_gw = boto3.client(
            "apigatewaymanagementapi",
            endpoint_url=settings.WS_API_ENDPOINT,
        )

    async def process_event(self, routing_key: str, payload: dict):
        """Route an event to the correct WebSocket rooms."""
        rooms = self._determine_rooms(routing_key, payload)
        event_type = self._routing_key_to_event_type(routing_key)
        message = json.dumps({"type": event_type, "data": payload})

        for room in rooms:
            connections = self._get_room_connections(room)
            for conn_id in connections:
                self._push_to_connection(conn_id, message)

    def _determine_rooms(self, routing_key: str, payload: dict) -> list[str]:
        """Map routing key to target rooms."""
        account_id = payload.get("account_id")
        conversation_id = payload.get("conversation_id")
        assignee_id = payload.get("assignee_id")

        rooms = []

        if routing_key == "conversation.created":
            rooms.append(f"account:{account_id}")

        elif routing_key in ("conversation.message.created", "conversation.message.sent"):
            if conversation_id:
                rooms.append(f"conv:{conversation_id}")
            rooms.append(f"account:{account_id}")

        elif routing_key == "conversation.assigned":
            if assignee_id:
                rooms.append(f"user:{assignee_id}")
            rooms.append(f"account:{account_id}")

        elif routing_key in ("conversation.status_changed", "conversation.resolved"):
            rooms.append(f"account:{account_id}")

        return rooms

    def _routing_key_to_event_type(self, routing_key: str) -> str:
        """Map RabbitMQ routing key to client event type."""
        mapping = {
            "conversation.created": "conversation:new",
            "conversation.message.created": "conversation:message",
            "conversation.message.sent": "conversation:message",
            "conversation.assigned": "notification:assignment",
            "conversation.status_changed": "conversation:updated",
            "conversation.resolved": "conversation:updated",
        }
        return mapping.get(routing_key, "conversation:updated")

    def _get_room_connections(self, room: str) -> list[str]:
        """Query DynamoDB for all connection IDs subscribed to a room."""
        response = self.subscriptions_table.query(
            KeyConditionExpression=Key("room").eq(room),
            ProjectionExpression="connection_id",
        )
        return [item["connection_id"] for item in response.get("Items", [])]

    def _push_to_connection(self, connection_id: str, message: str):
        """Send a message to a WebSocket connection via API Gateway."""
        try:
            self.api_gw.post_to_connection(
                ConnectionId=connection_id,
                Data=message.encode("utf-8"),
            )
        except self.api_gw.exceptions.GoneException:
            # Connection is stale — clean up
            self._cleanup_stale_connection(connection_id)
        except Exception as e:
            logger.warning(f"Failed to push to {connection_id}: {e}")

    def _cleanup_stale_connection(self, connection_id: str):
        """Remove stale connection and its subscriptions from DynamoDB."""
        # Query all subscriptions for this connection
        response = self.subscriptions_table.query(
            IndexName="connection_id-index",
            KeyConditionExpression=Key("connection_id").eq(connection_id),
        )
        # Delete each subscription
        for item in response.get("Items", []):
            self.subscriptions_table.delete_item(
                Key={"room": item["room"], "connection_id": connection_id}
            )
        # Delete connection
        self.connections_table.delete_item(Key={"connection_id": connection_id})
```

### Dual Trigger

Like existing workers, use polling + `pg_notify` for immediate wake-up:
- Poll RabbitMQ queue every N seconds
- `pg_notify` channel triggers immediate consumption

### Config Additions

Add to `src/config/config.py`:

```python
WS_API_ENDPOINT: str = ""        # API Gateway callback URL
WS_CONNECTIONS_TABLE: str = "ws_connections"
WS_SUBSCRIPTIONS_TABLE: str = "ws_subscriptions"
WS_PRESENCE_TABLE: str = "ws_presence"
LOCAL_WS_MODE: bool = False      # Use local WS server instead of AWS
```

### Local Development Mode

When `LOCAL_WS_MODE=True`, the worker sends events to the local FastAPI WebSocket server (`src/dev/local_ws_server.py`) instead of calling AWS APIs. This allows development without AWS credentials.

---

## Part 3: Local Dev WebSocket Server

### File: `src/dev/local_ws_server.py`

A lightweight FastAPI WebSocket endpoint for local development:

```python
"""
Local WebSocket server for development.
Mimics AWS API Gateway WebSocket behavior with in-memory state.

Usage:
    uvicorn src.dev.local_ws_server:app --port 3200
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()

# In-memory state (replaces DynamoDB)
connections: dict[str, WebSocket] = {}
subscriptions: dict[str, set[str]] = {}  # room → {connection_ids}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connection_id = str(uuid4())
    connections[connection_id] = websocket

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action")

            if action == "subscribe":
                room = data["room"]
                subscriptions.setdefault(room, set()).add(connection_id)

            elif action == "unsubscribe":
                room = data["room"]
                subscriptions.get(room, set()).discard(connection_id)

            elif action == "typing":
                # Relay to room
                room = f"conv:{data['conversation_id']}"
                await _broadcast(room, data, exclude=connection_id)

    except WebSocketDisconnect:
        del connections[connection_id]
        for room_subs in subscriptions.values():
            room_subs.discard(connection_id)

# HTTP endpoint for realtime_push_worker to push events
@app.post("/push/{connection_id}")
async def push_to_connection(connection_id: str, payload: dict):
    ws = connections.get(connection_id)
    if not ws:
        raise HTTPException(410, "Gone")
    await ws.send_json(payload)
```

---

## Tasks

### RabbitMQ Topology
- [ ] Add `realtime.events` queue declaration to RabbitMQ setup
- [ ] Add bindings for all conversation event routing keys
- [ ] Verify queue appears in RabbitMQ management UI

### Worker
- [ ] Create `src/workers/realtime_push_worker.py`
- [ ] Implement event routing (routing key → target rooms)
- [ ] Implement DynamoDB room query
- [ ] Implement API Gateway push via post_to_connection
- [ ] Implement GoneException handling (stale connection cleanup)
- [ ] Add config entries for WS_API_ENDPOINT, table names, LOCAL_WS_MODE
- [ ] Add `boto3` to `requirements.txt`
- [ ] Add Dockerfile/docker-compose entry for the worker

### Local Dev
- [ ] Create `src/dev/local_ws_server.py`
- [ ] Implement in-memory connection/subscription management
- [ ] Implement HTTP push endpoint for worker integration
- [ ] Implement LOCAL_WS_MODE in the worker (use HTTP POST instead of boto3)

---

## Tests

- [ ] Worker correctly maps conversation.created → account room
- [ ] Worker correctly maps conversation.message.* → conv room + account room
- [ ] Worker correctly maps conversation.assigned → user room + account room
- [ ] Worker handles GoneException by cleaning up stale connections
- [ ] Worker ACKs messages after successful processing
- [ ] Worker NACKs on parse failures (dead-letter)
- [ ] Local WS server: connect, subscribe, receive push
- [ ] Local WS server: typing relay between connections

---

## Acceptance Criteria

- [ ] `realtime.events` queue exists with correct bindings
- [ ] Worker consumes events and pushes to correct WebSocket connections
- [ ] Stale connections cleaned up automatically on GoneException
- [ ] Local development works without AWS credentials (LOCAL_WS_MODE)
- [ ] Worker follows same operational patterns as existing workers
- [ ] All tests passing, Ruff clean

---

## Dependencies

- **CONV-BE-001** — Event types emitted by conversation CRUD
- **CONV-AWS-001** — API Gateway endpoint + DynamoDB tables

## Blocks

- **CONV-FE-001** (WebSocket Client) — the push worker delivers events that the frontend consumes
