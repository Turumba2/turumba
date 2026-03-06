# RT-BE-007: Internal Visitor Endpoints (Lambda Callbacks)

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P1 --- Required for webchat channel
**Phase:** 2 --- Core Logic
**Depends On:** RT-BE-001, RT-BE-003, RT-BE-004, RT-BE-005
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md --- Section 6.4](../../TURUMBA_REALTIME_MESSAGING.md#64-internal-messaging-api-endpoints-lambda-callbacks), [Section 9.6](../../TURUMBA_REALTIME_MESSAGING.md#96-messaging-api--internal-endpoints-lambda-callbacks), [Visitor Chat Workflow](../../realtime/02-VISITOR-CHAT-FLOW.md)

---

## Summary

Implement two internal HTTP endpoints in the Messaging API that are called by AWS Lambda functions during the visitor webchat flow. These endpoints are **not exposed through KrakenD** --- they are only accessible on the Docker network (`gt_turumba_messaging_api:8000`). No JWT auth is required; these are trusted service-to-service calls from Lambda functions.

1. **`POST /internal/validate-visitor`** --- Validates a visitor JWT token and returns visitor context (called by the `$connect` Lambda when a visitor opens a WebSocket connection).
2. **`POST /internal/visitor-message`** --- Creates a message from a visitor, evaluates conversation configs, finds or creates a conversation, and emits events (called by the `ws-visitor-message` Lambda when a visitor sends a chat message).

---

## Part 1: Visitor Token Validation

### Endpoint: `POST /internal/validate-visitor`

Called by the `$connect` Lambda to validate the visitor's JWT before establishing the WebSocket connection.

#### Request

```json
{
  "token": "vt_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Response (Success)

```json
{
  "valid": true,
  "visitor_id": "vs_abc123",
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "endpoint_id": "660e8400-e29b-41d4-a716-446655440000",
  "chat_endpoint_name": "Support Chat"
}
```

#### Response (Failure)

```json
{
  "valid": false,
  "reason": "expired"
}
```

Possible `reason` values: `"expired"`, `"invalid_signature"`, `"endpoint_inactive"`, `"endpoint_not_found"`, `"malformed_token"`

#### Implementation

```python
import jwt
from datetime import UTC, datetime

from src.config.config import settings


async def validate_visitor_token(token: str, db: Session) -> dict:
    """
    Decode visitor JWT, verify signature + expiry, check chat_endpoint.

    Token payload:
    {
      "sub": "vs_abc123",          # visitor_id
      "account_id": "uuid",        # scoped to this account
      "endpoint_id": "uuid",       # chat_endpoint id
      "type": "visitor",           # distinguishes from Cognito tokens
      "exp": 1700000000            # 1 hour expiry
    }

    Signed with VISITOR_JWT_SECRET (HMAC-SHA256).
    """
    try:
        payload = jwt.decode(
            token,
            settings.VISITOR_JWT_SECRET,
            algorithms=["HS256"],
        )
    except jwt.ExpiredSignatureError:
        return {"valid": False, "reason": "expired"}
    except jwt.InvalidSignatureError:
        return {"valid": False, "reason": "invalid_signature"}
    except jwt.DecodeError:
        return {"valid": False, "reason": "malformed_token"}

    # Verify token type
    if payload.get("type") != "visitor":
        return {"valid": False, "reason": "invalid_signature"}

    # Extract claims
    visitor_id = payload.get("sub")
    account_id = payload.get("account_id")
    endpoint_id = payload.get("endpoint_id")

    if not all([visitor_id, account_id, endpoint_id]):
        return {"valid": False, "reason": "malformed_token"}

    # Check chat_endpoint exists and is_active
    chat_endpoint = await _get_chat_endpoint(endpoint_id, db)
    if chat_endpoint is None:
        return {"valid": False, "reason": "endpoint_not_found"}
    if not chat_endpoint.is_active:
        return {"valid": False, "reason": "endpoint_inactive"}

    return {
        "valid": True,
        "visitor_id": visitor_id,
        "account_id": account_id,
        "endpoint_id": endpoint_id,
        "chat_endpoint_name": chat_endpoint.name,
    }
```

---

## Part 2: Visitor Message Handler

### Endpoint: `POST /internal/visitor-message`

Called by the `ws-visitor-message` Lambda when a visitor sends a chat message. Follows the full config evaluation flow from spec Section 4.1.

#### Request

```json
{
  "visitor_id": "vs_abc123",
  "account_id": "550e8400-e29b-41d4-a716-446655440000",
  "endpoint_id": "660e8400-e29b-41d4-a716-446655440000",
  "content": "Hello, I need help with my order",
  "content_type": "text",
  "email": "dawit@example.com"
}
```

Fields:
- `visitor_id` (required) --- from Lambda's DynamoDB connection lookup
- `account_id` (required) --- from Lambda's DynamoDB connection lookup
- `endpoint_id` (required) --- chat_endpoint UUID
- `content` (required) --- message body
- `content_type` (required) --- "text", "image", etc.
- `email` (optional) --- from pre-chat form, used for contact lookup

#### Response (Success)

```json
{
  "message_id": "770e8400-e29b-41d4-a716-446655440000",
  "conversation_id": "880e8400-e29b-41d4-a716-446655440000",
  "created_at": "2026-03-06T10:30:00.000Z",
  "is_new_conversation": true
}
```

#### Response (Rejection)

```json
{
  "allowed": false,
  "reason": "no_matching_config"
}
```

Possible `reason` values: `"no_matching_config"`, `"audience_rejected"`

#### Implementation

This endpoint **reuses `ConversationInboundService` from RT-BE-006** with `source_type="chat_endpoint"` instead of `source_type="channel"`.

```python
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import BackgroundTasks

from src.services.conversation.inbound_flow import (
    ConversationInboundService,
    InboundContext,
)


async def handle_visitor_message(
    payload: VisitorMessagePayload,
    db: Session,
    account_api_client: AccountApiClient,
    event_bus: EventBus,
    background_tasks: BackgroundTasks,
) -> dict:
    """
    Process a visitor message through the conversation flow.

    Steps (from spec Section 6.4):
    1. Lookup contact by email (if provided)
    2. Evaluate configs: evaluate_configs(account_id, "chat_endpoint", endpoint_id, contact_id)
    3. No match -> return { allowed: false, reason: "no_matching_config" }
    4. Ensure contact exists (create if null + audience_mode="all")
    5. Find existing conversation (by contact_id + chat_endpoint_id)
    6. Apply reopen_policy / creation_mode from matched config
    7. Create Message (direction: inbound, sender_type: contact)
    8. Update conversation.last_message_at
    9. Emit events via outbox
    """
    message_id = uuid4()
    now = datetime.now(UTC)

    # Reuse the same inbound flow as IM channels (RT-BE-006)
    inbound_service = ConversationInboundService(
        db=db,
        account_api_client=account_api_client,
    )

    ctx = InboundContext(
        account_id=UUID(payload.account_id),
        source_type="chat_endpoint",
        source_id=UUID(payload.endpoint_id),
        sender_identifier=payload.visitor_id,
        channel_type=None,  # webchat, not an IM channel
        email=payload.email,
    )

    result = await inbound_service.process_inbound(ctx)

    # No config matched
    if not result.config_matched:
        return {"allowed": False, "reason": "no_matching_config"}

    # Config matched but skip_conversation (manual mode)
    if result.skip_conversation:
        # Store message without conversation
        message = Message(
            id=message_id,
            account_id=UUID(payload.account_id),
            chat_endpoint_id=UUID(payload.endpoint_id),
            channel_id=None,
            content=payload.content,
            content_type=payload.content_type,
            direction="inbound",
            sender_type="contact",
            sender_id=None,
            is_private=False,
            conversation_id=None,
            metadata_={"pending_thread": True},
            created_at=now,
        )
        db.add(message)
        db.commit()
        return {"allowed": False, "reason": "audience_rejected"}

    conversation = result.conversation

    # Create Message
    message = Message(
        id=message_id,
        account_id=UUID(payload.account_id),
        conversation_id=conversation.id,
        chat_endpoint_id=UUID(payload.endpoint_id),
        channel_id=None,  # webchat, not IM
        content=payload.content,
        content_type=payload.content_type,
        direction="inbound",
        sender_type="contact",
        sender_id=None,
        is_private=False,
        created_at=now,
    )
    db.add(message)

    # Update conversation.last_message_at
    conversation.last_message_at = now

    # Emit events via outbox
    event_bus.emit(
        EventType.CONVERSATION_MESSAGE_CREATED,
        {
            "message_id": str(message_id),
            "conversation_id": str(conversation.id),
            "account_id": payload.account_id,
            "already_pushed": True,  # fire-and-forget push happens inline
        },
    )

    if result.is_new_conversation:
        event_bus.emit(
            EventType.CONVERSATION_CREATED,
            {
                "conversation_id": str(conversation.id),
                "account_id": payload.account_id,
                "chat_endpoint_id": payload.endpoint_id,
                "contact_identifier": payload.visitor_id,
                "status": conversation.status,
            },
        )

    # Flush outbox + commit within single transaction
    await OutboxMiddleware.flush(db)
    db.commit()
    await send_pg_notify(db)

    return {
        "message_id": str(message_id),
        "conversation_id": str(conversation.id),
        "created_at": now.isoformat(),
        "is_new_conversation": result.is_new_conversation,
    }
```

**Note on `already_pushed: True`:** The fire-and-forget push (direct WebSocket push via `push_to_room()`) will be implemented as a separate concern. The event carries this flag so the `realtime_push_worker` knows to skip re-pushing this message. The direct push call (`push_to_room`) will be added when the AWS WebSocket infrastructure is ready.

---

## Part 3: Router

### File: `src/routers/internal/visitor.py`

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter(prefix="/internal", tags=["internal"])


class ValidateVisitorRequest(BaseModel):
    token: str


class VisitorMessagePayload(BaseModel):
    visitor_id: str
    account_id: str
    endpoint_id: str
    content: str
    content_type: str = "text"
    email: str | None = None


@router.post("/validate-visitor")
async def validate_visitor(
    body: ValidateVisitorRequest,
    db: Session = Depends(get_db),
):
    """
    Validate a visitor JWT token.
    Called by Lambda $connect handler.
    No auth required --- internal endpoint only.
    """
    result = await validate_visitor_token(body.token, db)
    return result


@router.post("/visitor-message")
async def visitor_message(
    body: VisitorMessagePayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    account_api_client: AccountApiClient = Depends(get_account_api_client),
    event_bus: EventBus = Depends(get_event_bus),
):
    """
    Create a message from a visitor.
    Called by Lambda ws-visitor-message handler.
    No auth required --- internal endpoint only.
    """
    result = await handle_visitor_message(
        payload=body,
        db=db,
        account_api_client=account_api_client,
        event_bus=event_bus,
        background_tasks=background_tasks,
    )
    return result
```

### Register in `src/main.py`

```python
from src.routers.internal.visitor import router as internal_visitor_router

app.include_router(internal_visitor_router)
```

**Security note:** These endpoints are NOT exposed through KrakenD. They are only accessible on the Docker network. The gateway configuration must NOT include routes for `/internal/*`. Access is restricted by network topology (shared `gateway-network` in docker-compose).

---

## Part 4: Environment Variable

### File: `src/config/config.py` (extend existing)

Add the visitor JWT secret to settings:

```python
class Settings(BaseSettings):
    # ... existing settings ...

    # Visitor token signing (HMAC-SHA256)
    VISITOR_JWT_SECRET: str = ""
```

Add to `.env.example`:

```
VISITOR_JWT_SECRET=your-random-256-bit-secret-here
```

Also add `PyJWT` to `requirements.txt` if not already present:

```
PyJWT>=2.8.0
```

---

## Part 5: Helper --- Chat Endpoint Lookup

```python
from uuid import UUID

from sqlalchemy.orm import Session

from src.models.postgres.chat_endpoint import ChatEndpoint


async def _get_chat_endpoint(endpoint_id: str, db: Session) -> ChatEndpoint | None:
    """Fetch a chat endpoint by ID."""
    import asyncio

    def _query():
        return (
            db.query(ChatEndpoint)
            .filter(ChatEndpoint.id == UUID(endpoint_id))
            .first()
        )

    return await asyncio.to_thread(_query)
```

---

## Tasks

### Validate Visitor Endpoint
- [ ] Create `src/routers/internal/visitor.py`
- [ ] Implement `ValidateVisitorRequest` schema
- [ ] Implement `validate_visitor_token()` --- decode JWT (HMAC-SHA256), verify signature + expiry
- [ ] Check `type` claim equals `"visitor"`
- [ ] Extract `sub` (visitor_id), `account_id`, `endpoint_id` from claims
- [ ] Verify chat_endpoint exists in DB and `is_active = true`
- [ ] Return visitor context on success, error reason on failure
- [ ] Handle all failure modes: expired, invalid_signature, endpoint_inactive, endpoint_not_found, malformed_token

### Visitor Message Endpoint
- [ ] Implement `VisitorMessagePayload` schema
- [ ] Implement `handle_visitor_message()` --- full conversation flow
- [ ] Reuse `ConversationInboundService` from RT-BE-006 with `source_type="chat_endpoint"`
- [ ] Contact lookup by email (if provided via pre-chat form)
- [ ] Config evaluation: `evaluate_configs(account_id, "chat_endpoint", endpoint_id, contact_id)`
- [ ] No match: return `{ allowed: false, reason: "no_matching_config" }`
- [ ] Ensure contact exists (create if null, audience_mode="all")
- [ ] Find existing conversation by `(contact_id, chat_endpoint_id)`
- [ ] Apply `reopen_policy` / `creation_mode` from matched config
- [ ] Create Message (direction: inbound, sender_type: contact, chat_endpoint_id, channel_id=null)
- [ ] Update `conversation.last_message_at`
- [ ] Emit `conversation.message.created` event with `already_pushed: true`
- [ ] Emit `conversation.created` event if new conversation
- [ ] All within single DB transaction (message + conversation + outbox + commit)
- [ ] Return `{ message_id, conversation_id, created_at, is_new_conversation }`

### Configuration
- [ ] Add `VISITOR_JWT_SECRET` to `src/config/config.py` Settings
- [ ] Add `VISITOR_JWT_SECRET` to `.env.example`
- [ ] Add `PyJWT` to `requirements.txt` (if not present)

### Router Registration
- [ ] Register internal visitor router in `src/main.py` under `/internal` prefix
- [ ] Verify no KrakenD routes exist for `/internal/*` (network-level access control only)

---

## Tests

### Token Validation
- [ ] Valid token with active chat_endpoint --- returns `{ valid: true, visitor_id, account_id, endpoint_id, chat_endpoint_name }`
- [ ] Expired token --- returns `{ valid: false, reason: "expired" }`
- [ ] Token signed with wrong secret --- returns `{ valid: false, reason: "invalid_signature" }`
- [ ] Malformed token (not valid JWT) --- returns `{ valid: false, reason: "malformed_token" }`
- [ ] Token with `type != "visitor"` --- returns `{ valid: false, reason: "invalid_signature" }`
- [ ] Token with missing claims (no `sub` or `endpoint_id`) --- returns `{ valid: false, reason: "malformed_token" }`
- [ ] Valid token but chat_endpoint not found --- returns `{ valid: false, reason: "endpoint_not_found" }`
- [ ] Valid token but chat_endpoint `is_active = false` --- returns `{ valid: false, reason: "endpoint_inactive" }`

### Visitor Message --- Config Evaluation
- [ ] Message with matching config (chat_endpoint in `enabled_chat_endpoints`, audience_mode="all") --- creates conversation + message
- [ ] Message with no matching config --- returns `{ allowed: false, reason: "no_matching_config" }`
- [ ] Message with matching config but audience rejected (known_only, no contact) --- tries next config or returns rejection
- [ ] Message with multiple configs --- first match wins (priority order)

### Visitor Message --- Contact Handling
- [ ] Email provided, contact found in Account API --- uses existing contact_id
- [ ] Email provided, contact not found, audience_mode="all" --- creates contact via Account API
- [ ] No email (anonymous visitor), audience_mode="all" --- creates contact with name "Visitor"
- [ ] No email, audience_mode="known_only" --- no config match (contact_id = null fails known_only)

### Visitor Message --- Conversation Lifecycle
- [ ] First message from visitor --- creates new conversation (chat_endpoint_id set, channel_id = null)
- [ ] Second message from same visitor+endpoint --- appends to existing conversation, `is_new_conversation: false`
- [ ] Message after conversation resolved, `reopen_policy="reopen"` --- reopens, `is_new_conversation: false`
- [ ] Message after conversation resolved, `reopen_policy="new"` --- creates new, `is_new_conversation: true`
- [ ] Message after conversation resolved, `reopen_policy="threshold"` within window --- reopens
- [ ] Message after conversation resolved, `reopen_policy="threshold"` past window --- creates new

### Visitor Message --- Response Format
- [ ] Success response includes `message_id`, `conversation_id`, `created_at`, `is_new_conversation`
- [ ] Rejection response includes `allowed: false` and `reason`
- [ ] `created_at` is ISO 8601 format

### Event Emission
- [ ] New conversation emits both `conversation.created` and `conversation.message.created`
- [ ] Existing conversation (append) emits only `conversation.message.created`
- [ ] `conversation.message.created` event includes `already_pushed: true`
- [ ] No config match --- no events emitted

### Message Fields
- [ ] `message.direction` = "inbound"
- [ ] `message.sender_type` = "contact"
- [ ] `message.sender_id` = None
- [ ] `message.is_private` = False
- [ ] `message.chat_endpoint_id` = endpoint_id
- [ ] `message.channel_id` = None (webchat messages don't use channels)
- [ ] `message.conversation_id` links to correct conversation

---

## Acceptance Criteria

- [ ] `POST /internal/validate-visitor` correctly validates visitor JWTs (HMAC-SHA256) and returns visitor context
- [ ] `POST /internal/visitor-message` creates conversations and messages following the full config evaluation flow
- [ ] Both endpoints require no JWT authentication (internal, Docker network only)
- [ ] Visitor message flow reuses `ConversationInboundService` from RT-BE-006 (same decision logic, `source_type="chat_endpoint"`)
- [ ] Rejection responses (`no_matching_config`, `audience_rejected`) are clear and actionable for the Lambda
- [ ] Config defaults (`default_team_id`, `default_assignee_id`) applied to new conversations
- [ ] Reopen policies correctly handle resolved webchat conversations
- [ ] Events emitted via outbox within a single DB transaction
- [ ] `VISITOR_JWT_SECRET` configurable via environment variable
- [ ] All tests passing, Ruff clean

---

## Dependencies

- **RT-BE-001** --- Conversation model (conversations table)
- **RT-BE-003** --- ChatEndpoint model (chat_endpoints table with `public_key`, `is_active`)
- **RT-BE-004** --- Message extensions (conversation_id, sender_type, chat_endpoint_id columns on messages table)
- **RT-BE-005** --- Config evaluation engine (`evaluate_configs()`)
- **RT-BE-006** --- `ConversationInboundService` (reused here for webchat flow)

## Blocks

- **RT-AWS-001** (WebSocket Infrastructure) --- Lambda functions call these endpoints
- **CONV-BE-006** (Realtime Push Worker) --- consumes events emitted here
