# Papercups vs Turumba 2.0: Competitive Analysis

**Date:** 2026-02-02
**Source:** https://github.com/papercups-io/papercups
**GitHub Stars:** 5.9k
**Status:** ⚠️ Maintenance Mode (no new features)

## Overview

This document compares Papercups, a developer-friendly open-source live chat platform, with Turumba 2.0 to identify architectural differences, feature gaps, and opportunities for improvement.

---

## Product Focus

| Aspect | Papercups | Turumba 2.0 |
|--------|-----------|-------------|
| **Primary Purpose** | Developer-friendly live chat | Multi-tenant account management platform |
| **Target Use Case** | Website chat widget for startups | User auth, accounts, roles, messaging (foundation) |
| **Maturity** | Maintenance mode, 5.9k+ GitHub stars | Early-stage, core infrastructure built |
| **Business Model** | Intercom alternative for developers | Custom platform foundation |
| **Origin** | Ex-Airbnb engineers | - |

---

## Architecture Comparison

| Component | Papercups | Turumba 2.0 |
|-----------|-----------|-------------|
| **Architecture** | Monolithic (Phoenix) | Microservices |
| **Backend** | Elixir/Phoenix (59.2%) | FastAPI (Python) |
| **Frontend** | TypeScript/React (40.2%) | Next.js 16 (separate monorepo) |
| **API Gateway** | None (Phoenix handles routing) | KrakenD with Go plugins |
| **Database** | PostgreSQL | PostgreSQL + MongoDB |
| **Auth** | Built-in (Guardian) | AWS Cognito (external) |
| **Real-time** | Phoenix Channels (WebSocket) | Not yet implemented |
| **Concurrency** | BEAM VM (excellent) | Python async |

**Key Difference**: Papercups is a **minimalist live chat tool** built for performance with Elixir. Turumba is a **microservices foundation** designed for multi-tenant applications.

---

## Technology Stack

