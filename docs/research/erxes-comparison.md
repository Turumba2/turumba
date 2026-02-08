# erxes vs Turumba 2.0: Competitive Analysis

**Date:** 2026-02-02
**Sources:**
- https://github.com/erxes/erxes
- https://erxes.io/
- https://docs.erxes.io/

**GitHub Stars:** 3.9k
**Tagline:** "Experience Operating System (XOS)"
**Compliance:** GDPR compliant, Privacy Shield certified

## Overview

This document compares erxes, an open-source experience operating system (XOS), with Turumba 2.0 to identify architectural differences, feature gaps, and opportunities for improvement.

---

## Product Focus

| Aspect | erxes | Turumba 2.0 |
|--------|-------|-------------|
| **Primary Purpose** | All-in-one CRM/Marketing/Support platform | Multi-tenant account management platform |
| **Target Use Case** | Unified marketing, sales, support operations | User auth, accounts, roles, messaging (foundation) |
| **Maturity** | Production-ready, 3.9k+ GitHub stars | Early-stage, core infrastructure built |
| **Business Model** | HubSpot/Zendesk alternative | Custom platform foundation |
| **Philosophy** | "Experience Operating System" (XOS) | Multi-tenant microservices foundation |

---

## Architecture Comparison

| Component | erxes | Turumba 2.0 |
|-----------|-------|-------------|
| **Architecture** | Plugin-based monorepo | Microservices |
| **Backend** | Node.js/TypeScript (98.7%) | FastAPI (Python) |
| **Frontend** | React 18 + Rspack | Next.js 16 (Turborepo) |
| **API** | Apollo GraphQL + tRPC | REST API |
| **API Gateway** | Built-in | KrakenD with Go plugins |
| **Database** | MongoDB + Redis + Elasticsearch | PostgreSQL + MongoDB |
| **Auth** | Built-in | AWS Cognito (external) |
| **Build System** | Nx 20.0 + pnpm | Turborepo + pnpm |

**Key Difference**: erxes is an **all-in-one platform** with plugin architecture for marketing/sales/support. Turumba is a **focused microservices foundation** for multi-tenant account management.

---

## Technology Stack

