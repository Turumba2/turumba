# HSM-001: Channel Adapter Framework & Telegram Adapter

**Type:** Backend
**Service:** turumba_messaging_api
**Priority:** P0 — Must be completed first
**Feature Area:** High-Scale Messaging — Channel Adapter Layer
**Architecture Reference:** [High-Scale Messaging Architecture](../../HIGH_SCALE_MESSAGING_ARCHITECTURE.md)

---

## Summary

Build the foundational channel adapter layer: an abstract interface, adapter registry, shared data types, and the first concrete adapter (Telegram). This establishes the pluggable pattern that all dispatch workers and subsequent adapters depend on.

Telegram is the first adapter because it has simple auth (one bot token), a well-documented API, no approval process for sending, and webhook-based updates — making it ideal for proving the abstraction end-to-end.

**Scope:**
- Abstract `ChannelAdapter` interface with all methods
- Data types: `DispatchPayload`, `DispatchResult`, `ChannelHealth`, `InboundMessage`, `StatusUpdate`
- Adapter registry with decorator-based registration and lookup
- Exception hierarchy for adapter errors
- Complete Telegram Bot API adapter (send, verify, parse webhooks)

---

## Part 1: Adapter Interface & Data Types

### Directory Structure

```
src/adapters/
├── __init__.py
├── base.py                # Abstract ChannelAdapter + data types
├── registry.py            # Adapter registry
├── exceptions.py          # Adapter-specific exceptions
└── telegram/
    ├── __init__.py
    └── telegram_adapter.py
```

### Data Types (`src/adapters/base.py`)

```python
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

@dataclass
class DispatchPayload:
    """Everything needed to send a single message through a channel."""
    message_id: UUID
    channel_id: UUID
    channel_type: str                    # "sms", "telegram", "whatsapp", etc.
    credentials: dict                    # Decrypted channel credentials
    delivery_address: str                # Phone number, chat_id, email, username
    message_body: str                    # Rendered message content
    metadata: dict = field(default_factory=dict)
    media_url: str | None = None
    media_type: str | None = None        # "image", "document", "audio", "video"
    reply_to_provider_id: str | None = None

@dataclass
class DispatchResult:
    """Result of a message dispatch attempt."""
    success: bool
    provider_message_id: str | None = None
    status: str = "sent"                 # "sent", "failed", "rate_limited", "rejected"
    error_code: str | None = None
    error_message: str | None = None
    metadata: dict = field(default_factory=dict)
    retryable: bool = False              # Whether this failure is transient

@dataclass
class ChannelHealth:
    """Result of a channel health check."""
    status: str                          # "connected", "disconnected", "error"
    latency_ms: int | None = None
    error_message: str | None = None

@dataclass
class InboundMessage:
    """A message received from an external platform via webhook."""
    provider_message_id: str
    sender_address: str                  # Phone number, chat_id, email
    message_body: str
    timestamp: datetime
    metadata: dict = field(default_factory=dict)
    media_url: str | None = None
    media_type: str | None = None

@dataclass
class StatusUpdate:
    """A delivery status update received via webhook."""
    provider_message_id: str
    status: str                          # "sent", "delivered", "failed", "read"
    timestamp: datetime
    error_code: str | None = None
    error_message: str | None = None
    metadata: dict = field(default_factory=dict)
```

### Abstract Interface

```python
from abc import ABC, abstractmethod

class ChannelAdapter(ABC):
    """
    Abstract base for all channel adapters. Dispatch workers use this
    interface without knowing which provider they're talking to.
    """

    @abstractmethod
    async def send(self, payload: DispatchPayload) -> DispatchResult:
        """Send a single message. Returns result with provider message ID."""

    @abstractmethod
    async def verify_credentials(self, credentials: dict) -> bool:
        """Test that credentials are valid (lightweight API call)."""

    @abstractmethod
    async def check_health(self) -> ChannelHealth:
        """Check current health/connectivity of this channel."""

    @abstractmethod
    def parse_inbound(self, raw_payload: dict) -> InboundMessage | None:
        """Parse webhook payload into InboundMessage. None if not a message."""

    @abstractmethod
    def parse_status_update(self, raw_payload: dict) -> StatusUpdate | None:
        """Parse webhook payload into StatusUpdate. None if not a status event."""

    @abstractmethod
    def verify_webhook_signature(self, headers: dict, body: bytes, secret: str) -> bool:
        """Verify incoming webhook is genuinely from the provider."""
```

