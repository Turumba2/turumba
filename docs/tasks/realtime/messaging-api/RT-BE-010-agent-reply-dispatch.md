# RT-BE-010: Agent Reply + IM Dispatch Flow

**Type:** Backend
**Service:** turumba_messaging_api
**Assignee:** tesfayegirma-116
**Priority:** P1 -- Agent sends messages
**Phase:** 3 -- Realtime Infrastructure
**Depends On:** RT-BE-004 (Conversation Messages endpoint), RT-BE-008 (push_to_room utility)
**Spec Reference:** [TURUMBA_REALTIME_MESSAGING.md -- Section 5.2](../../../TURUMBA_REALTIME_MESSAGING.md#52-agent-reply-flow), [Section 8.3](../../../TURUMBA_REALTIME_MESSAGING.md#83-agent-reply-endpoint), [Agent Reply Workflow](../../../realtime/03-AGENT-REPLY-FLOW.md), [Improvement: Persist-First](../../../improvements/RECOMMENDATIONS.md)

---

## Summary

Extend the `POST /v1/conversations/{id}/messages` endpoint (from RT-BE-004) to include realtime WebSocket push and IM platform dispatch. This task implements the **persist-first** pattern (per improvement recommendation) where the message is saved to the database first, then pushed to WebSocket clients, and finally dispatched to external IM platforms in the background.

**Important:** The original spec uses a fire-and-forget pattern (push first, persist in background). Per the architectural review in `docs/improvements/RECOMMENDATIONS.md`, this task uses the **persist-first** pattern instead to eliminate phantom message bugs. The trade-off is ~30-50ms added latency to the response.

---

## Architecture -- Persist-First Flow

```
Agent clicks "Send" in Turumba Inbox
    |
    v
POST /v1/conversations/{id}/messages
    |
    v
Phase 1: VALIDATE + AUTHORIZE                              (~1ms)
    |- Verify JWT (from gateway context-enricher headers)
    |- Load conversation by ID (404 if not found)
    |- Check account_id matches (tenant isolation)
    |- Extract current_user_id from token
    |
    v
Phase 2: PERSIST (synchronous, in request)                  (~30-50ms)
    |- Create Message record in DB
    |   direction: outbound, sender_type: agent
    |   sender_id: current_user_id
    |   channel_id: conversation.channel_id (IM) or null
    |   chat_endpoint_id: conversation.chat_endpoint_id (webchat) or null
    |- Update conversation.last_message_at
    |- Set conversation.first_reply_at if first agent reply (SLA tracking)
    |- Emit conversation.message.sent event to outbox
    |   (already_pushed: false -- will be set to true after push)
    |- Commit transaction
    |
    v
Phase 3: REALTIME PUSH (synchronous, non-blocking)          (~5-15ms)
    |- push_to_room("conv:{id}", ws_event, skip_visitors=is_private)
    |   (agents viewing this thread + visitor if webchat and not private)
    |- push_to_room("account:{account_id}", updated_event)
    |   (all agents in account -- inbox sort order update)
    |
    v
Phase 4: RETURN 201 with full message object                 (~0.1ms)
    |- 201 Created (not 202 -- message IS persisted)
    |- Response includes the full message with server-generated fields
    |
    v
Phase 5: BACKGROUND DISPATCH (BackgroundTask, only for IM)   (~200ms+)
    |- IM conversations (channel_id is set):
    |   dispatch to external platform via channel adapter
    |- Webchat conversations (chat_endpoint_id is set):
    |   no dispatch needed (already pushed via WebSocket)
    |- Private messages (is_private=true):
    |   no dispatch (internal notes stay in Turumba only)
```

---

## Implementation

### Modify: `POST /v1/conversations/{id}/messages`

The endpoint was created in RT-BE-004. This task modifies it to add the realtime push and IM dispatch steps.

```python
@router.post(
    "/v1/conversations/{id}/messages",
    response_model=SuccessResponse[ConversationMessageResponse],
    status_code=201,
)
async def send_conversation_message(
    id: UUID,
    body: ConversationMessageCreate,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    event_bus: EventBus = Depends(get_event_bus),
    outbox: OutboxMiddleware = Depends(get_outbox_middleware),
    current_user_id: UUID = Depends(get_current_user_id),
    push_service: RealtimePushService = Depends(get_push_service),
):
    # --- Phase 1: Validate + Authorize ---
    conversation = await get_conversation_or_404(id, db, request.headers)

    # --- Phase 2: Persist ---
    now = datetime.now(UTC)

    message = ConversationMessage(
        conversation_id=conversation.id,
        content=body.content,
        content_type=body.content_type or "text",
        direction="outbound",
        sender_type="agent",
        sender_id=current_user_id,
        is_private=body.is_private or False,
        channel_id=conversation.channel_id,
        chat_endpoint_id=conversation.chat_endpoint_id,
        account_id=conversation.account_id,
    )
    db.add(message)

    # Update conversation timestamps
    conversation.last_message_at = now
    if not conversation.first_reply_at:
        conversation.first_reply_at = now  # SLA tracking

    # Emit domain event
    event_bus.emit(DomainEvent(
        event_type=EventType.CONVERSATION_MESSAGE_SENT,
        aggregate_type="conversation_message",
        aggregate_id=message.id,
        payload={
            "message_id": str(message.id),
            "conversation_id": str(conversation.id),
            "account_id": str(conversation.account_id),
            "sender_type": "agent",
            "sender_id": str(current_user_id),
            "content": body.content,
            "is_private": body.is_private or False,
            "already_pushed": False,  # Will be pushed after commit
        },
    ))

    # Flush outbox + commit (atomic)
    await outbox.flush(db, event_bus, user_id=current_user_id)
    await db.commit()

    # pg_notify to wake outbox_worker
    try:
        await db.execute(
            text("SELECT pg_notify('outbox_channel', :payload)"),
            {"payload": "conversation_message"},
        )
    except Exception:
        pass  # Worker will pick up on next poll

    # --- Phase 3: Realtime Push ---
    ws_event = {
        "type": "conversation:message",
        "data": {
            "message_id": str(message.id),
            "conversation_id": str(conversation.id),
            "content": body.content,
            "content_type": body.content_type or "text",
            "sender_type": "agent",
            "sender_id": str(current_user_id),
            "is_private": body.is_private or False,
            "created_at": message.created_at.isoformat(),
        },
    }

    # Push to conversation room (agents + visitor if not private)
    await push_service.push_to_room(
        f"conv:{conversation.id}",
        ws_event,
        skip_visitors=body.is_private or False,
    )

    # Push inbox update to account room (all agents)
    await push_service.push_to_room(
        f"account:{conversation.account_id}",
        {
            "type": "conversation:updated",
            "data": {
                "conversation_id": str(conversation.id),
                "last_message_at": now.isoformat(),
            },
        },
    )

    # --- Phase 4: Return 201 ---
    # Message is persisted -- return the full object
    response_data = ConversationMessageResponse.model_validate(message)

    # --- Phase 5: Background IM Dispatch ---
    if _needs_im_dispatch(conversation, body.is_private):
        background_tasks.add_task(
            dispatch_to_im_platform,
            message_id=message.id,
            conversation=conversation,
        )

    return SuccessResponse(data=response_data)
```

### IM vs Webchat Detection

```python
def _needs_im_dispatch(conversation: Conversation, is_private: bool) -> bool:
    """
    Determine if a message needs to be dispatched to an external IM platform.

    - IM conversations (channel_id set): YES -- dispatch via channel adapter
    - Webchat conversations (chat_endpoint_id set): NO -- WebSocket push is the delivery
    - Private messages: NEVER -- internal notes stay in Turumba only
    """
    if is_private:
        return False
    if conversation.channel_id is not None:
        return True  # IM conversation -- needs external dispatch
    return False  # Webchat -- push_to_room was the delivery
```

### Background IM Dispatch

```python
async def dispatch_to_im_platform(
    message_id: UUID,
    conversation: Conversation,
) -> None:
    """
    Dispatch an outbound message to the external IM platform via channel adapter.

    Runs as a FastAPI BackgroundTask after the 201 response is returned.
    Only called for IM conversations (channel_id is set, not webchat).
    """
    try:
        async with db_session() as db:
            # Load message from DB (it was just committed)
            message = await db.get(ConversationMessage, message_id)
            if not message:
                logger.error("Message %s not found for dispatch", message_id)
                return

            # Load channel + credentials
            channel = await db.get(Channel, conversation.channel_id)
            if not channel:
                logger.error("Channel %s not found for dispatch", conversation.channel_id)
                return

            # Resolve adapter
            adapter = get_adapter(channel.channel_type, channel.provider)

            # Build dispatch payload
            payload = DispatchPayload(
                to=conversation.contact_identifier,
                content=message.content,
                content_type=message.content_type,
                credentials=channel.credentials,
            )

            # Send via adapter
            result = await adapter.send(payload)

            if result.success:
                message.status = "sent"
                message.external_id = result.external_id
            else:
                message.status = "failed"
                message.error_message = result.error_message
                logger.error(
                    "IM dispatch failed for message %s: %s",
                    message_id, result.error_message,
                )

            await db.commit()

    except Exception:
        logger.exception("IM dispatch error for message %s", message_id)
        # Message is persisted -- agent sees it in the conversation
        # Customer does not receive it on their platform
        # Could be retried via a dead-letter mechanism
```

---

## Key Design Decisions

### Persist-First (not Fire-and-Forget)

The original spec (Section 8.3) uses fire-and-forget: push first, persist in background, return 202. Per the improvement recommendation (`docs/improvements/RECOMMENDATIONS.md`), this task uses persist-first:

| Aspect | Fire-and-Forget (spec) | Persist-First (this task) |
|--------|----------------------|--------------------------|
| Response code | 202 Accepted | 201 Created |
| Response body | `{ message_id, status: "queued" }` | Full message object |
| DB write | Background (may fail) | Synchronous (guaranteed) |
| Push timing | Before DB write | After DB write |
| Latency to response | ~8-20ms | ~40-70ms |
| Phantom messages? | Yes (push succeeds, DB fails) | No |

**Why persist-first:** Eliminates the "phantom message" bug class where a message appears in real-time but is never persisted. The 30-50ms added latency is acceptable for a support chat product. Client-side optimistic rendering still works -- reconcile with the 201 response instead of a background event.

### already_pushed Flag

In the persist-first pattern, the outbox event is emitted with `already_pushed: false` at commit time. After the push succeeds, the message has been delivered directly. The `realtime_push_worker` (RT-BE-009) will see this event in the queue. Since the direct push already delivered it, the worker should skip re-pushing.

**Note:** In the persist-first pattern, the event is emitted before the push happens (it is part of the transaction). The `already_pushed` flag is set to `false` in the outbox event. However, by the time the `realtime_push_worker` processes this event (50-200ms later), the direct push will have already completed. To avoid double delivery:

1. The direct push happens immediately after commit (~5-15ms)
2. The outbox_worker publishes to RabbitMQ (~50ms after commit)
3. The realtime_push_worker consumes (~100ms+ after commit)

The timing gap means the direct push will always complete before the worker processes the event. The worker can check the `already_pushed` flag -- but since it is `false` in the payload, the worker will attempt to push again. This is acceptable because:

- Client-side deduplication by `message_id` prevents double rendering
- The second push is a no-op for clients that already received the message

**Alternative:** Update the outbox event payload to `already_pushed: true` after the direct push (requires a separate DB update). This adds complexity. For now, rely on client-side dedup.

---

## Error Handling

### Push Failure

If `push_to_room` fails (network error, AWS issue):
- Message is already persisted in DB (persist-first guarantee)
- Recipients will see the message on their next page load or inbox refresh
- The `realtime_push_worker` will deliver via the worker path as backup
- Log the error but do not fail the request

```python
try:
    await push_service.push_to_room(...)
except Exception:
    logger.warning("Direct push failed for conversation %s", conversation.id, exc_info=True)
    # Message is in DB -- worker path will deliver eventually
```

### IM Dispatch Failure

If the channel adapter `send()` fails:
- Message is persisted in DB (visible in Turumba conversation)
- Customer does not receive the reply on their IM platform
- Message status set to "failed"
- Could be retried via dead-letter queue or manual retry endpoint (future task)

### Transaction Failure

If the DB commit fails:
- No message persisted, no event emitted, no push sent
- Return 500 to the agent
- Agent can retry sending the message

---

## Tasks

### 1. Endpoint Modification
- [ ] Modify `POST /v1/conversations/{id}/messages` to follow the persist-first flow
- [ ] Change response code from existing behavior to 201 Created
- [ ] Return full `ConversationMessageResponse` in response body (not a minimal ACK)
- [ ] Inject `RealtimePushService` via `Depends(get_push_service)`
- [ ] Inject `BackgroundTasks` for IM dispatch

### 2. Persist Phase
- [ ] Create `ConversationMessage` record with:
  - `direction="outbound"`, `sender_type="agent"`, `sender_id=current_user_id`
  - `channel_id` from conversation (IM) or null (webchat)
  - `chat_endpoint_id` from conversation (webchat) or null (IM)
  - `account_id` from conversation
  - `is_private` from request body
- [ ] Update `conversation.last_message_at`
- [ ] Set `conversation.first_reply_at` if null (first agent reply -- SLA tracking)
- [ ] Emit `conversation.message.sent` domain event to EventBus
- [ ] Flush outbox + commit in single transaction
- [ ] Fire `pg_notify` to wake outbox_worker

### 3. Realtime Push Phase
- [ ] Build `conversation:message` WS event payload
- [ ] Call `push_to_room("conv:{id}", ws_event, skip_visitors=is_private)` for conversation room
- [ ] Call `push_to_room("account:{account_id}", updated_event)` for inbox update
- [ ] Wrap push calls in try/except -- log warning on failure, do not fail the request

### 4. IM Dispatch Phase (Background)
- [ ] Implement `_needs_im_dispatch(conversation, is_private)`:
  - Private messages: return False
  - channel_id set (IM): return True
  - chat_endpoint_id set (webchat): return False
- [ ] Implement `dispatch_to_im_platform(message_id, conversation)`:
  - Load message and channel from DB
  - Resolve channel adapter via `get_adapter(channel_type, provider)`
  - Build `DispatchPayload` with `to=conversation.contact_identifier`
  - Call `adapter.send(payload)`
  - Update message status to "sent" or "failed"
  - Commit status update
- [ ] Register as `BackgroundTask` only when `_needs_im_dispatch` returns True

### 5. Unit Tests
- [ ] **Test: agent reply to IM conversation** -- verify message created, push called, IM dispatch queued
- [ ] **Test: agent reply to webchat conversation** -- verify message created, push called, NO IM dispatch
- [ ] **Test: private note** -- verify message created, push called with `skip_visitors=True`, no IM dispatch
- [ ] **Test: first_reply_at set on first agent reply** -- verify SLA timestamp set
- [ ] **Test: first_reply_at NOT overwritten on subsequent replies** -- verify preserved
- [ ] **Test: last_message_at updated** -- verify conversation timestamp updated
- [ ] **Test: 201 response with full message** -- verify response code and body structure
- [ ] **Test: push failure does not fail request** -- mock push raising exception, verify 201 still returned
- [ ] **Test: _needs_im_dispatch logic** -- test all combinations (IM/webchat/private)
- [ ] **Test: IM dispatch success** -- mock adapter.send returning success, verify message status = "sent"
- [ ] **Test: IM dispatch failure** -- mock adapter.send returning failure, verify message status = "failed"
- [ ] **Test: conversation 404** -- verify 404 when conversation ID not found
- [ ] **Test: tenant isolation** -- verify request rejected when account_id mismatch

---

## Acceptance Criteria

- [ ] `POST /v1/conversations/{id}/messages` follows persist-first flow
- [ ] Returns 201 with full message object
- [ ] Message persisted before WebSocket push (no phantom messages)
- [ ] `push_to_room` called for both `conv:{id}` and `account:{account_id}` rooms
- [ ] Private notes (`is_private=true`) skip visitor connections via `skip_visitors=True`
- [ ] IM conversations dispatch to external platform via channel adapter in background
- [ ] Webchat conversations skip IM dispatch (WebSocket push is the delivery)
- [ ] `first_reply_at` set on first agent reply, preserved on subsequent replies
- [ ] `last_message_at` updated on every reply
- [ ] Domain event emitted to outbox for downstream processing
- [ ] Push failures are logged but do not fail the request (message is in DB)
- [ ] Unit tests passing, Ruff clean, coverage threshold met (80%)

---

## Notes

- The `ConversationMessageCreate` schema needs `content`, `content_type` (default "text"), and `is_private` (default false) fields. These should already exist from RT-BE-004 (conversation message extension).
- The `ConversationMessageResponse` schema should include all message fields including `id`, `conversation_id`, `content`, `direction`, `sender_type`, `sender_id`, `is_private`, `status`, `created_at`. Also from RT-BE-004.
- For the IM dispatch, the existing channel adapter framework (`src/adapters/`) and `DispatchPayload`/`DispatchResult` data types are reused. The `TelegramAdapter` is already implemented.
- The background dispatch could also be handled by the `dispatch_worker` via the outbox event pipeline (existing pattern). However, using a `BackgroundTask` here is simpler and keeps the dispatch tightly coupled to the agent reply flow. The outbox event (`conversation.message.sent`) still flows to the `realtime_push_worker` for secondary push.

## Blocks

- Frontend conversation chat view (RT-FE-002) -- sends messages via this endpoint