### erxes Stack
```
├── Node.js / TypeScript (98.7%)
├── Express + Apollo Server v4
├── tRPC v11
├── React 18 + Rspack
├── Module Federation
├── TailwindCSS 4
├── MongoDB (primary)
├── Redis (caching)
├── Elasticsearch (search)
├── Nx 20.0 (monorepo)
├── pnpm 9.12
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

| Feature | erxes | Turumba 2.0 |
|---------|-------|-------------|
| **Multi-tenancy** | Organizations | Core architecture (accounts, roles per account) |
| **User Management** | Teams/Users/Permissions | Comprehensive CRUD with filtering/sorting |
| **Role-Based Access** | Permission system | Flexible JSON permissions per role |
| **Plugin System** | ✅ 100+ plugins | ❌ Not implemented |
| **Inbox/Support** | ✅ Frontline module | ❌ Not implemented |
| **CRM** | ✅ Sales module | ❌ |
| **Marketing Automation** | ✅ Marketing module | ❌ |
| **Live Chat Widget** | ✅ | ❌ |
| **Email Integration** | ✅ | ❌ |
| **Social Media** | ✅ (FB, Twitter) | ❌ |
| **Forms/Surveys** | ✅ | ❌ |
| **Segments** | ✅ Customer segmentation | ❌ |
| **Campaigns** | ✅ Email/SMS campaigns | ❌ |
| **Knowledge Base** | ✅ | ❌ |
| **Task Management** | ✅ | ❌ |
| **Calendar** | ✅ | ❌ |
| **E-commerce** | ✅ Commerce module | ❌ |
| **GraphQL API** | ✅ | ❌ (REST only) |
| **Contact Management** | ✅ Full CRM | ✅ (MongoDB-backed, flexible metadata) |
| **API Gateway** | Built-in | ✅ KrakenD with context enrichment |
| **Generic CRUD Pattern** | ❌ | ✅ Reusable base controller |

---

## erxes Core Features

### Core Modules (Built-in)
1. **My Inbox** - Unified communication inbox across all channels
2. **Contacts** - Customer/lead management with full CRM
3. **Products** - Product catalog and management
4. **Segments** - Dynamic customer segmentation
5. **Automation** - Workflow automation engine
6. **Documents** - Document management and templates

### Software Editions (from Landing Page)
- **Community Edition** - Open-source, self-hosted
- **Enterprise Edition** - Full-featured with support
- **Embed Edition** - Integration/embedding capability
- **Platform Edition** - Extensible framework for building
- **Infrastructure Edition** - Self-hosted deployment package

### Product Modules (from Landing Page)

**7 Main Product Categories:**

1. **Frontline** - Customer-facing operations
   - Omnichannel inbox
   - Knowledge Base
   - Live Chat Widget
   - Email Integration
   - Facebook Messenger
   - Gmail Integration
   - Calls (VoIP)

2. **Sales** - Sales management
   - Deals/Pipeline management
   - Tasks
   - Tickets
   - Growth Hacks
   - Calendar

3. **Marketing** - Campaign and engagement
   - Forms & Pop-ups
   - Email Campaigns
   - SMS Campaigns
   - Push Notifications
   - Segments
   - Engages (automation)

4. **Operation** - Business operations
   - Team Management
   - Timeclock
   - File Manager
   - Dashboard
   - Reports

5. **Commerce** - E-commerce capabilities
   - E-commerce platform
   - POS Integration
   - Inventory management
   - Pricing management

6. **Content** - Content management
   - Webbuilder
   - CMS
   - Template Management

7. **Communicate** - Communication tools
   - Multi-channel messaging
   - Internal communication
   - External customer communication

### Plugin Ecosystem
erxes has **100+ plugins** organized by domain, enabling unlimited customization through its plugin-based architecture.

### Technical Features
- **GraphQL API**: Full Apollo Server v4 implementation
- **tRPC v11**: Type-safe API calls
- **Module Federation**: Micro-frontend architecture via Rspack
- **Real-time**: WebSocket for live updates
- **Elasticsearch**: Full-text search
- **Redis**: Caching and pub/sub
- **GDPR Compliant**: Privacy controls built-in
- **Privacy Shield Certified**: Enterprise data protection

### Key Value Propositions (from Landing Page)
- "All channels your business operates on are connected and integrated"
- "Plugin-based architecture provides unlimited customization"
- "Complete control over your company's sensitive data with no third-party monitoring"
- "Help businesses build great experience for everyone involved"

### Mobile Apps
- Available on Google Play Store
- Available on Apple App Store

---

## Turumba Competitive Advantages

### 1. Microservices Architecture
- True microservices vs plugin monorepo
- Independent deployment per service
- Technology flexibility per service
- Cleaner service boundaries

### 2. Multi-tenant by Design
- Account isolation is core architecture
- Users can belong to multiple accounts
- Roles are account-specific
- erxes organizations are less flexible

### 3. Simpler Stack
- Fewer dependencies
- No Elasticsearch requirement
- No Redis requirement (for basic usage)
- Lower resource footprint

### 4. Modern API Gateway
- Dedicated KrakenD gateway
- Request enrichment via Go plugins
- Rate limiting capabilities
- Better API management

### 5. External Auth (Cognito)
- Enterprise SSO out of box
- MFA included
- Proven security
- erxes has built-in auth (more to maintain)

### 6. Focused Scope
- Not trying to be all-in-one
- Cleaner codebase
- Easier to understand and modify
- erxes is massive (27k+ commits)

### 7. REST API Simplicity
- Easier to integrate
- Better tooling support
- No GraphQL complexity
- OpenAPI auto-generation

---

## What Turumba Could Learn from erxes

### Immediate Opportunities

1. **Plugin Architecture Pattern**
   - Modular feature loading
   - Plugin registration system
   - Plugin-to-plugin communication
   - Feature flags per tenant

2. **Segment/Tag System**
   - Dynamic customer segmentation
   - Rule-based grouping
   - Segment-based automation triggers

3. **Inbox Model**
   - Unified inbox across channels
   - Conversation assignment
   - Internal notes
   - Canned responses

### Medium-term Opportunities

4. **Form Builder**
   - Drag-and-drop form creation
   - Custom fields
   - Conditional logic
   - Submission handling

5. **Automation Engine**
   - Trigger definitions
   - Action definitions
   - Workflow builder
   - Execution tracking

6. **Campaign System**
   - Email campaigns
   - SMS campaigns
   - Audience selection
   - Analytics

### Long-term Opportunities

7. **Widget SDK**
   - Embeddable chat widget
   - Pop-up forms
   - Customization options
   - Event tracking

8. **Dashboard Builder**
   - Custom dashboards
   - Widget library
   - Data visualization
   - Real-time updates

9. **Module Federation**
   - Micro-frontend architecture
   - Independent module deployment
   - Shared state management

---

## Data Model Comparison

### erxes (MongoDB)
```
customers
├── _id
├── firstName, lastName, email
├── phones[], emails[]
├── ownerId (assigned user)
├── status (active, deleted)
├── customFieldsData[]
├── tagIds[]
├── integrationId
└── trackedData[]

