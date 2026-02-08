# Rocket.Chat vs Turumba 2.0: Competitive Analysis

**Date:** 2026-02-02
**Sources:**
- https://github.com/RocketChat/Rocket.Chat
- https://rocket.chat/
- https://docs.rocket.chat/

**GitHub Stars:** 44.5k

## Overview

This document compares Rocket.Chat, the largest open-source team collaboration and customer engagement platform, with Turumba 2.0 to identify architectural differences, feature gaps, and opportunities for improvement.

---

## Product Focus

| Aspect | Rocket.Chat | Turumba 2.0 |
|--------|-------------|-------------|
| **Primary Purpose** | Team collaboration + omnichannel customer engagement | Multi-tenant account management platform |
| **Target Use Case** | Secure internal/external communications | User auth, accounts, roles, messaging (foundation) |
| **Maturity** | Production-ready, 44.5k+ GitHub stars | Early-stage, core infrastructure built |
| **Business Model** | Slack/Teams alternative + customer service | Custom platform foundation |
| **Notable Users** | Deutsche Bahn, US Navy, Credit Suisse | - |

---

## Architecture Comparison

| Component | Rocket.Chat | Turumba 2.0 |
|-----------|-------------|-------------|
| **Architecture** | Monolithic (Meteor-based) | Microservices |
| **Backend** | Node.js/Meteor (TypeScript 94%) | FastAPI (Python) |
| **Frontend** | React (embedded) | Next.js 16 (separate monorepo) |
| **API Gateway** | Built-in (REST + WebSocket) | KrakenD with Go plugins |
| **Database** | MongoDB | PostgreSQL + MongoDB |
| **Auth** | Built-in (multiple providers) | AWS Cognito (external) |
| **Real-time** | Meteor DDP + WebSocket | Not yet implemented |
| **Deployment** | Docker, K8s, Air-gapped | Docker Compose |

**Key Difference**: Rocket.Chat is a **full-featured collaboration platform** with team chat at its core. Turumba is a **microservices foundation** focused on multi-tenant account management.

---

## Technology Stack

### Rocket.Chat Stack
```
├── Node.js / Meteor Framework
├── TypeScript (93.8%)
├── React (frontend)
├── MongoDB (primary database)
├── Redis (caching, pub/sub)
├── WebSocket (real-time)
├── Apps-Engine (plugins)
└── Docker / Kubernetes
```

### Turumba 2.0 Stack
```
├── FastAPI (account-api microservice)
├── FastAPI (messaging-api microservice - skeleton)
├── KrakenD Gateway (Go plugins)
├── Next.js 16 (Turborepo monorepo)
├── PostgreSQL + MongoDB
├── AWS Cognito
└── Docker Compose
```

---

## Feature Comparison

| Feature | Rocket.Chat | Turumba 2.0 |
|---------|-------------|-------------|
| **Multi-tenancy** | Workspaces (enterprise) | Core architecture (accounts, roles per account) |
| **User Management** | Full team/user management | Comprehensive CRUD with filtering/sorting |
| **Role-Based Access** | Granular RBAC | Flexible JSON permissions per role |
| **Team Chat** | ✅ (core feature) | ❌ Not implemented |
| **Channels/Rooms** | ✅ Public, private, DM | ❌ |
| **Voice/Video Calls** | ✅ Native + Jitsi | ❌ |
| **Screen Sharing** | ✅ | ❌ |
| **Live Chat Widget** | ✅ Omnichannel | ❌ |
| **WhatsApp Integration** | ✅ | ❌ |
| **SMS Integration** | ✅ | ❌ |
| **Email Integration** | ✅ | ❌ |
| **End-to-End Encryption** | ✅ | ❌ |
| **Federation** | ✅ Matrix protocol | ❌ |
| **Air-gapped Deployment** | ✅ (DoD IL6 certified) | ❌ |
| **AI Features** | ✅ Privacy-first AI | ❌ |
| **App Marketplace** | ✅ 100+ apps | ❌ |
| **Contact Management** | Basic | ✅ (MongoDB-backed, flexible metadata) |
| **API Gateway** | Built-in | ✅ KrakenD with context enrichment |
| **Generic CRUD Pattern** | ❌ | ✅ Reusable base controller |

