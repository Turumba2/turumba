# Workflow 04: Config Evaluation Engine

The multi-config evaluation logic that determines whether an inbound message should create a conversation. Used by both the inbound IM worker (Workflow 01) and the visitor message handler (Workflow 02). Configs are evaluated in priority order — **first match wins**.

**Spec reference:** [TURUMBA_REALTIME_MESSAGING.md — Section 4.1](../TURUMBA_REALTIME_MESSAGING.md#41-full-decision-flow)

---

## Evaluation Flow Diagram

```
evaluate_configs(account_id, source_type, source_id, contact_id)
    │
    │                                                    Timing
    ▼                                                    ──────
┌─────────────────────────────────────────────────┐
│ 1. LOAD CONFIGS                         (~2ms)  │
│                                                  │
│    SELECT * FROM conversation_configs             │
│    WHERE account_id = ?                          │
│      AND is_active = true                        │
│    ORDER BY priority ASC                         │
│                                                  │
│    Cached in memory per account_id               │
│    (invalidate on config CRUD operations)        │
│                                                  │
│    ├── No configs found                          │
│    │   → return NO_MATCH                         │
│    │   "No conversations until admin configures" │
│    │                                              │
│    └── Configs found: [config_1, config_2, ...]  │
│        → proceed to evaluation loop              │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 2. EVALUATION LOOP — FOR EACH CONFIG (priority order)               │
│                                                                      │
│    ┌─────────────────────────────────────────────────────────────┐   │
│    │                                                             │   │
│    │  ┌──────────────────────────────────────────────────┐       │   │
│    │  │ 2a. SOURCE CHECK                      (~0.1ms)  │       │   │
│    │  │                                                  │       │   │
│    │  │ source_type = "channel":                         │       │   │
│    │  │   Is source_id in config.enabled_channels?       │       │   │
│    │  │                                                  │       │   │
│    │  │ source_type = "chat_endpoint":                   │       │   │
│    │  │   Is source_id in config.enabled_chat_endpoints? │       │   │
│    │  │                                                  │       │   │
│    │  │ ├── YES → proceed to audience check              │       │   │
│    │  │ └── NO  → SKIP this config, try next             │       │   │
│    │  └──────────────────────┬───────────────────────────┘       │   │
│    │                         │                                   │   │
│    │                    Source matched                            │   │
│    │                         │                                   │   │
│    │                         ▼                                   │   │
│    │  ┌──────────────────────────────────────────────────┐       │   │
│    │  │ 2b. AUDIENCE CHECK              (~0.1ms-15ms)   │       │   │
│    │  │                                                  │       │   │
│    │  │ Switch on config.audience_mode:                   │       │   │
│    │  │                                                  │       │   │
│    │  │ ┌────────────────────────────────────────────┐   │       │   │
│    │  │ │ "all"                          (~0.1ms)    │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │ → MATCH (anyone is allowed)                │   │       │   │
│    │  │ │   No further checks needed.                │   │       │   │
│    │  │ └────────────────────────────────────────────┘   │       │   │
│    │  │                                                  │       │   │
│    │  │ ┌────────────────────────────────────────────┐   │       │   │
│    │  │ │ "known_only"                   (~0.1ms)    │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │ ├── contact_id exists (from lookup step)   │   │       │   │
│    │  │ │ │   → MATCH                                │   │       │   │
│    │  │ │ │                                          │   │       │   │
│    │  │ │ └── contact_id is null (unknown sender)    │   │       │   │
│    │  │ │     → SKIP this config                     │   │       │   │
│    │  │ └────────────────────────────────────────────┘   │       │   │
│    │  │                                                  │       │   │
│    │  │ ┌────────────────────────────────────────────┐   │       │   │
│    │  │ │ "groups"                       (~5-15ms)   │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │ ├── contact_id is null                     │   │       │   │
│    │  │ │ │   → SKIP (can't check membership)       │   │       │   │
│    │  │ │ │                                          │   │       │   │
│    │  │ │ └── contact_id exists                      │   │       │   │
│    │  │ │     Call Account API:                      │   │       │   │
│    │  │ │     POST /internal/contacts/               │   │       │   │
│    │  │ │           check-membership                 │   │       │   │
│    │  │ │     {                                      │   │       │   │
│    │  │ │       contact_id: "uuid",                  │   │       │   │
│    │  │ │       group_ids: config.allowed_groups      │   │       │   │
│    │  │ │     }                                      │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │     Response:                              │   │       │   │
│    │  │ │     { is_member: true/false,               │   │       │   │
│    │  │ │       matched_groups: [...] }              │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │     ├── is_member: true → MATCH            │   │       │   │
│    │  │ │     └── is_member: false → SKIP            │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │     Results cached per (contact_id,        │   │       │   │
│    │  │ │     group_ids) for 5 min TTL               │   │       │   │
│    │  │ └────────────────────────────────────────────┘   │       │   │
│    │  │                                                  │       │   │
│    │  │ ┌────────────────────────────────────────────┐   │       │   │
│    │  │ │ "allowlist"                    (~5-15ms)   │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │ Check 1: Direct contact match              │   │       │   │
│    │  │ │   contact_id in config.allowed_contacts?   │   │       │   │
│    │  │ │   ├── YES → MATCH                          │   │       │   │
│    │  │ │   └── NO → continue to group check         │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │ Check 2: Group membership                  │   │       │   │
│    │  │ │   (same as "groups" mode above)            │   │       │   │
│    │  │ │   contact_id in any config.allowed_groups? │   │       │   │
│    │  │ │   ├── YES → MATCH                          │   │       │   │
│    │  │ │   └── NO → SKIP                            │   │       │   │
│    │  │ │                                            │   │       │   │
│    │  │ │ Note: contact_id must exist for both       │   │       │   │
│    │  │ │ checks. null contact_id → SKIP.            │   │       │   │
│    │  │ └────────────────────────────────────────────┘   │       │   │
│    │  │                                                  │       │   │
│    │  └──────────────────────────────────────────────────┘       │   │
│    │                         │                                   │   │
│    │              ┌──────────┴──────────┐                        │   │
│    │              │                     │                        │   │
│    │           MATCH                  SKIP                       │   │
│    │              │                     │                        │   │
│    │              ▼                     ▼                        │   │
│    │  ┌─────────────────┐    ┌──────────────────┐               │   │
│    │  │ STOP evaluating │    │ Try NEXT config  │               │   │
│    │  │ Return config   │    │ in priority order│               │   │
│    │  └─────────────────┘    └────────┬─────────┘               │   │
│    │                                  │                          │   │
│    │                         ┌────────▼─────────┐               │   │
│    │                         │ More configs?     │               │   │
│    │                         │ ├── YES → loop    │               │   │
│    │                         │ └── NO → NO_MATCH │               │   │
│    │                         └──────────────────┘               │   │
│    └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 3. RESULT                                                            │
│                                                                      │
│    ├── MATCH: { matched: true, config: matched_config }              │
│    │   → Caller proceeds to: ensure contact → find/create conv       │
│    │   → Uses config's reopen_policy, creation_mode,                 │
│    │     default_team_id, default_assignee_id                        │
│    │                                                                 │
│    └── NO_MATCH: { matched: false }                                  │
│        → IM: message stored for delivery tracking, no conversation   │
│        → Webchat: return { allowed: false,                           │
│          reason: "no_matching_config" }                               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Timing Summary

| Step | Best Case | Worst Case | Notes |
|------|-----------|------------|-------|
| Load configs (cached) | 0.1ms | 2ms | Cache miss on first call per account |
| Source check (per config) | 0.1ms | 0.1ms | In-memory UUID list lookup |
| Audience "all" | 0.1ms | 0.1ms | No external calls |
| Audience "known_only" | 0.1ms | 0.1ms | Just checks if contact_id is not null |
| Audience "groups" | 1ms (cached) | 15ms (cache miss) | Calls Account API /internal/contacts/check-membership |
| Audience "allowlist" | 0.1ms (direct match) | 15ms (group check) | Direct contact list check first, then group membership |
| **Total (1 config, "all")** | **~0.3ms** | **~2ms** | Fastest path |
| **Total (3 configs, "groups" on 2nd)** | **~2ms** | **~20ms** | Typical VIP-first scenario |

---

## Worked Example

### Account Setup

```
Config 1 (priority=1): "VIP Telegram"
  enabled_channels: [telegram-uuid]
  enabled_chat_endpoints: []
  audience_mode: "groups"
  allowed_groups: [vip-customers-uuid]
  creation_mode: "auto"
  reopen_policy: "threshold"
  reopen_window: 48
  default_team_id: vip-support-team-uuid

Config 2 (priority=2): "General Telegram"
  enabled_channels: [telegram-uuid]
  enabled_chat_endpoints: []
  audience_mode: "all"
  creation_mode: "auto"
  reopen_policy: "reopen"

Config 3 (priority=3): "Public Webchat"
  enabled_channels: []
  enabled_chat_endpoints: [support-chat-uuid]
  audience_mode: "all"
  creation_mode: "auto"
  reopen_policy: "new"
  default_team_id: general-support-team-uuid
```

### Scenario A: VIP customer sends Telegram message

```
Input: source_type="channel", source_id=telegram-uuid, contact_id=dawit-uuid

Config 1:
  Source check: telegram-uuid in [telegram-uuid]? → YES
  Audience check: "groups"
    contact_id exists → call /internal/contacts/check-membership
    { contact_id: dawit-uuid, group_ids: [vip-customers-uuid] }
    Response: { is_member: true }
    → MATCH

Result: Config 1 matched
  → VIP team assignment, 48h reopen threshold
  → Time: ~5ms (group membership API call)
```

### Scenario B: Unknown person sends Telegram message

```
Input: source_type="channel", source_id=telegram-uuid, contact_id=null

Config 1:
  Source check: telegram-uuid in [telegram-uuid]? → YES
  Audience check: "groups"
    contact_id is null → SKIP

Config 2:
  Source check: telegram-uuid in [telegram-uuid]? → YES
  Audience check: "all" → MATCH

Result: Config 2 matched
  → General handling, auto-create contact (audience_mode="all" + null contact)
  → Time: ~0.5ms (no external calls)
```

### Scenario C: Visitor opens webchat

```
Input: source_type="chat_endpoint", source_id=support-chat-uuid, contact_id=null

Config 1:
  Source check: support-chat-uuid in [] (enabled_channels only)? → NO, SKIP

Config 2:
  Source check: support-chat-uuid in [] (enabled_channels only)? → NO, SKIP

Config 3:
  Source check: support-chat-uuid in [support-chat-uuid]? → YES
  Audience check: "all" → MATCH

Result: Config 3 matched
  → New conversation per session, general support team
  → Time: ~0.5ms
```

### Scenario D: WhatsApp message (no config covers WhatsApp)

```
Input: source_type="channel", source_id=whatsapp-uuid, contact_id=someone-uuid

Config 1: Source check: whatsapp-uuid in [telegram-uuid]? → NO, SKIP
Config 2: Source check: whatsapp-uuid in [telegram-uuid]? → NO, SKIP
Config 3: Source check: whatsapp-uuid in [] (chat_endpoints only)? → NO, SKIP

Result: NO MATCH
  → No conversation created
  → Time: ~0.3ms
```

---

## Caching Strategy

| Cache | Key | TTL | Invalidation |
|-------|-----|-----|-------------|
| Configs per account | `configs:{account_id}` | 5 min | On config CRUD (create, update, delete) — clear cache for that account_id |
| Group membership | `membership:{contact_id}:{sorted_group_ids_hash}` | 5 min | Passive expiry (group membership changes are infrequent) |

The config cache is critical for performance. Without it, every inbound message would query the `conversation_configs` table. With 1000 messages/minute per account, that's 1000 queries/minute eliminated.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Same source in multiple configs | First match wins. The note in the model says "A source should appear in at most ONE active config to avoid ambiguity" — but it's not enforced. If a Telegram channel appears in Config 1 (VIP) and Config 2 (General), Config 1 is always checked first (lower priority number). |
| Config with both `enabled_channels` and `enabled_chat_endpoints` | Source check matches if source_id is in EITHER list. A config can target both IM channels and chat endpoints. |
| Config with empty `enabled_channels` AND empty `enabled_chat_endpoints` | Source check always fails — config never matches anything. Effectively disabled. |
| `audience_mode: "groups"` with empty `allowed_groups` | Group membership check returns false (no groups to check against). Config never matches on audience. |
| Contact lookup fails (Account API down) | Treat as contact_id = null. Only "all" audience_mode will match. Logged as degraded. |
