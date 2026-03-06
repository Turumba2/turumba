# Phase 2: IAM Roles

**Prerequisites:** Phase 1 complete (DynamoDB table ARNs needed)
**Outcome:** One IAM role shared by all Lambda functions

---

## Create the Lambda Execution Role

All 7 Lambda functions share a single IAM role. We'll create it with three inline policies.

### Step 1: Create the Role

1. Open **AWS Console > IAM > Roles > Create role**
2. Select **AWS service** as trusted entity
3. Use case: **Lambda**
4. Click **Next**
5. Do NOT attach any managed policies yet — click **Next**
6. Role name: `turumba-ws-lambda-role`
7. Description: `Execution role for Turumba WebSocket Lambda functions`
8. Click **Create role**

### Step 2: Add DynamoDB Policy

1. Open the newly created role `turumba-ws-lambda-role`
2. Go to **Permissions** tab > **Add permissions > Create inline policy**
3. Switch to **JSON** editor
4. Paste the following (replace `{region}` and `{account-id}` with your values):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:{region}:{account-id}:table/ws_connections",
        "arn:aws:dynamodb:{region}:{account-id}:table/ws_connections/index/*",
        "arn:aws:dynamodb:{region}:{account-id}:table/ws_subscriptions",
        "arn:aws:dynamodb:{region}:{account-id}:table/ws_subscriptions/index/*",
        "arn:aws:dynamodb:{region}:{account-id}:table/ws_presence"
      ]
    }
  ]
}
```

5. Policy name: `turumba-ws-dynamodb-access`
6. Click **Create policy**

### Step 3: Add API Gateway Management Policy

1. Still on the role page, **Add permissions > Create inline policy**
2. JSON editor:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ApiGatewayManagement",
      "Effect": "Allow",
      "Action": "execute-api:ManageConnections",
      "Resource": "arn:aws:execute-api:{region}:{account-id}:*/*/@connections/*"
    }
  ]
}
```

> Note: We use a wildcard for the API ID since we haven't created the WebSocket API yet. You can tighten this to the specific API ID after Phase 5.

3. Policy name: `turumba-ws-apigw-management`
4. Click **Create policy**

### Step 4: Add CloudWatch Logs Policy

1. **Add permissions > Create inline policy**
2. JSON editor:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:{region}:{account-id}:*"
    }
  ]
}
```

3. Policy name: `turumba-ws-cloudwatch-logs`
4. Click **Create policy**

---

## Verification

Open the role `turumba-ws-lambda-role` and confirm:

- [ ] Trust policy allows `lambda.amazonaws.com` to assume this role
- [ ] Inline policy `turumba-ws-dynamodb-access` — 7 DynamoDB actions on 5 resources (3 tables + 2 indexes)
- [ ] Inline policy `turumba-ws-apigw-management` — `execute-api:ManageConnections`
- [ ] Inline policy `turumba-ws-cloudwatch-logs` — 3 CloudWatch Logs actions

Note the role ARN:
```
arn:aws:iam::{account-id}:role/turumba-ws-lambda-role
```

You'll select this role when creating each Lambda function in Phase 3 and 4.

---

## Security Notes

- The API Gateway Management wildcard will be tightened to a specific API ID after Phase 5.
- CloudWatch Logs resource can be tightened to `/aws/lambda/ws-*` after all Lambdas are created.
- If you later choose VPC Lambda (Phase 8), you'll need to add `AWSLambdaVPCAccessExecutionRole` managed policy to this role.

**Next:** [Phase 3 — Lambda Shared Layer](./03-lambda-shared-layer.md)
