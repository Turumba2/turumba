# Chatwoot vs Turumba 2.0: Competitive Analysis

**Date:** 2026-02-02
**Sources:**
- https://github.com/chatwoot/chatwoot
- https://www.chatwoot.com
- https://www.chatwoot.com/docs/product

## Overview

This document compares Chatwoot, a self-hosted customer support platform, with Turumba 2.0 to identify architectural differences, feature gaps, and opportunities for improvement.

Chatwoot positions itself as "the modern, open source, self-hosted customer support platform" and a direct alternative to Intercom and Zendesk.

---

## Product Focus

| Aspect | Chatwoot | Turumba 2.0 |
|--------|----------|-------------|
| **Primary Purpose** | Customer support/engagement platform | Multi-tenant account management platform |
| **Target Use Case** | Omnichannel customer conversations | User auth, accounts, roles, messaging (foundation) |
| **Maturity** | Production-ready, 20k+ GitHub stars | Early-stage, core infrastructure built |
| **Business Model** | Alternative to Intercom/Zendesk | Custom platform foundation |
| **Deployment** | Self-hosted or Cloud | Self-hosted |

---

## Architecture Comparison

| Component | Chatwoot | Turumba 2.0 |
|-----------|----------|-------------|
| **Architecture** | Monolithic (Rails) | Microservices |
| **Backend** | Ruby on Rails | FastAPI (Python) |
| **Frontend** | Vue.js (embedded) | Next.js 16 (separate monorepo) |
| **API Gateway** | None (Rails handles routing) | KrakenD with Go plugins |
| **Database** | PostgreSQL, Redis | PostgreSQL + MongoDB |
| **Auth** | Built-in (Devise) | AWS Cognito (external) |
| **Real-time** | ActionCable (WebSockets) | Not yet implemented |
| **Background Jobs** | Sidekiq | Not yet implemented |
| **Mobile Apps** | iOS + Android | Not implemented |

**Key Difference**: Chatwoot is a **monolith** optimized for a single product. Turumba is a **microservices foundation** designed for building multiple products/tenants.

---

## Technology Stack