### Papercups Stack
```
├── Elixir / Phoenix Framework
├── Ecto (database ORM)
├── Phoenix Channels (WebSocket)
├── TypeScript (frontend)
├── React (chat widget + dashboard)
├── PostgreSQL
├── BEAM VM (concurrency)
└── Docker / Heroku
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

| Feature | Papercups | Turumba 2.0 |
|---------|-----------|-------------|
| **Multi-tenancy** | Account-based | Core architecture (accounts, roles per account) |
| **User Management** | Basic team management | Comprehensive CRUD with filtering/sorting |
| **Role-Based Access** | Admin/Member | Flexible JSON permissions per role |
| **Live Chat Widget** | ✅ (core feature) | ❌ Not implemented |
| **Real-time Messaging** | ✅ Phoenix Channels | ❌ |
| **Email Integration** | ✅ Basic | ❌ |
| **SMS Integration** | ✅ Twilio | ❌ |
| **Slack Integration** | ✅ | ❌ |
| **Mattermost Integration** | ✅ | ❌ |
| **React Widget** | ✅ | ❌ |
| **React Native Widget** | ✅ | ❌ |
| **Flutter Widget** | ✅ | ❌ |
| **Markdown Support** | ✅ | ❌ |
| **Emoji Support** | ✅ | ❌ |
| **File Attachments** | ✅ | ❌ |
| **Conversation Assignment** | ✅ | ❌ |
| **Canned Responses** | ❌ | ❌ |
| **Knowledge Base** | ❌ | ❌ |
| **Analytics** | Basic | ❌ |
| **Contact Management** | Basic customers | ✅ (MongoDB-backed, flexible metadata) |
| **API Gateway** | ❌ | ✅ KrakenD with context enrichment |
| **Generic CRUD Pattern** | ❌ | ✅ Reusable base controller |

---

## Papercups Core Features

### Chat Widget
- **Embeddable**: JavaScript snippet for websites
- **Customizable**: Colors, greeting, position
- **React Component**: `@papercups-io/chat-widget`
- **React Native**: Mobile app integration
- **Flutter**: Cross-platform mobile
- **Markdown**: Rich text formatting
- **Emoji**: Emoji picker and reactions
- **File Attachments**: Image and file sharing

### Real-time Messaging
- **Phoenix Channels**: WebSocket-based
- **High Concurrency**: BEAM VM handles millions of connections
- **Presence**: Online/offline indicators
- **Typing Indicators**: Real-time feedback
- **Read Receipts**: Message status

### Team Collaboration
- **Conversation Assignment**: Assign to team members
- **Internal Notes**: Private team notes
- **Collision Detection**: See who's replying
- **Team Inbox**: Shared conversation view
- **Prioritization**: Flag important conversations

### Integrations
- **Slack**: Receive and reply from Slack
- **Mattermost**: Self-hosted Slack alternative
- **Email**: Email notifications and replies
- **SMS**: Twilio integration for text messages
- **Webhooks**: Custom integrations
- **API**: RESTful API access

### Customer Management
- **Customer Profiles**: Basic info + metadata
- **Conversation History**: Full chat history
- **Browser Info**: User agent, location
- **Custom Metadata**: Arbitrary key-value pairs

### Developer Experience
- **Simple Setup**: Minimal configuration
- **Clean Codebase**: Well-structured Elixir/React
- **Self-hosted**: Full control over data
- **Docker**: Easy deployment
- **Heroku**: One-click deploy

---

## Turumba Competitive Advantages

### 1. Microservices Foundation
- Independent service scaling
- Clear service boundaries
- Technology flexibility
- Better for complex applications

### 2. Multi-tenant by Design
- Account isolation is core architecture
- Users can belong to multiple accounts
- Roles are account-specific
- Papercups has simpler account model

### 3. Flexible Permission System
- JSON-based permissions
- Custom permissions per role per account
- Extensible without schema changes
- Papercups has admin/member only

### 4. Active Development
- Turumba is actively developed
- Papercups is maintenance mode only
- Security updates only, no new features

### 5. Modern API Gateway
- KrakenD for high-performance routing
- Request enrichment via Go plugins
- Rate limiting capabilities
- Centralized API management

### 6. Richer Data Model
- PostgreSQL + MongoDB
- Better for complex contact data
- Papercups is PostgreSQL only

### 7. Python Ecosystem
- Larger developer pool
- More libraries available
- Elixir has smaller community

---

## What Turumba Could Learn from Papercups

### Immediate Opportunities

1. **Phoenix Channels Pattern**
   - WebSocket room management
   - Presence tracking
   - Real-time message delivery
   - Typing indicators

2. **Chat Widget Architecture**
   ```
   Widget SDK (React/JS)
        ↓
   WebSocket Connection
        ↓
   Phoenix Channel (room per conversation)
        ↓
   Database (PostgreSQL)
   ```

3. **Simple Conversation Model**
   - Conversation = container
   - Messages = content
   - Customer = visitor
   - User = agent
   - Simple status (open, closed)

### Medium-term Opportunities

4. **Widget SDKs**
   - React component library
   - React Native component
   - Vanilla JavaScript embed
   - Flutter plugin

5. **Slack Integration Pattern**
   - Incoming webhook for notifications
   - Slash commands for replies
   - Channel per conversation
   - Thread replies

6. **Customer Identification**
   - Anonymous visitors (token-based)
   - Identified customers (email/id)
   - Metadata enrichment
   - Session tracking

### Long-term Opportunities

7. **BEAM-like Concurrency**
   - Consider Go for real-time service
   - Or Python with proper async patterns
   - Connection pooling strategies

8. **Multi-platform Widgets**
   - iOS native SDK
   - Android native SDK
   - Desktop app (Electron)

---

## Data Model Comparison

### Papercups (PostgreSQL)
```
accounts
├── id
├── company_name
├── settings (JSON)
├── subscription_plan
└── inserted_at

users (agents)
├── id
├── account_id
├── email
├── role (admin, user)
└── profile (JSON)

customers
├── id
├── account_id
├── email
├── name
├── external_id
├── metadata (JSON)
├── browser, os
└── current_url

conversations
├── id
├── account_id
├── customer_id
├── assignee_id
├── status (open, closed)
├── priority
├── source (chat, slack, email)
├── metadata (JSON)
└── read (boolean)

