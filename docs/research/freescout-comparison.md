# FreeScout vs Turumba 2.0: Competitive Analysis

**Date:** 2026-02-02
**Sources:**
- https://github.com/freescout-helpdesk/freescout
- https://freescout.net/
- https://freescout.net/modules/

**GitHub Stars:** 4.1k
**Tagline:** "Super lightweight and powerful free open source help desk and shared inbox"

## Overview

This document compares FreeScout, a lightweight open-source helpdesk and shared inbox platform, with Turumba 2.0 to identify architectural differences, feature gaps, and opportunities for improvement.

---

## Product Focus

| Aspect | FreeScout | Turumba 2.0 |
|--------|-----------|-------------|
| **Primary Purpose** | Shared inbox / Help Scout clone | Multi-tenant account management platform |
| **Target Use Case** | Email-based customer support | User auth, accounts, roles, messaging (foundation) |
| **Maturity** | Production-ready, 4.1k+ GitHub stars | Early-stage, core infrastructure built |
| **Business Model** | Help Scout/Zendesk alternative | Custom platform foundation |
| **Pricing Model** | Free core + paid modules | - |

---

## Architecture Comparison

| Component | FreeScout | Turumba 2.0 |
|-----------|-----------|-------------|
| **Architecture** | Monolithic (Laravel) | Microservices |
| **Backend** | PHP 8 / Laravel (90.7%) | FastAPI (Python) |
| **Frontend** | Blade templates (9%) | Next.js 16 (separate monorepo) |
| **API Gateway** | None (Laravel handles routing) | KrakenD with Go plugins |
| **Database** | MySQL/MariaDB/PostgreSQL | PostgreSQL + MongoDB |
| **Auth** | Built-in (Laravel Auth) | AWS Cognito (external) |
| **Real-time** | Polling (no WebSocket) | Not yet implemented |
| **Hosting** | Shared hosting compatible | Docker required |

**Key Difference**: FreeScout is a **lightweight email-focused helpdesk** that runs on shared hosting. Turumba is a **microservices foundation** designed for multi-tenant applications at scale.

---

## Technology Stack