### Chatwoot Stack
```
├── Ruby on Rails (monolith)
├── Vue.js (frontend in same repo)
├── PostgreSQL (primary database)
├── Redis (caching, ActionCable, Sidekiq)
├── Sidekiq (background jobs)
├── ActionCable (WebSocket)
└── Docker
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

| Feature | Chatwoot | Turumba 2.0 |
|---------|----------|-------------|
| **Multi-tenancy** | Single workspace focus | Core architecture (accounts, roles per account) |
| **User Management** | Basic user/agent management | Comprehensive CRUD with filtering/sorting |
| **Role-Based Access** | Agent roles (admin, agent) | Flexible JSON permissions per role |
| **Omnichannel Inbox** | ✅ (core feature) | ❌ Not implemented |
| **Live Chat Widget** | ✅ | ❌ |
| **Email Integration** | ✅ | ❌ |
| **WhatsApp** | ✅ | ❌ |
| **Facebook/Instagram** | ✅ | ❌ |
| **Twitter** | ✅ | ❌ |
| **SMS** | ✅ | ❌ |
| **API Channel** | ✅ Custom inboxes | ❌ |
| **AI Assistant (Captain)** | ✅ With memory, docs, FAQ gen | ❌ |
| **Agent Bots** | ✅ Automated workflows | ❌ |
| **Knowledge Base** | ✅ Help Center | ❌ |
| **Canned Responses** | ✅ Saved reply templates | ❌ |
| **Pre-chat Forms** | ✅ | ❌ |
| **Campaigns** | ✅ Outreach messaging | ❌ |
| **Interactive Messages** | ✅ Rich media support | ❌ |
| **Automation Rules** | ✅ | ❌ |
| **Dashboard Apps** | ✅ Integrated productivity | ❌ |
| **Webhooks** | ✅ | ❌ |
| **Labels & Custom Attributes** | ✅ | ❌ |
| **Conversation Filters** | ✅ Advanced filtering | ✅ Generic filter system |
| **Round-robin Assignment** | ✅ | ❌ |
| **Custom Segments** | ✅ Contact grouping | ❌ |
| **Reports & Analytics** | ✅ Overview, CSAT, Conversations, Bot, SLA | ❌ |
| **Mobile Apps** | ✅ iOS + Android | ❌ |
| **Multi-language** | ✅ Multiple languages | ❌ |
| **Contact Management** | ✅ Basic | ✅ (MongoDB-backed, flexible metadata) |
| **API Gateway** | ❌ | ✅ KrakenD with context enrichment |
| **Generic CRUD Pattern** | ❌ (Rails conventions) | ✅ Reusable base controller |

---

## Chatwoot Core Features (Detailed)

### Communication Channels

**Website Live Chat**
- Embeddable JavaScript widget
- Customizable appearance
- Pre-chat forms for data collection
- File sharing and attachments
- Typing indicators

**Email Integration**
- Full IMAP/SMTP support
- Email threading
- Signature management
- Auto-reply configuration

**Social Media Channels**
- Facebook Messenger
- Instagram DM (via Facebook)
- Twitter DM
- WhatsApp Business API
- Telegram
- Line
- SMS (via providers)

**API Channel Inboxes**
- Create custom channel integrations
- Webhook-based message handling
- Flexible for any platform

### Captain AI Agent

Chatwoot's AI assistant with advanced capabilities:
- **Memory**: Remembers conversation context
- **Document Knowledge**: Learns from uploaded documents
- **FAQ Generation**: Auto-generates responses from knowledge base
- **Automated Responses**: Handles routine queries
- **Human Handoff**: Transfers complex issues to agents

### Agent Bots

Automated agent workflows:
- Greeting messages
- Qualification questions
- Routing logic
- Auto-assignment
- Canned response suggestions

### Conversation Management

- **Assignment**: Manual or round-robin
- **Labels**: Color-coded categorization
- **Custom Attributes**: Flexible metadata
- **Conversation Filters**: Advanced search and filtering
- **Collision Detection**: Prevent duplicate responses
- **Internal Notes**: Private team communication
- **@mentions**: Tag team members
- **Canned Responses**: Saved reply templates with shortcuts

### Help Center (Knowledge Base)

- Article management with rich editor
- Category organization
- Search functionality
- Public or portal-only visibility
- Multi-language support
- SEO optimization

### Campaigns

- **Ongoing Campaigns**: Persistent messaging
- **One-off Campaigns**: Single broadcast
- **Targeting**: Based on segments
- **Scheduling**: Time-based delivery
- **Analytics**: Open and response tracking

### Reports & Analytics

- **Overview Dashboard**: Key metrics at a glance
- **Conversation Reports**: Volume, resolution, response times
- **CSAT Reports**: Customer satisfaction scores
- **Agent Reports**: Performance per agent
- **Bot Reports**: AI agent performance
- **SLA Reports**: Compliance tracking
- **Download**: Export data as CSV

### Integrations

**Native Integrations:**
- **Slack**: Answer conversations from Slack
- **Dialogflow**: AI chatbot integration
- **Dyte**: Video call support
- **Linear**: Issue tracking
- **Google Translate**: Auto-translation

**Webhooks:**
- Conversation events
- Message events
- Contact events
- Custom payload configuration

### Mobile Apps

- iOS app (App Store)
- Android app (Play Store)
- Push notifications
- Full conversation management
- Agent availability toggle

---

## Turumba Competitive Advantages

### 1. Microservices Foundation
- Easier to scale individual components independently
- Clear service boundaries (account, messaging, gateway)
- Technology flexibility per service
- Independent deployment cycles

### 2. Multi-tenant by Design
- Account isolation is core architecture, not bolted on
- Users can belong to multiple accounts
- Roles are account-specific with custom permissions
- B2B SaaS ready out of the box

### 3. Flexible Permission System
- JSON-based permissions vs fixed roles
- Custom permissions per role per account
- Extensible without schema changes
- Fine-grained access control

### 4. API Gateway
- Request enrichment via Go plugins
- Rate limiting capabilities
- Plugin extensibility
- Single entry point for all services
- Context injection (user roles, account IDs)

### 5. Database Flexibility
- PostgreSQL for relational data (users, accounts, roles)
- MongoDB for flexible documents (contacts, future audit logs)
- Best tool for each data type
- Chatwoot is PostgreSQL-only

### 6. Modern Stack
- FastAPI (async Python, auto-generated OpenAPI docs)
- Next.js 16 with App Router
- React 19
- TypeScript throughout frontend
- vs Ruby on Rails (synchronous, older patterns)

### 7. Generic CRUD Pattern
- Reusable base controller
- Pluggable filter/sort strategies
- Database-agnostic operations
- 11+ filter operators out of the box

---

## What Turumba Could Learn from Chatwoot

### Immediate Opportunities

1. **Real-time Communication**
   - WebSocket-based live updates
   - ActionCable equivalent for FastAPI (consider `websockets` or `Socket.IO`)
   - Presence indicators (online/offline)
   - Typing indicators

2. **Unified Inbox Pattern**
   - Conversation-centric data model
   - Message threading
   - Assignment and routing
   - Status workflow (open, pending, resolved)

3. **Widget System**
   - Embeddable chat widget for customer websites
   - JavaScript SDK for easy integration
   - Customization options (colors, position, greeting)
   - Pre-chat forms

### Medium-term Opportunities

4. **Channel Integrations**
   - Start with email (IMAP/SMTP)
   - Add WhatsApp Business API
   - Social media channels
   - API channel for custom integrations

5. **Canned Responses**
   - Template management system
   - Variable substitution ({{name}}, {{company}})
   - Keyboard shortcuts
   - Category organization

6. **Campaigns & Automation**
   - Outreach messaging
   - Trigger-based automation rules
   - Scheduled messages
   - Audience segmentation

7. **Contact Enrichment**
   - Conversation history on contact profiles
   - Custom attributes
   - Segmentation
   - Activity timeline

### Long-term Opportunities

8. **AI Integration (Captain-like)**
   - LLM integration for auto-responses
   - Document knowledge base
   - FAQ generation
   - Sentiment analysis
   - Smart routing

9. **Analytics Dashboard**
   - Conversation metrics
   - Agent performance
   - CSAT tracking
   - SLA compliance
   - Export capabilities

10. **Knowledge Base**
    - Self-service help center
    - Article management with rich editor
    - Search functionality
    - Multi-language support

11. **Mobile Apps**
    - React Native for iOS/Android
    - Push notifications
    - Agent availability management

---

## Data Model Comparison

### Chatwoot (PostgreSQL)
```
accounts
├── id
├── name
├── locale
├── domain
└── settings (JSON)