### Adapter Registry (`src/adapters/registry.py`)

```python
_ADAPTER_REGISTRY: dict[str, dict[str, type[ChannelAdapter]]] = {}

def register_adapter(channel_type: str, provider: str = "default"):
    """Decorator to register an adapter class."""
    def decorator(cls):
        if channel_type not in _ADAPTER_REGISTRY:
            _ADAPTER_REGISTRY[channel_type] = {}
        _ADAPTER_REGISTRY[channel_type][provider] = cls
        return cls
    return decorator

def get_adapter(channel_type: str, provider: str | None = None) -> ChannelAdapter:
    """Resolve and instantiate the adapter for a channel type + optional provider."""
    adapters = _ADAPTER_REGISTRY.get(channel_type)
    if not adapters:
        raise AdapterNotFoundError(f"No adapter for channel type: {channel_type}")
    adapter_cls = adapters.get(provider or "default") or adapters.get("default")
    if not adapter_cls:
        raise AdapterNotFoundError(f"No adapter for {channel_type}/{provider}")
    return adapter_cls()

def list_adapters() -> dict[str, list[str]]:
    """List all registered adapters (useful for admin/debug endpoints)."""
    return {ct: list(p.keys()) for ct, p in _ADAPTER_REGISTRY.items()}
```

### Exceptions (`src/adapters/exceptions.py`)

```python
class AdapterError(Exception):
    """Base exception for all adapter errors."""

class AdapterNotFoundError(AdapterError):
    """No adapter registered for the given channel type / provider."""

class AdapterConnectionError(AdapterError):
    """Could not connect to the provider (network error, timeout)."""

class AdapterAuthError(AdapterError):
    """Provider rejected the credentials."""

class AdapterRateLimitError(AdapterError):
    """Provider returned HTTP 429 or equivalent."""
    def __init__(self, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.retry_after = retry_after

class AdapterPayloadError(AdapterError):
    """Message payload is invalid for this channel (e.g., too long)."""
```

---

## Part 2: Telegram Adapter

### Telegram Bot API Reference

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Send text | POST | `/bot{token}/sendMessage` |
| Send photo | POST | `/bot{token}/sendPhoto` |
| Send document | POST | `/bot{token}/sendDocument` |
| Verify token | GET | `/bot{token}/getMe` |
| Set webhook | POST | `/bot{token}/setWebhook` |

**Rate Limits:** 30 msg/sec to different chats, 1 msg/sec to same chat.

**Credentials:** `{ "bot_token": "123456:ABC-DEF..." }`

### Implementation

```python
import httpx
from src.adapters.base import *
from src.adapters.registry import register_adapter
from src.adapters.exceptions import *

TELEGRAM_API = "https://api.telegram.org/bot{token}"

@register_adapter("telegram")
class TelegramAdapter(ChannelAdapter):

    async def send(self, payload: DispatchPayload) -> DispatchResult:
        token = payload.credentials["bot_token"]
        base = TELEGRAM_API.format(token=token)

        if payload.media_url and payload.media_type == "image":
            url = f"{base}/sendPhoto"
            data = {"chat_id": payload.delivery_address, "photo": payload.media_url,
                    "caption": payload.message_body,
                    "parse_mode": payload.metadata.get("parse_mode", "HTML")}
        else:
            url = f"{base}/sendMessage"
            data = {"chat_id": payload.delivery_address, "text": payload.message_body,
                    "parse_mode": payload.metadata.get("parse_mode", "HTML")}

        async with httpx.AsyncClient(timeout=30) as client:
            try:
                resp = await client.post(url, json=data)
            except httpx.ConnectError as e:
                raise AdapterConnectionError(f"Telegram unreachable: {e}")

            if resp.status_code == 200:
                r = resp.json()["result"]
                return DispatchResult(success=True,
                    provider_message_id=str(r["message_id"]), status="sent",
                    metadata={"chat_id": r["chat"]["id"]})
            elif resp.status_code == 401:
                raise AdapterAuthError("Invalid bot token")
            elif resp.status_code == 429:
                retry = resp.json().get("parameters", {}).get("retry_after", 30)
                raise AdapterRateLimitError("Rate limited", retry_after=retry)
            else:
                err = resp.json().get("description", "Unknown error")
                return DispatchResult(success=False, status="failed",
                    error_code=str(resp.status_code), error_message=err,
                    retryable=resp.status_code >= 500)

    async def verify_credentials(self, credentials: dict) -> bool:
        token = credentials.get("bot_token")
        if not token:
            return False
        async with httpx.AsyncClient(timeout=10) as client:
            try:
                resp = await client.get(f"{TELEGRAM_API.format(token=token)}/getMe")
                return resp.status_code == 200 and resp.json().get("ok", False)
            except httpx.RequestError:
                return False

    async def check_health(self) -> ChannelHealth:
        return ChannelHealth(status="connected")

    def parse_inbound(self, raw_payload: dict) -> InboundMessage | None:
        msg = raw_payload.get("message")
        if not msg:
            return None
        return InboundMessage(
            provider_message_id=str(msg["message_id"]),
            sender_address=str(msg["chat"]["id"]),
            message_body=msg.get("text", ""),
            timestamp=datetime.fromtimestamp(msg["date"], tz=UTC),
            metadata={"chat_type": msg["chat"].get("type"),
                      "from_username": msg.get("from", {}).get("username"),
                      "from_id": msg.get("from", {}).get("id")})

    def parse_status_update(self, raw_payload: dict) -> StatusUpdate | None:
        return None  # Telegram doesn't send delivery receipts for bots

    def verify_webhook_signature(self, headers: dict, body: bytes, secret: str) -> bool:
        return headers.get("x-telegram-bot-api-secret-token", "") == secret
```