### FreeScout Stack
```
├── PHP 7.1 - 8.x
├── Laravel Framework
├── Blade Templates (frontend)
├── MySQL / MariaDB / PostgreSQL
├── Web-based installer
├── Module system (paid add-ons)
└── Shared hosting compatible
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

| Feature | FreeScout | Turumba 2.0 |
|---------|-----------|-------------|
| **Multi-tenancy** | Single instance | Core architecture (accounts, roles per account) |
| **User Management** | Basic users/agents | Comprehensive CRUD with filtering/sorting |
| **Role-Based Access** | Fixed roles | Flexible JSON permissions per role |
| **Shared Inbox** | ✅ (core feature) | ❌ Not implemented |
| **Email Integration** | ✅ Full IMAP/SMTP | ❌ |
| **Live Chat** | Module (paid) | ❌ |
| **WhatsApp** | Module (paid) | ❌ |
| **Facebook/Twitter** | Modules (paid) | ❌ |
| **Knowledge Base** | Module (paid) | ❌ |
| **Satisfaction Ratings** | Module (paid) | ❌ |
| **Time Tracking** | Module (paid) | ❌ |
| **Workflows/Automation** | Module (paid) | ❌ |
| **Two-Factor Auth** | Module (paid) | ✅ Via Cognito |
| **SAML SSO** | Module (paid) | ✅ Via Cognito |
| **API Access** | Module (paid) | ✅ Built-in |
| **Mobile Apps** | ✅ iOS/Android | ❌ |
| **Contact Management** | Basic | ✅ (MongoDB-backed, flexible metadata) |
| **API Gateway** | ❌ | ✅ KrakenD with context enrichment |
| **Generic CRUD Pattern** | ❌ (Laravel conventions) | ✅ Reusable base controller |
| **Unlimited Users** | ✅ | ✅ |

---

## FreeScout Core Features

### Shared Inbox (Free)
- **Mailboxes**: Multiple email addresses
- **Conversations**: Email threading
- **Collision Detection**: See who's viewing/replying
- **Saved Replies**: Canned response templates
- **Conversation Forwarding**: Share via email
- **Conversation Merging**: Combine duplicates
- **Notes**: Internal team notes
- **Assignments**: Assign to agents
- **Status**: Open, pending, closed
- **Tags**: Custom categorization

### Email Integration (Free)
- IMAP/SMTP support
- **Modern Microsoft Exchange authentication**
- Email threading by message-id
- Auto-reply detection
- Bounce handling
- Email notifications
- Email forwarding
- Phone conversation logging

### Core Free Features (from Landing Page)
- **Unlimited** support agents, tickets, and mailboxes
- Push notifications
- Starred conversations
- Internal notes
- Conversation following
- Auto-replies
- Conversation merging
- Mailbox transfers
- Collision detection (see who's viewing)
- Open tracking
- Search functionality

### User Interface (Free)
- **100% mobile-friendly** responsive design
- 28+ language translations (English, German, French, Spanish, Chinese, Japanese, etc.)
- Dark mode (module)
- Keyboard shortcuts
- Push notifications
- Screen reader accessible
- Web-based installer for easy deployment

### Mobile & Desktop Apps
- Native iOS app (App Store)
- Native Android app (Play Store)
- MacOS menu bar app

### Modules (Paid Add-ons)
FreeScout has 60+ modules including:

**Communication:**
- Live Chat widget
- WhatsApp integration
- Facebook integration
- Twitter integration
- Telegram integration
- SMS (Twilio, MessageBird)

**Productivity:**
- Workflows (automation)
- Time Tracking
- Checklists
- Kanban board
- Custom Fields
- Custom Folders
- Reports

**Customer Experience:**
- Knowledge Base
- Customer Portal
- Satisfaction Ratings
- Office Hours (auto-reply)

**Security:**
- Two-Factor Authentication
- SAML SSO
- LDAP integration
- OAuth / Social Login
- GDPR compliance tools
- Extra Security (reCAPTCHA, IP restrictions)

**Developer:**
- API & Webhooks
- Custom CSS/JavaScript
- Zapier/Make automation integration

**E-commerce:**
- WooCommerce integration
- Easy Digital Downloads integration
- CRM functionality with customer data enrichment

**Encryption:**
- S/MIME & PGP email encryption

### Deployment Options
- Shared hosting compatible (unique advantage)
- Docker
- Softaculous
- Fantastico
- Cloudron

---

## Turumba Competitive Advantages

### 1. Microservices Foundation
- Independent service scaling
- Clear service boundaries
- Technology flexibility
- Better for large-scale deployments

### 2. Multi-tenant by Design
- Account isolation is core architecture
- Users can belong to multiple accounts
- Roles are account-specific
- FreeScout is single-tenant only

### 3. Flexible Permission System
- JSON-based permissions
- Custom permissions per role per account
- Extensible without schema changes

### 4. Modern API Gateway
- KrakenD for high-performance routing
- Request enrichment via Go plugins
- Rate limiting capabilities
- API-first design

### 5. Built-in Features vs Paid Modules
- 2FA included (Cognito)
- SSO included (Cognito)
- API included
- FreeScout charges for these

### 6. Modern Stack
- FastAPI (async Python)
- Auto-generated OpenAPI docs
- Next.js 16 with App Router
- React 19
- vs PHP/Blade templates

### 7. Scalability
- Designed for scale from start
- Docker/container native
- FreeScout is designed for shared hosting

---

## What Turumba Could Learn from FreeScout

### Immediate Opportunities

1. **Shared Inbox Model**
   - Mailbox entity (email address, settings)
   - Conversation entity (thread of messages)
   - Simple status workflow (open, pending, closed)
   - Assignment to agents

2. **Email Integration Pattern**
   - IMAP polling for inbound
   - SMTP for outbound
   - Threading by message-id/references
   - Auto-reply detection

3. **Collision Detection**
   - Real-time "viewing" indicators
   - "Replying" indicators
   - Prevent duplicate responses

### Medium-term Opportunities

4. **Saved Replies**
   - Template CRUD
   - Variable substitution
   - Folder organization
   - Quick search/insert

5. **Customer Portal**
   - Ticket submission
   - Status tracking
   - Conversation history
   - White-label branding

6. **Satisfaction Ratings**
   - Post-reply survey
   - Rating collection
   - Feedback aggregation

### Long-term Opportunities

7. **Knowledge Base**
   - Article management
   - Category organization
   - Search functionality
   - Public/private visibility

8. **Workflows**
   - Trigger-based automation
   - Auto-assignment rules
   - Auto-tagging
   - SLA reminders

9. **Mobile Apps**
   - React Native app
   - Push notifications
   - Offline support

---

## Data Model Comparison

### FreeScout (MySQL/PostgreSQL)
```
mailboxes
├── id
├── name
├── email
├── aliases
├── settings (JSON)
└── folders[]

