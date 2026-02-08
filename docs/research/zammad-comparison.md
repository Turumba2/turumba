# Zammad vs Turumba 2.0: Competitive Analysis

**Date:** 2026-02-02
**Sources:**
- https://github.com/zammad/zammad
- https://zammad.com/en
- https://zammad.com/en/product/features

**GitHub Stars:** 5.4k
**Founded:** 2016
**Notable Customers:** Amnesty International, De'Longhi, Nextcloud

## Overview

This document compares Zammad, an open-source web-based helpdesk and customer support system, with Turumba 2.0 to identify architectural differences, feature gaps, and opportunities for improvement.

---

## Product Focus

| Aspect | Zammad | Turumba 2.0 |
|--------|--------|-------------|
| **Primary Purpose** | Helpdesk ticketing system | Multi-tenant account management platform |
| **Target Use Case** | IT support, customer service tickets | User auth, accounts, roles, messaging (foundation) |
| **Maturity** | Production-ready, 5.4k+ GitHub stars | Early-stage, core infrastructure built |
| **Business Model** | Zendesk/Freshdesk alternative | Custom platform foundation |
| **Governance** | Zammad Foundation (independent) | - |

---

## Architecture Comparison

| Component | Zammad | Turumba 2.0 |
|-----------|--------|-------------|
| **Architecture** | Monolithic (Rails) | Microservices |
| **Backend** | Ruby on Rails (53%) | FastAPI (Python) |
| **Frontend** | Vue.js + TypeScript (28%) | Next.js 16 (separate monorepo) |
| **API Gateway** | None (Rails handles routing) | KrakenD with Go plugins |
| **Database** | PostgreSQL + Elasticsearch | PostgreSQL + MongoDB |
| **Auth** | Built-in (Devise) + SSO | AWS Cognito (external) |
| **Real-time** | WebSocket (ActionCable) | Not yet implemented |
| **Search** | Elasticsearch (required) | Not yet implemented |

**Key Difference**: Zammad is a **ticket-centric helpdesk** optimized for support workflows. Turumba is a **microservices foundation** designed for multi-tenant applications.

---

## Technology Stack