---

## Rocket.Chat Core Features

### Team Collaboration
- **Channels**: Public and private channels for team communication
- **Direct Messages**: 1:1 and group DMs
- **Threads**: Conversation threading for organized discussions
- **Reactions**: Emoji reactions on messages
- **Mentions**: @mentions for notifications
- **Search**: Full-text search across messages and files
- **File Sharing**: Document and media sharing

### Voice & Video
- Native voice calls
- Video conferencing
- Screen sharing
- Integration with Jitsi, BigBlueButton

### Omnichannel (Customer Service)
- Live chat widget for websites
- WhatsApp Business integration
- SMS integration
- Email-to-ticket conversion
- Facebook Messenger
- Telegram
- Instagram DM
- Routing and queue management
- Canned responses
- Analytics and reports

### Security & Compliance
- End-to-end encryption (E2EE)
- Two-factor authentication (2FA)
- SSO (SAML, LDAP, OAuth)
- Audit logs with comprehensive activity tracking
- Data retention policies (configurable)
- GDPR compliance tools
- HIPAA compliance (enterprise)
- **DoD Authorization (ATO up to IL6)** - Authorized for classified networks (NIPRNet, SIPRNet, JWICS)
- Air-gapped deployment for isolated networks
- **Zero-trust security model**
- SOC 2 certification
- No foreign jurisdiction exposure
- Fine-grained access controls by classified program

### Notable Enterprise Customers
- U.S. Department of Defense
- U.S. Army
- U.S. Air Force
- BAE Systems
- General Dynamics
- Audi
- City of Cologne
- Swedish Electrical Safety Board
- EU institutions

### Federation & Interoperability
- Matrix protocol support
- Cross-server communication
- Bridge to other platforms
- Federated communications across military, intergovernmental, and public-private coalitions
- Cross-organization collaboration with agencies and allies

### Use Cases (from Landing Page)
- **Command and Control Operations** - Military/defense communications
- **Emergency Preparedness** - Disaster response coordination
- **Out-of-band Communications** - Operational continuity
- **Sovereign Collaboration** - Government/defense agencies
- **Skype for Business Migration** - Enterprise replacement
- **DevOps & Digital Transformation**
- **Customer Service**
- **Remote Work**

### AI & Automation
- Privacy-first AI assistant
- Automated responses
- Sentiment analysis
- Message translation
- Chatbot integration

### Apps & Integrations
- Apps-Engine for custom apps
- Marketplace with 100+ apps
- Webhooks
- REST API
- GraphQL API
- SDK for embedding

---

## Turumba Competitive Advantages

### 1. Microservices Foundation
- Clear service boundaries (account, messaging, gateway)
- Independent scaling per service
- Technology flexibility per service
- Easier to maintain and evolve

### 2. Multi-tenant by Design
- Account isolation is core architecture
- Users can belong to multiple accounts
- Roles are account-specific
- Not an enterprise add-on like Rocket.Chat workspaces

### 3. Flexible Permission System
- JSON-based permissions vs fixed roles
- Custom permissions per role per account
- Extensible without schema changes

### 4. Modern API Gateway
- KrakenD for high-performance routing
- Request enrichment via Go plugins
- Rate limiting capabilities
- Plugin extensibility

### 5. Database Flexibility
- PostgreSQL for relational data (users, accounts, roles)
- MongoDB for flexible documents (contacts, logs)
- Best tool for each data type
- Rocket.Chat is MongoDB-only

### 6. Simpler Deployment
- Focused feature set = easier to deploy
- Lower resource requirements
- Suitable for smaller teams/projects

### 7. Modern Python Stack
- FastAPI (async, auto-generated OpenAPI docs)
- Cleaner than Meteor's callback-heavy patterns
- Easier to find Python developers

---

## What Turumba Could Learn from Rocket.Chat

### Immediate Opportunities

1. **Real-time Communication**
   - WebSocket-based live updates
   - Pub/sub pattern for message delivery
   - Consider Socket.IO or native WebSockets

2. **Room/Channel Model**
   - Conversation containers (channels, DMs, groups)
   - Membership management
   - Permission per room

3. **Message Threading**
   - Reply-to functionality
   - Thread isolation
   - Thread notifications