users (agents)
├── id
├── email
├── name
├── role (administrator, agent)
└── accounts[] (M:N)

contacts (customers)
├── id
├── account_id
├── email, phone, name
├── custom_attributes (JSON)
└── additional_attributes (JSON)

inboxes (channels)
├── id
├── account_id
├── name
├── channel_type (web_widget, email, facebook, etc.)
└── channel_id (polymorphic)

conversations
├── id
├── account_id
├── inbox_id
├── contact_id
├── assignee_id
├── status (open, resolved, pending)
├── snoozed_until
└── custom_attributes (JSON)

messages
├── id
├── conversation_id
├── account_id
├── sender_type (Contact, User, AgentBot)
├── sender_id
├── content
├── message_type (incoming, outgoing, activity)
├── private (boolean - internal note)
└── attachments[]

labels
├── id
├── account_id
├── title
├── color
└── conversations[] (M:N)

canned_responses
├── id
├── account_id
├── short_code
├── content
└── attachments[]

campaigns
├── id
├── account_id
├── inbox_id
├── title
├── message
├── campaign_type (ongoing, one_off)
├── trigger_rules (JSON)
└── scheduled_at

automation_rules
├── id
├── account_id
├── name
├── event_name
├── conditions (JSON)
├── actions (JSON)
└── active (boolean)
```

### Turumba 2.0 (PostgreSQL + MongoDB)
```
PostgreSQL:
users → accounts → roles → account_users (junction)

MongoDB:
contacts (flexible document storage)
```

**Gap Analysis**: Turumba lacks inbox, conversation, message, label, canned_response, campaign, and automation_rule models. These would be needed for customer engagement functionality.

---

## Recommendations for Turumba Roadmap

### Phase 1: Messaging Foundation (Short-term)
1. **Implement messaging-api**
   - Conversation model (account_id, inbox_id, contact_id, status)
   - Message model (conversation_id, sender, content, type)
   - Real-time updates via WebSocket

2. **Build inbox UI in web-core**
   - Conversation list with filters
   - Message thread view
   - Compose/reply functionality
   - Assignment UI

### Phase 2: Customer Engagement (Medium-term)
1. **Email channel integration**
   - IMAP/SMTP connection
   - Email-to-conversation mapping
   - Threading support

2. **Chat widget SDK**
   - Embeddable JavaScript widget
   - Customization options
   - Anonymous visitor tracking
   - Pre-chat forms

3. **Productivity tools**
   - Canned responses
   - Labels and tags
   - Internal notes
   - Collision detection

### Phase 3: Intelligence & Scale (Long-term)
1. **AI-powered features**
   - LLM integration (OpenAI, Anthropic)
   - Auto-categorization
   - Suggested responses
   - Sentiment analysis

2. **Analytics**
   - Response time metrics
   - Resolution rates
   - Agent performance
   - CSAT surveys

3. **Additional channels**
   - WhatsApp Business
   - Social media DMs
   - API channel for custom integrations

4. **Knowledge Base**
   - Article management
   - Category organization
   - Search integration
   - Public portal

---

## Summary

| | Chatwoot | Turumba 2.0 |
|-|----------|-------------|
| **Strength** | Complete customer support product with AI, omnichannel, analytics | Flexible multi-tenant foundation with modern architecture |
| **Weakness** | Monolith limitations, harder to customize, single-tenant focus | Features not yet built |
| **Best For** | Teams needing ready-to-use support tool | Building custom multi-tenant platform |

Turumba has solid infrastructure (auth, multi-tenancy, API gateway, generic CRUD) that would be difficult to retrofit into Chatwoot. However, Chatwoot has years of feature development (omnichannel, AI, analytics, mobile apps) that represents significant effort to replicate.

**Strategic Position**: Turumba can differentiate by:
1. **Better multi-tenancy** - B2B SaaS use cases with account isolation
2. **API-first architecture** - Developer-friendly, embeddable
3. **Microservices flexibility** - Enterprise deployments, independent scaling
4. **Modern async stack** - Performance at scale
5. **Flexible permissions** - Custom RBAC per account

**Recommendation**: Don't try to replicate all of Chatwoot's features. Focus on:
1. Core messaging with real-time (messaging-api)
2. Chat widget for customer engagement
3. Email channel as first integration
4. AI features leveraging modern LLMs

The messaging-api skeleton is the logical next focus area for building toward customer engagement capabilities.