---

## Tasks

### Part 1: Framework
- [ ] Create `src/adapters/__init__.py`
- [ ] Create `src/adapters/base.py` — all data types + `ChannelAdapter` ABC
- [ ] Create `src/adapters/registry.py` — `register_adapter`, `get_adapter`, `list_adapters`
- [ ] Create `src/adapters/exceptions.py` — full exception hierarchy

### Part 2: Telegram Adapter
- [ ] Create `src/adapters/telegram/__init__.py`
- [ ] Create `src/adapters/telegram/telegram_adapter.py`
- [ ] `send()` — text messages via `/sendMessage`
- [ ] `send()` — photo messages via `/sendPhoto` when media provided
- [ ] `verify_credentials()` — call `/getMe`
- [ ] `parse_inbound()` — parse Telegram webhook update
- [ ] `parse_status_update()` — return None (no delivery receipts)
- [ ] `verify_webhook_signature()` — check `X-Telegram-Bot-Api-Secret-Token`
- [ ] Register with `@register_adapter("telegram")`
- [ ] Handle errors: 401 → `AdapterAuthError`, 429 → `AdapterRateLimitError`, 5xx → retryable

### Part 3: Dependencies
- [ ] Add `httpx` to `requirements.txt` (if not already present)

### Part 4: Tests
- [ ] Data type construction and defaults
- [ ] Registry: register, get, fallback to default, not found error
- [ ] `list_adapters()` returns registered adapters
- [ ] `ChannelAdapter` cannot be instantiated (abstract)
- [ ] Telegram `send()` — mock 200 response, verify success result
- [ ] Telegram `send()` — mock 400, verify failure result
- [ ] Telegram `send()` — mock 401, verify `AdapterAuthError`
- [ ] Telegram `send()` — mock 429, verify `AdapterRateLimitError` with `retry_after`
- [ ] Telegram `send()` — mock connection error, verify `AdapterConnectionError`
- [ ] Telegram `verify_credentials()` — success and failure
- [ ] Telegram `parse_inbound()` — valid message and non-message payloads
- [ ] Telegram `verify_webhook_signature()` — valid and invalid tokens

---

## Acceptance Criteria

- [ ] Abstract `ChannelAdapter` interface with 6 methods
- [ ] All 5 data types defined as dataclasses
- [ ] Decorator-based adapter registry with lookup
- [ ] Exception hierarchy: connection, auth, rate limit, payload, not found
- [ ] Telegram adapter fully implements all interface methods
- [ ] Telegram adapter registered and retrievable via `get_adapter("telegram")`
- [ ] All tests passing with mocked HTTP, Ruff clean

---

## Dependencies

- None (this is the foundation)

## Blocks

- HSM-002 (Dispatch Pipeline — uses `get_adapter()`)
- HSM-003 (Webhook Receivers — uses adapter parsing methods)
- HSM-005 (Additional Adapters — builds on this framework)