messages
├── id
├── conversation_id
├── customer_id (if from customer)
├── user_id (if from agent)
├── body
├── attachments[]
├── private (internal note)
├── type (reply, note)
└── seen_at

slack_conversation_threads
├── id
├── conversation_id
├── slack_channel
├── slack_thread_ts
└── account_id
```

### Turumba 2.0 (PostgreSQL + MongoDB)
```
PostgreSQL:
users → accounts → roles → account_users (junction)

MongoDB:
contacts (flexible document storage)
```

**Gap Analysis**: Papercups has a clean, minimal model for live chat. Turumba would need: conversations, messages, and a customer/visitor model integrated with existing contacts.

---

## Deployment & Resource Comparison

| Aspect | Papercups | Turumba 2.0 |
|--------|-----------|-------------|
| **Min RAM** | 512MB | ~512MB |
| **Min CPU** | 1 core | 1 core |
| **Concurrency** | Excellent (BEAM) | Good (async Python) |
| **Scaling** | Vertical (BEAM handles it) | Horizontal (microservices) |
| **Docker** | ✅ | ✅ |
| **Heroku** | ✅ One-click | Manual |
| **Dependencies** | PostgreSQL only | PostgreSQL + MongoDB |

---

## Why Papercups is in Maintenance Mode

**Observations**:
1. Small team (ex-Airbnb engineers)
2. Competed against well-funded alternatives
3. SaaS business model challenges
4. Open source sustainability issues

**Lessons for Turumba**:
1. Sustainable business model needed
2. Community building is essential
3. Feature parity with competitors takes time
4. Focus on differentiation, not feature matching

---

## Recommendations for Turumba Roadmap

### If Building Live Chat Features

**Phase 1: Core Chat**
1. WebSocket infrastructure (Socket.IO or native)
2. Conversation model (similar to Papercups)
3. Message model with real-time delivery
4. Basic chat widget (React component)

**Phase 2: Agent Experience**
1. Agent inbox UI
2. Conversation assignment
3. Internal notes
4. Typing indicators

**Phase 3: Integrations**
1. Slack integration
2. Email notifications
3. Webhook system
4. Mobile SDKs

### Key Patterns to Adopt

1. **Conversation Rooms**
   ```python
   # WebSocket room per conversation
   async def join_conversation(websocket, conversation_id):
       room = f"conversation:{conversation_id}"
       await websocket.join(room)
   ```

2. **Customer Identification**
   ```python
   # Anonymous vs identified visitors
   if customer_email:
       customer = await get_or_create_customer(email=customer_email)
   else:
       customer = await create_anonymous_visitor(token=session_token)
   ```

3. **Widget Embed Pattern**
   ```javascript
   // Simple embed code
   <script>
     window.Turumba = { accountId: "xxx", ... };
   </script>
   <script src="https://widget.turumba.io/v1/widget.js"></script>
   ```

---

## Summary

| | Papercups | Turumba 2.0 |
|-|-----------|-------------|
| **Strength** | Clean, fast, developer-friendly | Flexible multi-tenant foundation |
| **Weakness** | Maintenance mode, limited features | Features not yet built |
| **Best For** | Simple live chat needs | Building custom multi-tenant platform |

**Strategic Assessment**:

Papercups excels at:
- Minimalist design
- Developer experience
- Real-time performance (Elixir/BEAM)
- Clean codebase

Turumba can differentiate by:
1. **Active development** - Papercups is maintenance mode
2. **Richer features** - Can build beyond basic chat
3. **Multi-tenancy** - Better B2B support
4. **Modern stack** - Python has larger ecosystem
5. **Extensibility** - Microservices allow growth

**Recommendation**: Papercups is an **excellent reference implementation** for live chat. Its clean data model and real-time patterns should be studied. However, since it's in maintenance mode, Turumba should implement similar functionality with its own architecture rather than forking Papercups.

**Most valuable patterns from Papercups**:
1. Simple conversation/message model
2. WebSocket room per conversation
3. Customer identification (anonymous vs identified)
4. Clean widget SDK design
5. Slack integration approach
