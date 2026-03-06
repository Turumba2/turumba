# Phase 8: Lambda-to-Messaging API Connectivity

**Prerequisites:** Phase 7 complete, Messaging API deployed with `/internal/*` endpoints
**Outcome:** Lambda functions can reach the Messaging API internal endpoints

---

## The Problem

Two Lambda functions (`ws-connect` for visitor auth, `ws-visitor-message`) need to call the Messaging API's internal HTTP endpoints. The Messaging API runs as a Docker container (or ECS service) on a private network. Lambda functions by default run in AWS's public network and cannot reach private services.

---

## Option A: VPC Lambda (Recommended)

Run Lambda functions inside the same VPC as your ECS services / Docker host. The Lambdas can then reach the Messaging API via its private DNS name or IP.

### When to Use

- Single-region deployment
- Messaging API runs on ECS/EC2 within a VPC
- You want direct, low-latency connectivity

### Step-by-step

#### 1. Identify Your VPC and Subnets

Find the VPC and private subnets where the Messaging API runs:

```bash
# List your VPCs
aws ec2 describe-vpcs --query "Vpcs[*].{ID:VpcId,CIDR:CidrBlock,Name:Tags[?Key=='Name'].Value|[0]}" --output table

# List subnets in the VPC
aws ec2 describe-subnets --filters "Name=vpc-id,Values={vpc-id}" --query "Subnets[*].{ID:SubnetId,AZ:AvailabilityZone,CIDR:CidrBlock,Name:Tags[?Key=='Name'].Value|[0]}" --output table
```

Use **private subnets** (ones that route through a NAT Gateway, not directly to an Internet Gateway). Lambda needs the NAT Gateway for:
- Cognito JWKS endpoint (internet)
- DynamoDB (internet, unless you have a VPC endpoint)
- API Gateway Management API (internet)

#### 2. Create a Security Group for Lambda

```bash
aws ec2 create-security-group \
  --group-name turumba-ws-lambda-sg \
  --description "Security group for Turumba WebSocket Lambda functions" \
  --vpc-id {vpc-id}
```

Note the security group ID.

**Outbound rules** (default allows all outbound — keep this):
- All traffic to 0.0.0.0/0 (needed for DynamoDB, API GW, Cognito, Messaging API)

#### 3. Allow Lambda to Reach Messaging API

Add an inbound rule on the Messaging API's security group to allow traffic from the Lambda security group:

```bash
aws ec2 authorize-security-group-ingress \
  --group-id {messaging-api-sg-id} \
  --protocol tcp \
  --port 8000 \
  --source-group {lambda-sg-id}
```

#### 4. Add VPC Access to Lambda IAM Role

Attach the managed policy to `turumba-ws-lambda-role`:

1. Open **IAM > Roles > turumba-ws-lambda-role**
2. **Add permissions > Attach policies**
3. Search for and attach: `AWSLambdaVPCAccessExecutionRole`

This grants permissions to create ENIs in the VPC (required for VPC Lambda).

#### 5. Configure Lambda VPC Settings

For each Lambda that needs Messaging API access (`ws-connect`, `ws-visitor-message`):

1. Open the Lambda function > **Configuration > VPC**
2. Click **Edit**
3. Select:
   - VPC: your VPC
   - Subnets: select **2+ private subnets** in different AZs for HA
   - Security groups: `turumba-ws-lambda-sg`
4. Click **Save**

> **Important:** Only configure VPC on the two Lambdas that need it. The other 5 Lambdas (`ws-disconnect`, `ws-subscribe`, `ws-typing`, `ws-presence`, `ws-visitor-typing`) don't call the Messaging API and can stay in the default (non-VPC) configuration for better cold-start performance.

#### 6. Set the Internal URL

Set `MESSAGING_API_INTERNAL_URL` on both Lambdas:

```
MESSAGING_API_INTERNAL_URL=http://{messaging-api-private-dns-or-ip}:8000
```

Examples:
- ECS with Service Discovery: `http://messaging-api.turumba.local:8000`
- EC2 with private IP: `http://10.0.1.50:8000`
- ECS with ALB: `http://internal-messaging-alb-123456.us-east-1.elb.amazonaws.com:8000`

