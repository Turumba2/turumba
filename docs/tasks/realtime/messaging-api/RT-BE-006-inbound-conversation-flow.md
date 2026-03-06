# RT-BE-006: Inbound Conversation Flow (IM Channels)

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P0 --- Core IM pipeline
**Phase:** 2 --- Core Logic
**Depends On:** RT-BE-001, RT-BE-004, RT-BE-005, RT-ACC-002
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md --- Section 5.1](../../TURUMBA_REALTIME_MESSAGING.md#51-inbound-flow), [Inbound IM Workflow](../../realtime/01-INBOUND-IM-FLOW.md)

---

## Summary

Modify the existing `inbound_message_worker` to create and manage conversations from inbound IM messages (WhatsApp, Telegram, Messenger, SMS, Email). The worker already receives parsed inbound messages from RabbitMQ and creates `Message` records. This task adds the full conversation creation logic: contact lookup, config evaluation, contact auto-creation, conversation find-or-create with reopen policies, and event emission.

This wires together RT-BE-001 (Conversation model), RT-BE-004 (Message extensions), RT-BE-005 (config evaluation engine), and RT-ACC-002 (Account API internal endpoints) into the working end-to-end inbound pipeline.

---

## Part 1: New Service --- ConversationInboundService

### File: `src/services/conversation/inbound_flow.py`

Central service orchestrating the conversation creation flow. Used by both the inbound worker (this task) and the visitor message handler (RT-BE-007).

```python
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from src.clients.account_api import AccountApiClient
from src.models.postgres.conversation import Conversation
from src.services.conversation.config_evaluator import ConfigMatch, NoMatch, evaluate_configs


@dataclass
class InboundResult:
    """Result of processing an inbound message through the conversation flow."""
    conversation: Conversation | None
    is_new_conversation: bool
    contact_id: UUID | None
    config_matched: bool
    skip_conversation: bool  # True when no config matched or creation_mode="manual"


@dataclass
class InboundContext:
    """Input context for the inbound conversation flow."""
    account_id: UUID
    source_type: str          # "channel" or "chat_endpoint"
    source_id: UUID           # channel_id or chat_endpoint_id
    sender_identifier: str    # phone, email, telegram_user_id, etc.
    channel_type: str | None  # "whatsapp", "telegram", etc. (None for webchat)
    email: str | None = None  # from pre-chat form (webchat only)
    visitor_name: str | None = None  # from pre-chat form (webchat only)
```

### Main Flow Method

```python
class ConversationInboundService:
    def __init__(self, db: Session, account_api_client: AccountApiClient):
        self.db = db
        self.account_api_client = account_api_client

    async def process_inbound(self, ctx: InboundContext) -> InboundResult:
        """
        Full inbound conversation flow (spec Section 4.1, steps 2-6).

        1. Lookup contact (find only, no create)
        2. Evaluate configs (first match wins)
        3. If no match -> skip conversation creation
        4. Ensure contact exists (create if null + audience_mode="all")
        5. Find or create conversation
        """
        # Step 1: Contact lookup
        contact_id = await self._lookup_contact(ctx)

        # Step 2: Evaluate configs
        eval_result = await evaluate_configs(
            account_id=ctx.account_id,
            source_type=ctx.source_type,
            source_id=ctx.source_id,
            contact_id=contact_id,
            db=self.db,
            account_api_client=self.account_api_client,
        )

        # Step 3: No match -> skip
        if isinstance(eval_result, NoMatch):
            return InboundResult(
                conversation=None,
                is_new_conversation=False,
                contact_id=contact_id,
                config_matched=False,
                skip_conversation=True,
            )

        matched_config = eval_result.config

        # Step 4: Ensure contact exists
        if contact_id is None:
            contact_id = await self._create_contact(ctx)

        # Step 5: Find or create conversation
        conversation, is_new = await self._find_or_create_conversation(
            ctx=ctx,
            contact_id=contact_id,
            config=matched_config,
        )

        # Handle manual creation mode
        if conversation is None and matched_config.creation_mode == "manual":
            return InboundResult(
                conversation=None,
                is_new_conversation=False,
                contact_id=contact_id,
                config_matched=True,
                skip_conversation=True,
            )

        return InboundResult(
            conversation=conversation,
            is_new_conversation=is_new,
            contact_id=contact_id,
            config_matched=True,
            skip_conversation=False,
        )
```

---

## Part 2: Contact Lookup and Creation

### Contact Lookup (Step 2 of spec Section 4.1)

```python
async def _lookup_contact(self, ctx: InboundContext) -> UUID | None:
    """
    Find contact by phone, email, or platform identifier.
    Does NOT create --- just looks up.
    """
    lookup_payload = {"account_id": str(ctx.account_id)}

    if ctx.email:
        lookup_payload["email"] = ctx.email
    elif ctx.sender_identifier:
        # Determine lookup key based on channel type
        if ctx.channel_type in ("whatsapp", "sms", "smpp"):
            lookup_payload["phone"] = ctx.sender_identifier
        elif ctx.channel_type == "email":
            lookup_payload["email"] = ctx.sender_identifier
        else:
            # Telegram, Messenger, etc. --- use platform-specific lookup
            lookup_payload["platform_id"] = ctx.sender_identifier
            lookup_payload["platform"] = ctx.channel_type

    try:
        result = await self.account_api_client.lookup_contact(lookup_payload)
        if result.get("found"):
            return UUID(result["contact_id"])
    except Exception:
        # Account API unavailable --- treat as unknown contact
        pass

    return None
```

### Contact Creation (Step 5 of spec Section 4.1)

```python
async def _create_contact(self, ctx: InboundContext) -> UUID:
    """
    Create a new contact in the Account API.
    Only called after a config matched (and audience_mode must be "all"
    since null contact_id only passes "all" mode).
    """
    create_payload = {
        "account_id": str(ctx.account_id),
        "name": ctx.visitor_name or "Unknown",
        "properties": {"source": ctx.channel_type or "webchat"},
    }

    # Set contact identifier based on source
    if ctx.channel_type in ("whatsapp", "sms", "smpp"):
        create_payload["phone"] = ctx.sender_identifier
    elif ctx.channel_type == "email" or ctx.email:
        create_payload["email"] = ctx.email or ctx.sender_identifier
    else:
        # Telegram, Messenger --- store platform ID in properties
        create_payload["properties"]["platform_id"] = ctx.sender_identifier
        create_payload["properties"]["platform"] = ctx.channel_type

    if ctx.source_type == "chat_endpoint":
        create_payload["properties"]["visitor_id"] = ctx.sender_identifier
        create_payload["properties"]["source"] = "webchat"
        if ctx.email:
            create_payload["email"] = ctx.email
        if ctx.visitor_name and ctx.visitor_name != "Unknown":
            create_payload["name"] = ctx.visitor_name

    result = await self.account_api_client.create_contact(create_payload)
    return UUID(result["contact_id"])
```

---

## Part 3: Conversation Find-or-Create

### Find Existing Conversation (Step 6 of spec Section 4.1)

```python
async def _find_or_create_conversation(
    self,
    ctx: InboundContext,
    contact_id: UUID,
    config,  # ConversationConfig
) -> tuple[Conversation | None, bool]:
    """
    Find an existing conversation or create a new one.
    Returns (conversation, is_new_conversation).
    Returns (None, False) for manual creation mode.
    """
    import asyncio

    # Build lookup query based on source type
    def _find_existing():
        query = (
            self.db.query(Conversation)
            .filter(
                Conversation.account_id == ctx.account_id,
                Conversation.contact_id == contact_id,
                Conversation.status != "closed",
            )
        )
        if ctx.source_type == "channel":
            query = query.filter(Conversation.channel_id == ctx.source_id)
        else:
            query = query.filter(Conversation.chat_endpoint_id == ctx.source_id)

        return query.order_by(Conversation.updated_at.desc()).first()

    existing = await asyncio.to_thread(_find_existing)

    # CASE A: Active conversation (open / assigned / pending)
    if existing and existing.status in ("open", "assigned", "pending"):
        return existing, False

    # CASE B: Resolved conversation --- apply reopen policy
    if existing and existing.status == "resolved":
        return self._apply_reopen_policy(existing, config)

    # CASE C: Closed conversation --- always create new
    # (closed is terminal, but the query filters it out with status != 'closed')
    # If we reach here, no active/resolved conversation exists.

    # CASE D: No conversation found --- apply creation mode
    if config.creation_mode == "manual":
        return None, False

    # creation_mode = "auto" --- create new conversation
    return self._create_new_conversation(ctx, contact_id, config), True


def _apply_reopen_policy(
    self,
    existing: Conversation,
    config,
) -> tuple[Conversation, bool]:
    """Apply the matched config's reopen policy to a resolved conversation."""
    policy = config.reopen_policy

    if policy == "reopen":
        existing.status = "open"
        existing.resolved_at = None
        return existing, False

    if policy == "new":
        return self._create_new_conversation_from_existing(existing, config), True

    if policy == "threshold":
        reopen_window = config.reopen_window or 24  # default 24 hours
        if existing.resolved_at:
            hours_since = (datetime.now(UTC) - existing.resolved_at).total_seconds() / 3600
            if hours_since <= reopen_window:
                existing.status = "open"
                existing.resolved_at = None
                return existing, False
        # Past threshold --- create new
        return self._create_new_conversation_from_existing(existing, config), True

    # Unknown policy --- default to reopen
    existing.status = "open"
    existing.resolved_at = None
    return existing, False


def _create_new_conversation(
    self,
    ctx: InboundContext,
    contact_id: UUID,
    config,
) -> Conversation:
    """Create a brand new conversation with config defaults."""
    status = "assigned" if config.default_assignee_id else "open"

    conversation = Conversation(
        id=uuid4(),
        account_id=ctx.account_id,
        channel_id=ctx.source_id if ctx.source_type == "channel" else None,
        chat_endpoint_id=ctx.source_id if ctx.source_type == "chat_endpoint" else None,
        contact_id=contact_id,
        contact_identifier=ctx.sender_identifier,
        team_id=config.default_team_id,
        assignee_id=config.default_assignee_id,
        status=status,
        priority="normal",
        last_message_at=datetime.now(UTC),
    )
    self.db.add(conversation)
    return conversation


def _create_new_conversation_from_existing(
    self,
    existing: Conversation,
    config,
) -> Conversation:
    """Create a new conversation reusing existing contact/channel info."""
    status = "assigned" if config.default_assignee_id else "open"

    conversation = Conversation(
        id=uuid4(),
        account_id=existing.account_id,
        channel_id=existing.channel_id,
        chat_endpoint_id=existing.chat_endpoint_id,
        contact_id=existing.contact_id,
        contact_identifier=existing.contact_identifier,
        team_id=config.default_team_id,
        assignee_id=config.default_assignee_id,
        status=status,
        priority="normal",
        last_message_at=datetime.now(UTC),
    )
    self.db.add(conversation)
    return conversation
```

---

## Part 4: Modify inbound_message_worker

### File: `src/workers/inbound_message_worker.py` (modify existing)

The worker currently:
1. Consumes from RabbitMQ
2. Parses webhook payload
3. Creates a `Message` record

Add conversation logic **after** parsing and **before** message creation:

```python
async def process_inbound_message(self, payload: dict) -> None:
    """Extended to create/resume conversations."""
    channel_id = UUID(payload["channel_id"])
    channel_type = payload["channel_type"]
    account_id = UUID(payload["account_id"])
    sender_identifier = payload["sender_identifier"]
    content = payload["content"]
    content_type = payload.get("content_type", "text")

    # --- NEW: Conversation flow ---
    inbound_service = ConversationInboundService(
        db=self.db,
        account_api_client=self.account_api_client,
    )

    ctx = InboundContext(
        account_id=account_id,
        source_type="channel",
        source_id=channel_id,
        sender_identifier=sender_identifier,
        channel_type=channel_type,
    )

    result = await inbound_service.process_inbound(ctx)

    # --- Create Message ---
    message = Message(
        id=uuid4(),
        account_id=account_id,
        channel_id=channel_id,
        content=content,
        content_type=content_type,
        direction="inbound",
        # NEW fields:
        conversation_id=result.conversation.id if result.conversation else None,
        sender_type="contact",
        sender_id=None,  # contacts don't have user_id
        is_private=False,
    )

    # Handle manual creation mode
    if result.skip_conversation and result.config_matched:
        # creation_mode = "manual" --- store as pending
        message.metadata_ = {"pending_thread": True}

    self.db.add(message)

    # Update conversation.last_message_at
    if result.conversation:
        result.conversation.last_message_at = datetime.now(UTC)

    # --- Emit events ---
    if result.conversation:
        self.event_bus.emit(
            EventType.CONVERSATION_MESSAGE_CREATED,
            {
                "message_id": str(message.id),
                "conversation_id": str(result.conversation.id),
                "account_id": str(account_id),
            },
        )

        if result.is_new_conversation:
            self.event_bus.emit(
                EventType.CONVERSATION_CREATED,
                {
                    "conversation_id": str(result.conversation.id),
                    "account_id": str(account_id),
                    "channel_id": str(channel_id),
                    "contact_identifier": sender_identifier,
                    "status": result.conversation.status,
                },
            )

    # Flush outbox + commit (existing pattern)
    await OutboxMiddleware.flush(self.db)
    self.db.commit()
    await send_pg_notify(self.db)
```

---

## Part 5: AccountApiClient Extensions

### File: `src/clients/account_api.py` (extend existing)

Add two new methods:

```python
async def lookup_contact(self, payload: dict) -> dict:
    """
    Look up a contact by phone, email, or platform ID.

    Calls: POST http://gt_turumba_account_api:8000/internal/contacts/lookup
    Request:  { account_id: "uuid", phone: "+251..." }
              OR { account_id: "uuid", email: "user@example.com" }
    Response: { found: true, contact_id: "uuid", name: "Dawit" }
              OR { found: false }
    """
    response = await self._post("/internal/contacts/lookup", json=payload)
    return response


async def create_contact(self, payload: dict) -> dict:
    """
    Create a new contact in the Account API.

    Calls: POST http://gt_turumba_account_api:8000/internal/contacts/create
    Request:  { account_id: "uuid", phone: "+251...", name: "Unknown",
                properties: { source: "whatsapp" } }
    Response: { contact_id: "uuid" }
    """
    response = await self._post("/internal/contacts/create", json=payload)
    return response
```

**Error handling:** Both methods should raise on non-2xx responses. The caller (`ConversationInboundService`) wraps calls in try/except and handles degraded mode:
- `lookup_contact` failure: treat as unknown contact (`contact_id = None`)
- `create_contact` failure: retry 3x with backoff, then DLQ the inbound message

---

## Part 6: ConversationLookupService

### File: `src/services/conversation/lookup.py`

Optional utility for finding existing conversations. Can be inlined in `ConversationInboundService` if preferred.

```python
from uuid import UUID

from sqlalchemy.orm import Session

from src.models.postgres.conversation import Conversation


class ConversationLookupService:
    def __init__(self, db: Session):
        self.db = db

    def find_active_by_channel(
        self, account_id: UUID, contact_id: UUID, channel_id: UUID
    ) -> Conversation | None:
        """Find active/resolved conversation for IM channel."""
        return (
            self.db.query(Conversation)
            .filter(
                Conversation.account_id == account_id,
                Conversation.contact_id == contact_id,
                Conversation.channel_id == channel_id,
                Conversation.status != "closed",
            )
            .order_by(Conversation.updated_at.desc())
            .first()
        )

    def find_active_by_chat_endpoint(
        self, account_id: UUID, contact_id: UUID, chat_endpoint_id: UUID
    ) -> Conversation | None:
        """Find active/resolved conversation for webchat endpoint."""
        return (
            self.db.query(Conversation)
            .filter(
                Conversation.account_id == account_id,
                Conversation.contact_id == contact_id,
                Conversation.chat_endpoint_id == chat_endpoint_id,
                Conversation.status != "closed",
            )
            .order_by(Conversation.updated_at.desc())
            .first()
        )
```

---

## Part 7: RabbitMQ Queue Update

The existing `inbound_message_worker` consumes from a queue. Verify the queue name aligns with the spec:

- **Queue name:** `conversation.inbound` (on the `messaging` exchange)
- **Routing key:** `conversation.inbound`
- **DLQ:** `messaging.dlq` (existing)

If the worker currently uses a different queue name (e.g., `inbound_messages`), update to `conversation.inbound` and ensure the webhook router publishes to this queue with the updated routing key.

---

## Tasks

### ConversationInboundService
- [ ] Create `src/services/conversation/inbound_flow.py`
- [ ] Implement `InboundContext` and `InboundResult` dataclasses
- [ ] Implement `ConversationInboundService.process_inbound()` --- full flow orchestration
- [ ] Implement `_lookup_contact()` --- Account API lookup by phone/email/platform_id
- [ ] Implement `_create_contact()` --- Account API contact creation for unknown senders
- [ ] Implement `_find_or_create_conversation()` --- find existing or create new based on config
- [ ] Implement `_apply_reopen_policy()` --- handle "reopen", "new", "threshold" policies
- [ ] Implement `_create_new_conversation()` --- create with config defaults (team_id, assignee_id)
- [ ] Handle `creation_mode="manual"` --- return None conversation, mark message as pending

### Worker Modification
- [ ] Modify `src/workers/inbound_message_worker.py` to integrate `ConversationInboundService`
- [ ] Set `message.conversation_id` from the flow result
- [ ] Set `message.sender_type = "contact"` for all inbound messages
- [ ] Set `message.is_private = False` for all inbound messages
- [ ] Handle `pending_thread` metadata for manual creation mode messages
- [ ] Update `conversation.last_message_at` on each inbound message
- [ ] Emit `conversation.message.created` event via outbox
- [ ] Emit `conversation.created` event when a new conversation is created
- [ ] All within a single DB transaction (message + conversation + outbox + commit)
- [ ] Log "unqualified inbound" when no config matches (message processed for delivery tracking only)

### AccountApiClient
- [ ] Add `lookup_contact(payload)` method
- [ ] Add `create_contact(payload)` method
- [ ] Handle errors: retry 3x with backoff for create, treat lookup failure as unknown contact

### ConversationLookupService (optional)
- [ ] Create `src/services/conversation/lookup.py`
- [ ] Implement `find_active_by_channel()`
- [ ] Implement `find_active_by_chat_endpoint()`

---

## Tests

### Config Evaluation Integration
- [ ] Inbound message with matching config creates conversation
- [ ] Inbound message with no matching config skips conversation creation (message still created for delivery tracking)
- [ ] Inbound message with `creation_mode="manual"` stores message with `conversation_id=NULL` and `pending_thread: true`

### Contact Handling
- [ ] Known contact (phone found in Account API) --- uses existing contact_id
- [ ] Unknown contact with `audience_mode="all"` config --- creates contact via Account API, uses new contact_id
- [ ] Unknown contact with `audience_mode="known_only"` config --- no config match, no conversation
- [ ] Account API lookup failure --- treated as unknown contact (`contact_id = None`)
- [ ] Account API create failure --- retried 3x, then message sent to DLQ

### Conversation Lifecycle
- [ ] First inbound message from contact --- creates new conversation (status: "open")
- [ ] Second inbound message from same contact+channel --- appends to existing conversation (no new conversation)
- [ ] Inbound after conversation resolved, `reopen_policy="reopen"` --- reopens to "open"
- [ ] Inbound after conversation resolved, `reopen_policy="new"` --- creates new conversation
- [ ] Inbound after conversation resolved, `reopen_policy="threshold"` within window --- reopens existing
- [ ] Inbound after conversation resolved, `reopen_policy="threshold"` past window --- creates new
- [ ] Inbound after conversation closed --- creates new conversation (closed is terminal)

### Config Defaults
- [ ] Config with `default_team_id` --- new conversation has `team_id` set
- [ ] Config with `default_assignee_id` --- new conversation has `assignee_id` set, status = "assigned"
- [ ] Config with neither --- conversation has `team_id=None`, `assignee_id=None`, status = "open"

### Event Emission
- [ ] New conversation emits both `conversation.created` and `conversation.message.created`
- [ ] Existing conversation (append) emits only `conversation.message.created`
- [ ] Reopened conversation emits `conversation.message.created` (not `conversation.created`)
- [ ] No config match --- no conversation events emitted

### Message Fields
- [ ] `message.direction` = "inbound" for all inbound messages
- [ ] `message.sender_type` = "contact" for all inbound messages
- [ ] `message.sender_id` = None (contacts don't have user_id)
- [ ] `message.is_private` = False
- [ ] `message.conversation_id` links to the correct conversation

---

## Acceptance Criteria

- [ ] Inbound webhook messages automatically create/resume conversations when a config matches
- [ ] Contact lookup and auto-creation work for all channel types (WhatsApp, Telegram, SMS, Email)
- [ ] Reopen policies (reopen, new, threshold) correctly handle resolved conversations
- [ ] Manual creation mode stores messages as pending without creating conversations
- [ ] Events emitted correctly via outbox within a single DB transaction
- [ ] Messages without a matching config are processed normally (delivery tracking) but no conversation is created
- [ ] `conversation.last_message_at` updated on every inbound message
- [ ] End-to-end flow: webhook payload in RabbitMQ -> contact lookup -> config evaluation -> conversation find/create -> message creation -> event emission
- [ ] All tests passing, Ruff clean

---

## Dependencies

- **RT-BE-001** --- Conversation model (conversations table with channel_id, chat_endpoint_id, contact_id, etc.)
- **RT-BE-004** --- Message extensions (conversation_id, sender_type, sender_id, is_private columns on messages table)
- **RT-BE-005** --- Config evaluation engine (`evaluate_configs()`)
- **RT-ACC-002** --- Account API internal endpoints (`/internal/contacts/lookup`, `/internal/contacts/create`)

## Blocks

- **RT-BE-007** (Internal Visitor Endpoints) --- reuses `ConversationInboundService` for webchat flow
- **CONV-BE-006** (Realtime Push Worker) --- consumes events emitted here