companies
├── _id
├── primaryName
├── names[]
├── industry
├── parentCompanyId
├── ownerId
├── customFieldsData[]
└── tagIds[]

conversations
├── _id
├── integrationId
├── customerId
├── userId (assigned)
├── content
├── status (new, open, closed)
├── readUserIds[]
└── tagIds[]

conversationMessages
├── _id
├── conversationId
├── customerId
├── userId
├── content
├── attachments[]
├── internal (boolean)
└── createdAt

deals (sales pipeline)
├── _id
├── name
├── stageId
├── companyIds[]
├── customerIds[]
├── assignedUserIds[]
├── amount
├── probability
└── customFieldsData[]

segments
├── _id
├── name
├── contentType (customer, company, deal)
├── conditions[]
├── subOf (parent segment)
└── color

automations
├── _id
├── name
├── status (active, draft)
├── triggers[]
├── actions[]
└── createdAt
```

### Turumba 2.0 (PostgreSQL + MongoDB)
```
PostgreSQL:
users → accounts → roles → account_users (junction)

MongoDB:
contacts (flexible document storage)
```

**Gap Analysis**: erxes has extensive models for CRM (customers, companies, deals), support (conversations, messages), marketing (segments, automations, campaigns), and more. Turumba has foundational user/account models only.

---

## Deployment & Resource Comparison

| Aspect | erxes | Turumba 2.0 |
|--------|-------|-------------|
| **Min RAM** | 4GB+ (with Elasticsearch) | ~512MB |
| **Min CPU** | 2+ cores | 1 core |
| **Dependencies** | MongoDB, Redis, Elasticsearch | PostgreSQL, MongoDB |
| **Complexity** | High (many services) | Low |
| **Scaling** | Complex (many components) | Service-level scaling |
| **Setup Time** | Hours | Minutes |

---

## Plugin Architecture Analysis

### erxes Plugin System
```
plugins/
├── plugin-inbox-api/
│   ├── src/
│   │   ├── graphql/
│   │   ├── models/
│   │   ├── messageBroker.ts
│   │   └── configs.ts
│   └── package.json
├── plugin-inbox-ui/
│   ├── src/
│   │   ├── components/
│   │   ├── containers/
│   │   └── routes.tsx
│   └── package.json
└── ... (100+ plugins)
```

**Pattern**: Each plugin has:
- API package (GraphQL resolvers, models)
- UI package (React components, routes)
- Message broker integration
- Configuration system

**Learnings for Turumba**:
1. Separate API and UI packages
2. Message broker for inter-plugin communication
3. Plugin configuration/metadata
4. Plugin dependency management

---

## Recommendations for Turumba Roadmap

### If Building All-in-One Platform

**Phase 1: Core CRM**
1. Company/Organization model
2. Enhanced contact/customer model
3. Custom fields system
4. Tags and segments

**Phase 2: Communication**
1. Unified inbox
2. Conversation model
3. Channel integrations
4. Assignment and workflows

**Phase 3: Marketing**
1. Form builder
2. Campaign system
3. Automation engine
4. Analytics

### If Staying Platform-Focused (Recommended)

Selectively adopt:
1. **Segment system** - Dynamic grouping for contacts
2. **Custom fields** - Flexible schema extension
3. **Tags** - Simple categorization
4. **Plugin pattern** - For future extensibility

---

## Summary

| | erxes | Turumba 2.0 |
|-|-------|-------------|
| **Strength** | Complete marketing/sales/support suite | Flexible multi-tenant foundation |
| **Weakness** | Complex, heavy, overwhelming | Features not yet built |
| **Best For** | Teams wanting HubSpot alternative | Building custom multi-tenant platform |

**Strategic Assessment**:

erxes excels at:
- All-in-one functionality (CRM, marketing, support)
- Plugin extensibility (100+ plugins)
- TypeScript-first architecture
- Modern frontend (React 18, Module Federation)

Turumba can differentiate by:
1. **Focus** - Not trying to be everything
2. **Simplicity** - Easier to deploy and maintain
3. **Multi-tenancy** - True B2B SaaS architecture
4. **Lighter footprint** - No Elasticsearch/Redis required
5. **External auth** - Cognito vs built-in auth
6. **REST API** - Simpler than GraphQL for most use cases

**Recommendation**: erxes is excellent reference for **plugin architecture patterns** and **CRM data models**. However, its "do everything" approach adds complexity. Turumba should stay focused and adopt specific patterns (segments, custom fields, tags) rather than replicating the full platform.

The most valuable learnings from erxes:
1. Plugin architecture for extensibility
2. Segment system for dynamic grouping
3. Custom fields for schema flexibility
4. Unified inbox pattern for omnichannel