#### 7. Verify NAT Gateway Exists

VPC Lambdas need a NAT Gateway to reach the internet (for DynamoDB, API GW Management API, Cognito JWKS):

```bash
aws ec2 describe-nat-gateways --filter "Name=vpc-id,Values={vpc-id}" --query "NatGateways[*].{ID:NatGatewayId,State:State,SubnetId:SubnetId}" --output table
```

If no NAT Gateway exists, you need to create one (this has a cost — ~$0.045/hour + data transfer).

Alternatively, add **VPC Endpoints** for DynamoDB and execute-api to avoid routing through NAT for those services.

### Cost Considerations

| Item | Cost |
|------|------|
| NAT Gateway | ~$32/month + $0.045/GB data |
| VPC Endpoints (DynamoDB, execute-api) | $7.30/month each |
| Lambda ENIs | No additional cost |

**Recommendation:** If you already have a NAT Gateway for other services, no extra cost. If not, consider Option B or adding VPC Endpoints.

---

## Option B: Private HTTP API Gateway (Simpler)

Place an HTTP API Gateway in front of the Messaging API's internal endpoints. Lambda calls this private API Gateway instead of the Messaging API directly.

### When to Use

- You don't want to deal with VPC networking
- Cross-region or simpler setup
- Willing to add another hop (small latency increase)

### Step-by-step

#### 1. Create a Private HTTP API Gateway

1. Open **API Gateway > Create API > HTTP API > Build**
2. API name: `turumba-internal-api`
3. Add integration:
   - Type: **HTTP**
   - URL: `http://{messaging-api-address}:8000`
   - Method: **POST**
4. Add routes:
   - `POST /internal/validate-visitor` → HTTP integration
   - `POST /internal/visitor-message` → HTTP integration

#### 2. Add API Key Authorization

1. On the HTTP API, go to **Authorization**
2. Add an authorizer: **API Key** or **IAM**
3. Attach to both routes

#### 3. Set the Internal URL on Lambdas

```
MESSAGING_API_INTERNAL_URL=https://{http-api-id}.execute-api.{region}.amazonaws.com
```

### Drawbacks

- Extra hop adds ~10-20ms latency
- Another resource to manage
- Still need the Messaging API to be reachable from the HTTP API Gateway (may still need VPC link)

---

## Decision Matrix

| Criteria | Option A (VPC Lambda) | Option B (Private HTTP API GW) |
|----------|----------------------|-------------------------------|
| Latency | Direct, low | +10-20ms |
| Complexity | VPC networking, security groups | Another API Gateway |
| Cost | NAT Gateway if not existing | HTTP API Gateway (pay per request) |
| Security | Network-level isolation | API key or IAM auth |
| Cold start impact | +1-2s on VPC Lambdas | No impact |
| Maintenance | Security group rules | Route configuration |

**Recommendation:** Use **Option A (VPC Lambda)** if you already have a VPC with NAT Gateway. Use **Option B** if you want to avoid VPC complexity.

---

## Verification

Regardless of which option you chose:

### Test Connectivity

From the Lambda console, test `ws-connect` with a mock visitor event:

```json
{
  "requestContext": {
    "connectionId": "test-connectivity-check"
  },
  "queryStringParameters": {
    "token": "invalid-token-for-connectivity-test",
    "type": "visitor"
  }
}
```

**Expected:** The function should return `{"statusCode": 401}` with a reason from the Messaging API (e.g., `"malformed_token"`). This proves the Lambda can reach the Messaging API, even though the token is invalid.

**If you get a timeout or connection error:** The connectivity is not working — check security groups, VPC configuration, or the internal URL.

### Checklist

- [ ] Connectivity approach chosen: Option A / Option B
- [ ] `MESSAGING_API_INTERNAL_URL` set on `ws-connect` and `ws-visitor-message`
- [ ] Lambda can reach Messaging API (connectivity test passes)
- [ ] If VPC Lambda: NAT Gateway or VPC Endpoints in place for internet access
- [ ] If VPC Lambda: Security group allows Lambda → Messaging API on port 8000

**Next:** [Phase 9 — Test Visitor Flows](./09-test-visitor-flows.md)