conversations
├── id
├── mailbox_id
├── folder_id
├── customer_id
├── user_id (assigned agent)
├── number (conversation #)
├── subject
├── status (active, pending, closed)
├── type (email, phone, chat)
└── tags[]

threads (messages)
├── id
├── conversation_id
├── user_id (author)
├── customer_id
├── type (customer, message, note)
├── body
├── headers (JSON)
├── attachments[]
└── created_at

customers
├── id
├── first_name, last_name
├── email
├── emails[] (additional)
├── phones[]
├── company
└── custom_fields (JSON)

users (agents)
├── id
├── email
├── first_name, last_name
├── role (admin, user)
├── mailboxes[] (access)
└── notifications (JSON)
```

### Turumba 2.0 (PostgreSQL + MongoDB)
```
PostgreSQL:
users → accounts → roles → account_users (junction)

MongoDB:
contacts (flexible document storage)
```

**Gap Analysis**: Turumba lacks mailbox, conversation, thread, and customer models. The contact model in MongoDB could evolve into the customer model.

---

## Deployment & Resource Comparison

| Aspect | FreeScout | Turumba 2.0 |
|--------|-----------|-------------|
| **Min RAM** | 512MB | ~512MB |
| **Min CPU** | 1 core | 1 core |
| **Hosting** | Shared hosting OK | Docker required |
| **Dependencies** | PHP, MySQL only | PostgreSQL, MongoDB, Docker |
| **Complexity** | Low | Medium |
| **Scaling** | Vertical only | Horizontal (microservices) |
| **Updates** | Web-based updater | Container rebuild |

---

## Pricing Model Comparison

### FreeScout
- **Core**: Free (AGPL-3.0)
- **Modules**: $2-50 each (one-time)
- **All Modules Bundle**: ~$300 (one-time)
- **Support**: Paid plans available

### Turumba 2.0
- **All features**: Included
- **Model**: Self-hosted platform

**Observation**: FreeScout's module model creates friction. Core features like 2FA, API, SSO are paid add-ons. Turumba includes these via Cognito.

---

## Recommendations for Turumba Roadmap

### If Building Email-First Helpdesk

**Phase 1: Core Inbox**
1. Mailbox model (email addresses)
2. Conversation model (threads)
3. Message model (emails, notes)
4. IMAP integration
5. Basic inbox UI

**Phase 2: Collaboration**
1. Assignment and ownership
2. Internal notes
3. Collision detection
4. Saved replies
5. Tags and folders

**Phase 3: Customer Experience**
1. Customer portal
2. Satisfaction ratings
3. Knowledge base
4. Auto-responders

### If Staying Platform-Focused

Selectively adopt:
1. **Conversation threading** - Useful for any messaging
2. **Saved replies** - Template system
3. **Customer model** - Extend contacts
4. **Collision detection** - Real-time collaboration pattern

---

## Summary

| | FreeScout | Turumba 2.0 |
|-|-----------|-------------|
| **Strength** | Simple, lightweight, runs anywhere | Flexible multi-tenant foundation |
| **Weakness** | Single-tenant, paid modules, no real-time | Features not yet built |
| **Best For** | Small teams wanting Help Scout alternative | Building custom multi-tenant platform |

**Strategic Assessment**:

FreeScout excels at:
- Email-centric shared inbox
- Low resource requirements
- Easy deployment (shared hosting)
- Help Scout feature parity

Turumba can differentiate by:
1. **Multi-tenancy** - FreeScout is single-tenant only
2. **Built-in features** - 2FA, SSO, API included
3. **Modern architecture** - Microservices vs monolith
4. **Real-time** - WebSocket vs polling
5. **Scalability** - Designed for growth
6. **API-first** - Better for custom integrations

**Recommendation**: FreeScout is a good reference for **simple helpdesk UX patterns** (shared inbox, conversation threading, collision detection). These patterns could be implemented in Turumba's messaging-api. However, Turumba should avoid FreeScout's single-tenant limitation and paid module model.
