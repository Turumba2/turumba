# Phase 1: DynamoDB Tables

**Prerequisites:** AWS Console access, confirmed region
**Outcome:** Three DynamoDB tables with GSIs and TTL enabled

---

## Table 1: `ws_connections`

Stores every active WebSocket connection (agents and visitors).

### Step-by-step

1. Open **AWS Console > DynamoDB > Tables > Create table**
2. Configure:
   - Table name: `ws_connections`
   - Partition key: `connection_id` (String)
   - Sort key: _leave empty_
3. Under **Table settings**, select **Customize settings**
4. Under **Read/write capacity settings**, select **On-demand**
5. Click **Create table**

### Add GSI: `user_id-index`

1. Open the `ws_connections` table > **Indexes** tab
2. Click **Create index**
3. Configure:
   - Partition key: `user_id` (String)
   - Sort key: _leave empty_
   - Index name: `user_id-index`
   - Projected attributes: **All**
4. Click **Create index**

### Enable TTL

1. Open the `ws_connections` table > **Additional settings** tab
2. Under **Time to Live (TTL)**, click **Turn on**
3. TTL attribute name: `ttl`
4. Click **Turn on TTL**

### Verification

- [ ] Table `ws_connections` exists with PK `connection_id` (S)
- [ ] GSI `user_id-index` exists with PK `user_id` (S), status Active
- [ ] TTL enabled on attribute `ttl`
- [ ] Billing mode is On-demand

---

## Table 2: `ws_subscriptions`

Tracks which connections are subscribed to which rooms.

### Step-by-step

1. Open **DynamoDB > Tables > Create table**
2. Configure:
   - Table name: `ws_subscriptions`
   - Partition key: `room` (String)
   - Sort key: `connection_id` (String)
3. Under **Table settings**, select **Customize settings**
4. Under **Read/write capacity settings**, select **On-demand**
5. Click **Create table**

### Add GSI: `connection_id-index`

1. Open the `ws_subscriptions` table > **Indexes** tab
2. Click **Create index**
3. Configure:
   - Partition key: `connection_id` (String)
   - Sort key: _leave empty_
   - Index name: `connection_id-index`
   - Projected attributes: **All**
4. Click **Create index**

### Enable TTL

1. Open the `ws_subscriptions` table > **Additional settings** tab
2. Under **Time to Live (TTL)**, click **Turn on**
3. TTL attribute name: `ttl`
4. Click **Turn on TTL**

### Verification

- [ ] Table `ws_subscriptions` exists with PK `room` (S), SK `connection_id` (S)
- [ ] GSI `connection_id-index` exists with PK `connection_id` (S), status Active
- [ ] TTL enabled on attribute `ttl`
- [ ] Billing mode is On-demand

---

## Table 3: `ws_presence`

Agent presence state (online/away/offline) per account.

### Step-by-step

1. Open **DynamoDB > Tables > Create table**
2. Configure:
   - Table name: `ws_presence`
   - Partition key: `account_id` (String)
   - Sort key: `user_id` (String)
3. Under **Table settings**, select **Customize settings**
4. Under **Read/write capacity settings**, select **On-demand**
5. Click **Create table**

### Enable TTL

1. Open the `ws_presence` table > **Additional settings** tab
2. Under **Time to Live (TTL)**, click **Turn on**
3. TTL attribute name: `ttl`
4. Click **Turn on TTL**

### Verification

- [ ] Table `ws_presence` exists with PK `account_id` (S), SK `user_id` (S)
- [ ] No GSI needed for this table
- [ ] TTL enabled on attribute `ttl`
- [ ] Billing mode is On-demand

---

## Summary

After completing this phase, you should have:

| Table | PK | SK | GSI | TTL |
|-------|----|----|-----|-----|
| `ws_connections` | `connection_id` | — | `user_id-index` | `ttl` |
| `ws_subscriptions` | `room` | `connection_id` | `connection_id-index` | `ttl` |
| `ws_presence` | `account_id` | `user_id` | — | `ttl` |

Note the table ARNs — you'll need them for the IAM policy in Phase 2:
```
arn:aws:dynamodb:{region}:{account-id}:table/ws_connections
arn:aws:dynamodb:{region}:{account-id}:table/ws_subscriptions
arn:aws:dynamodb:{region}:{account-id}:table/ws_presence
```

**Next:** [Phase 2 — IAM Roles](./02-iam-roles.md)