### Medium-term Opportunities

4. **Live Chat Widget**
   - Embeddable JavaScript widget
   - Visitor tracking
   - Pre-chat forms
   - Customization options

5. **Federation Concepts**
   - Cross-organization communication
   - Decentralized architecture patterns
   - Matrix protocol integration

6. **Apps Engine Pattern**
   - Plugin architecture for extensibility
   - Sandboxed app execution
   - Marketplace model

### Long-term Opportunities

7. **Voice/Video Integration**
   - WebRTC for calls
   - Jitsi/BigBlueButton integration
   - Recording capabilities

8. **End-to-End Encryption**
   - Client-side encryption
   - Key management
   - Encrypted file sharing

9. **Compliance Features**
   - Audit logging
   - Data retention policies
   - Export tools for legal requests

---

## Data Model Comparison

### Rocket.Chat (MongoDB)
```
users
├── _id
├── username, name, emails[]
├── roles[]
├── settings
└── services (auth providers)

rooms
├── _id
├── t (type: c, d, p, l)
├── name
├── usernames[]
├── u (creator)
└── customFields

messages
├── _id
├── rid (room id)
├── msg (content)
├── u (sender)
├── ts (timestamp)
├── attachments[]
└── reactions{}

livechatVisitors
├── _id
├── token
├── name, email, phone
└── customFields
```

### Turumba 2.0 (PostgreSQL + MongoDB)
```
PostgreSQL:
users → accounts → roles → account_users (junction)

MongoDB:
contacts (flexible document storage)
```

**Observation**: Rocket.Chat's data model is conversation-centric (rooms, messages). Turumba is user/account-centric. For messaging features, Turumba would need a similar room/message model.

---

## Deployment & Resource Comparison

| Aspect | Rocket.Chat | Turumba 2.0 |
|--------|-------------|-------------|
| **Min RAM** | 2GB+ | ~512MB |
| **Min CPU** | 2 cores+ | 1 core |
| **Storage** | MongoDB + uploads | PostgreSQL + MongoDB |
| **Scaling** | Complex (Meteor) | Service-level scaling |
| **Air-gapped** | ✅ Supported | ❌ Not designed for |
| **Kubernetes** | ✅ Helm charts | ❌ Docker Compose only |

---

## Recommendations for Turumba Roadmap

### If Building Team Collaboration Features

**Phase 1: Core Messaging**
1. Room/Channel model in messaging-api
2. Real-time message delivery (WebSocket)
3. Basic message CRUD operations

**Phase 2: Rich Messaging**
1. File attachments
2. Message threading
3. Reactions and mentions
4. Read receipts

**Phase 3: Advanced Features**
1. Voice/video (Jitsi integration)
2. Search (Elasticsearch)
3. Mobile push notifications

### If Focusing on Customer Engagement (Recommended)

**Phase 1: Live Chat**
1. Visitor/conversation model
2. Chat widget SDK
3. Agent assignment

**Phase 2: Omnichannel**
1. Email channel
2. WhatsApp Business
3. Unified inbox

**Phase 3: Intelligence**
1. Chatbot integration
2. Canned responses
3. Analytics

---

## Summary

| | Rocket.Chat | Turumba 2.0 |
|-|-------------|-------------|
| **Strength** | Complete collaboration platform with security certifications | Flexible multi-tenant foundation |
| **Weakness** | Complex, resource-heavy, Meteor limitations | Features not yet built |
| **Best For** | Teams needing Slack alternative + customer service | Building custom multi-tenant platform |

**Strategic Assessment**:

Rocket.Chat is a **comprehensive solution** but comes with:
- High complexity (Meteor framework)
- Heavy resource requirements
- Monolithic architecture limitations

Turumba can differentiate by:
1. **Focused scope** - Not trying to replace Slack
2. **Modern architecture** - True microservices vs monolith
3. **Multi-tenancy first** - B2B SaaS use cases
4. **Lower barrier** - Simpler deployment and operations
5. **API-first** - Better for embedding and integration

**Recommendation**: Don't try to replicate Rocket.Chat's full feature set. Focus on customer engagement (live chat, omnichannel) built on Turumba's superior multi-tenant foundation.