### Zammad Stack
```
├── Ruby on Rails (backend)
├── Vue.js 3 (frontend)
├── TypeScript (20.8%)
├── CoffeeScript (legacy, 9.8%)
├── PostgreSQL (primary database)
├── Elasticsearch (full-text search)
├── Redis (caching, WebSocket)
├── Vite (build tool)
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

| Feature | Zammad | Turumba 2.0 |
|---------|--------|-------------|
| **Multi-tenancy** | Groups/Organizations | Core architecture (accounts, roles per account) |
| **User Management** | Agents, customers, organizations | Comprehensive CRUD with filtering/sorting |
| **Role-Based Access** | Fixed roles + permissions | Flexible JSON permissions per role |
| **Ticketing System** | ✅ (core feature) | ❌ Not implemented |
| **Email Channel** | ✅ Full integration | ❌ |
| **Live Chat** | ✅ Smart Chat | ❌ |
| **SMS Integration** | ✅ Bidirectional | ❌ |
| **Social Media** | ✅ (Twitter, Facebook, Telegram) | ❌ |
| **WhatsApp** | ✅ Business integration | ❌ |
| **Knowledge Base** | ✅ Built-in | ❌ |
| **SLA Management** | ✅ Full SLA/escalations | ❌ |
| **Time Tracking** | ✅ Per-ticket tracking | ❌ |
| **Full-text Search** | ✅ Elasticsearch (40GB < 3s) | ❌ |
| **Workflows/Automation** | ✅ Core Workflows | ❌ |
| **Customer Portal** | ✅ Self-service | ❌ |
| **Analytics/Reports** | ✅ Dashboard, Grafana | ❌ |
| **Contact Management** | Organizations + Customers | ✅ (MongoDB-backed, flexible metadata) |
| **API Gateway** | ❌ | ✅ KrakenD with context enrichment |
| **Generic CRUD Pattern** | ❌ (Rails conventions) | ✅ Reusable base controller |

---

## Zammad Core Features

### Ticketing System
- **Ticket Creation**: Email, web form, API, phone
- **Ticket Number**: Configurable ID format
- **Tags**: Custom categorization
- **Priority & Status**: Configurable workflows
- **Parent/Child Tickets**: Hierarchical relationships
- **Merge/Split**: Combine or divide tickets
- **Duplicate Detection**: Automatic warnings
- **Collision Detection**: Real-time edit warnings

### Communication Channels
- **Email**: Full IMAP/SMTP integration with threading
- **Smart Chat**: 7x faster than email resolution
- **SMS**: Bidirectional via Twilio, MessageBird
- **Twitter/X**: Mentions and DM monitoring
- **Facebook**: Comment and message handling
- **Telegram**: Direct integration
- **WhatsApp Business**: Official API integration
- **Phone/CTI**: Sipgate, Placetel integration

### SLA & Escalations
- Response time SLAs
- Resolution time SLAs
- Automatic escalation
- Calendar-based SLAs
- VIP customer prioritization
- Out-of-office handling

### Productivity Features
- **Text Modules**: Canned responses with shortcuts
- **Templates**: Pre-configured ticket templates
- **Autosave**: Automatic work preservation
- **Multiple Tabs**: Work on several tickets simultaneously
- **Dashboard**: Overview of tasks and metrics
- **Full-text Search**: Sub-3-second search on 40GB data
- **Permanent Marking**: Highlight important passages

### Customer Management
- **Organizations**: Company-level grouping
- **Customer Profiles**: Contact details + ticket history
- **VIP Status**: Priority handling
- **Custom Attributes**: Flexible field definitions
- **Customer Portal**: Self-service ticket tracking

### Security & Administration
- **Two-Factor Authentication**: TOTP support
- **SSO**: SAML, OpenID Connect, Shibboleth
- **LDAP**: Directory integration
- **OAuth**: Twitter, Facebook, LinkedIn, Google
- **S/MIME & PGP**: Email encryption
- **Audit Logs**: Historization of all changes

### Integrations

**Communication & Telephony:**
- Slack
- Microsoft Teams
- Sipgate (telephony)
- Placetel (telephony)
- CTI (Computer Telephony Integration)
- iCal calendar

**Enterprise Systems:**
- Microsoft 365
- Microsoft Exchange
- LDAP and Active Directory
- REST API and Webhooks

**Monitoring & IT Ops:**
- Nagios
- Checkmk
- Monit
- icinga
- i-doit (CMDB)

**Development:**
- GitHub
- GitLab

**Analytics & Visualization:**
- Grafana
- Kibana
- Clearbit (data enrichment)

**Data Import:**
- CSV Import
- Archive Import

### Multilingual Support
- 40+ interface languages
- Auto language detection on tickets
- Agent-specific language preferences

### Use Cases (from Landing Page)

**1. Product/Service Support**
- Customer relationship management
- Custom fields for product-specific data
- Conversation history tracking

**2. Retail & Wholesale**
- ERP system connectivity
- Product-specific views
- Order tracking integration

**3. IT Service Desk**
- Self-service portals
- Multi-tier support workflows
- LDAP automation for user provisioning

### Upcoming Features (v7.0)
- AI features currently in beta testing
- Enhanced automation capabilities

---

## Turumba Competitive Advantages

### 1. Microservices Foundation
- Independent service scaling
- Clear service boundaries
- Technology flexibility
- Easier to maintain long-term

### 2. Multi-tenant by Design
- Account isolation is core architecture
- Users can belong to multiple accounts
- Roles are account-specific
- Zammad uses groups/orgs (less flexible)

### 3. Flexible Permission System
- JSON-based permissions
- Custom permissions per role per account
- Extensible without schema changes
- Zammad has fixed permission system

### 4. Modern API Gateway
- KrakenD for high-performance routing
- Request enrichment via Go plugins
- Rate limiting capabilities
- Centralized API management

### 5. Database Flexibility
- PostgreSQL for relational data
- MongoDB for flexible documents
- Zammad requires Elasticsearch (heavy dependency)

### 6. Modern Stack
- FastAPI (async Python)
- Auto-generated OpenAPI docs
- Next.js 16 with App Router
- React 19
- vs Rails + CoffeeScript legacy

### 7. Simpler Dependencies
- No Elasticsearch requirement
- Lower resource footprint
- Easier initial deployment

---

## What Turumba Could Learn from Zammad

### Immediate Opportunities

1. **Ticket Data Model**
   - Ticket entity with states, priorities, tags
   - Agent assignment and ownership
   - Customer/requester association
   - Parent/child relationships

2. **Email Integration Pattern**
   - IMAP polling for inbound
   - SMTP for outbound
   - Threading by message-id
   - Email-to-ticket conversion

3. **SLA Framework**
   - Response time tracking
   - Resolution time tracking
   - Escalation triggers
   - Business hours awareness

### Medium-term Opportunities

4. **Knowledge Base**
   - Article CRUD with categories
   - Search integration
   - Public/internal visibility
   - Version history

5. **Core Workflows**
   - Trigger-based automation
   - Dynamic field visibility
   - Auto-assignment rules
   - Notification rules

6. **Customer Portal**
   - Ticket submission form
   - Ticket status tracking
   - Self-service features
   - Branding customization

### Long-term Opportunities

7. **Full-text Search**
   - Elasticsearch integration (optional)
   - Attachment search
   - Fast large-scale search

8. **Analytics & Reporting**
   - First response time metrics
   - Resolution time metrics
   - Agent performance
   - SLA compliance rates

9. **Telephony Integration**
   - CTI (Computer Telephony Integration)
   - Click-to-call
   - Call logging
   - Screen pop

---

## Data Model Comparison

### Zammad (PostgreSQL + Elasticsearch)
```
tickets
├── id
├── group_id (department)
├── customer_id
├── owner_id (agent)
├── organization_id
├── number (ticket #)
├── title
├── state_id, priority_id
├── escalation_at
├── first_response_at
├── close_at
└── tags[]

ticket_articles (messages)
├── id
├── ticket_id
├── type_id (email, note, phone, chat)
├── sender_id (customer, agent, system)
├── from, to, cc, subject
├── body
├── attachments[]
└── internal (boolean)

organizations
├── id
├── name
├── domain
├── shared (boolean)
└── custom_attributes

users
├── id
├── login, email
├── roles[]
├── groups[]
├── organization_id
└── preferences
```

### Turumba 2.0 (PostgreSQL + MongoDB)
```
PostgreSQL:
users → accounts → roles → account_users (junction)

MongoDB:
contacts (flexible document storage)
```

**Gap Analysis**: Turumba lacks ticket, article, organization, SLA, and workflow models. These would be needed for helpdesk functionality.

---

## Deployment & Resource Comparison

| Aspect | Zammad | Turumba 2.0 |
|--------|--------|-------------|
| **Min RAM** | 4GB+ (Elasticsearch heavy) | ~512MB |
| **Min CPU** | 2+ cores | 1 core |
| **Dependencies** | PostgreSQL, Elasticsearch, Redis | PostgreSQL, MongoDB |
| **Elasticsearch** | Required | Not needed |
| **Scaling** | Horizontal (app servers) | Service-level scaling |
| **Kubernetes** | ✅ Helm charts | ❌ Docker Compose only |

---

## Recommendations for Turumba Roadmap

### If Building Helpdesk/Ticketing Features

**Phase 1: Core Ticketing**
1. Ticket model (status, priority, assignment)
2. Ticket articles (messages/notes)
3. Email channel (IMAP polling)
4. Agent inbox UI

**Phase 2: Customer Experience**
1. Customer portal (ticket tracking)
2. Web form submission
3. Knowledge base (basic)
4. Canned responses

**Phase 3: Operations**
1. SLA management
2. Escalation rules
3. Basic workflows
4. Reporting dashboard

### If Staying Focused on Platform Foundation

Selectively adopt:
1. **Organization model** - Map to Turumba accounts
2. **Tag system** - Flexible categorization
3. **Audit logging** - Historization pattern
4. **Customer portal concept** - Self-service access

---

## Summary

| | Zammad | Turumba 2.0 |
|-|--------|-------------|
| **Strength** | Complete helpdesk with SLA, workflows, 40+ languages | Flexible multi-tenant foundation |
| **Weakness** | Heavy dependencies (Elasticsearch), Rails monolith | Features not yet built |
| **Best For** | IT helpdesk, customer support teams | Building custom multi-tenant platform |

**Strategic Assessment**:

Zammad excels at:
- Traditional helpdesk workflows
- Email-centric support
- SLA management
- Enterprise compliance (audit, encryption)

Turumba can differentiate by:
1. **Multi-tenant B2B** - Multiple organizations on one instance
2. **Modern architecture** - Microservices vs Rails monolith
3. **Lighter footprint** - No Elasticsearch requirement
4. **API-first** - Better for building custom frontends
5. **Flexible permissions** - JSON-based vs fixed roles

**Recommendation**: If building helpdesk features, adopt Zammad's data model patterns (tickets, articles, SLAs) but implement them in Turumba's modern microservices architecture. Avoid the Elasticsearch dependency unless search is critical.
