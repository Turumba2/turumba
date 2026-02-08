# Tiledesk vs Turumba 2.0: Competitive Analysis

**Date:** 2026-02-02
**Sources:**
- https://github.com/Tiledesk/tiledesk
- https://tiledesk.com/
- https://tiledesk.com/features/

**GitHub Stars:** 271
**Award:** Product Hunt Golden Kitty 2024 (Open Source Product of the Year)
**Tagline:** "The backbone of your AI projects" - Open-source, no-code platform for AI chatbots

## Overview

This document compares Tiledesk, an open-source AI-first conversational platform, with Turumba 2.0 to identify architectural differences, feature gaps, and opportunities for improvement.

---

## Product Focus

| Aspect | Tiledesk | Turumba 2.0 |
|--------|----------|-------------|
| **Primary Purpose** | AI chatbot + live chat platform | Multi-tenant account management platform |
| **Target Use Case** | Automated customer conversations with AI | User auth, accounts, roles, messaging (foundation) |
| **Maturity** | Production-ready, Golden Kitty winner | Early-stage, core infrastructure built |
| **Business Model** | Voiceflow alternative | Custom platform foundation |
| **Philosophy** | AI-first, human-in-the-loop | Multi-tenant foundation |

---

## Architecture Comparison

| Component | Tiledesk | Turumba 2.0 |
|-----------|----------|-------------|
| **Architecture** | Multi-service (Docker Compose) | Microservices |
| **Backend** | Node.js/Express | FastAPI (Python) |
| **Frontend** | Angular (Dashboard) | Next.js 16 (Turborepo) |
| **Chat Widget** | Ionic/Angular | Not implemented |
| **API Gateway** | Built-in | KrakenD with Go plugins |
| **Database** | MongoDB | PostgreSQL + MongoDB |
| **Auth** | Built-in | AWS Cognito (external) |
| **AI/ML** | LLM integrations, RAG | Not implemented |
| **Orchestration** | Docker Compose, Kubernetes | Docker Compose |

**Key Difference**: Tiledesk is an **AI-first conversational platform** focused on chatbots with human handoff. Turumba is a **microservices foundation** for multi-tenant account management.

---

## Technology Stack

### Tiledesk Stack
```
├── Node.js / Express (API)
├── Angular (Dashboard)
├── Ionic (Chat widget)
├── MongoDB (primary database)
├── Redis (caching, sessions)
├── RabbitMQ (message queue)
├── LLM integrations (OpenAI, etc.)
├── RAG engine (knowledge base)
├── Docker Compose
└── Kubernetes (Helm charts)
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

| Feature | Tiledesk | Turumba 2.0 |
|---------|----------|-------------|
| **Multi-tenancy** | Project-based | Core architecture (accounts, roles per account) |
| **User Management** | Agents/Admins | Comprehensive CRUD with filtering/sorting |
| **Role-Based Access** | Fixed roles | Flexible JSON permissions per role |
| **AI Chatbot** | ✅ (core feature) | ❌ Not implemented |
| **No-code Bot Builder** | ✅ Design Studio | ❌ |
| **LLM Integration** | ✅ OpenAI, etc. | ❌ |
| **RAG/Knowledge Base** | ✅ Hybrid RAG | ❌ |
| **Live Chat Widget** | ✅ | ❌ |
| **Human Handoff** | ✅ (HITL) | ❌ |
| **WhatsApp** | ✅ | ❌ |
| **Facebook Messenger** | ✅ | ❌ |
| **Telegram** | ✅ | ❌ |
| **Email Integration** | ❌ | ❌ |
| **Ticketing System** | ✅ Conversational | ❌ |
| **Canned Responses** | ✅ | ❌ |
| **Analytics** | ✅ | ❌ |
| **Contact Management** | Basic | ✅ (MongoDB-backed, flexible metadata) |
| **API Gateway** | Built-in | ✅ KrakenD with context enrichment |
| **Generic CRUD Pattern** | ❌ | ✅ Reusable base controller |

---

## Tiledesk Core Features

### Platform Positioning (from Landing Page)
Tiledesk is positioned as an **open-source, no-code platform** to:
- Build AI chatbots
- Integrate live agents
- Automate conversations
- Enhance customer support

Key message: "Create sophisticated LLM-enabled chatbots that seamlessly transition interactions to human agents."

### AI Agent (Core)
- **Design Studio**: No-code visual chatbot builder
- **LLM Integration**: Connect OpenAI, Anthropic, and other providers
- **Intent Recognition**: NLU for understanding user queries
- **Entity Extraction**: Pull structured data from conversations
- **Context Management**: Multi-turn conversation handling
- **Fallback Handling**: Graceful error recovery

### Knowledge Base (RAG)
- **Semantic Search**: Vector-based retrieval
- **Hybrid RAG**: Combined keyword + semantic
- **Document Upload**: PDF, DOCX, TXT support
- **URL Scraping**: Import web content
- **Auto-chunking**: Intelligent text splitting
- **Source Attribution**: Reference original documents

### Human-in-the-Loop (HITL)
- **Smart Handoff**: AI recognizes when to transfer
- **Agent Availability**: Route based on presence
- **Department Routing**: Skills-based assignment
- **Queue Management**: Priority handling
- **Supervisor Tools**: Monitor and intervene

### Live Chat Widget
- **Customizable**: Colors, position, greeting
- **Multi-platform**: Web, iOS, Android
- **Proactive**: Trigger-based engagement
- **Rich Messages**: Cards, buttons, carousels
- **File Sharing**: Attachment support
- **Offline Mode**: Leave message when unavailable

### Channels
- **Website Widget**: JavaScript embed
- **WhatsApp Business**: Official API
- **Facebook Messenger**: Page integration
- **Telegram**: Bot API
- **API**: Custom integrations

### Design Studio (Bot Builder)
- **Visual Flow Editor**: Drag-and-drop
- **Intent Blocks**: NLU triggers
- **Action Blocks**: API calls, conditions
- **Form Blocks**: Data collection
- **LLM Blocks**: AI-powered responses
- **Webhook Blocks**: External integrations
- **Template Library**: Pre-built flows

### Integrations
- **Make (Integromat)**: Automation platform integration
- **Webhooks**: Inbound/outbound for custom workflows
- **REST API**: Full API access for developers
- **Custom Apps**: Build extensions via Developer Hub
- **Third-party Platforms**: Comprehensive integration ecosystem

### Target Industries (from Landing Page)
- **E-Commerce & Retail** - Product inquiries, order tracking
- **Consulting & Legal Services** - Lead qualification, scheduling
- **Educational Institutions** - Student support, admissions
- **General Customer Service** - Support automation across industries

### Deployment Options
- **Cloud Hosting**: Managed SaaS
- **On-premise Installation**: Self-hosted
- **White-label Solutions**: Custom branding
- **Docker Compose**: Local development
- **Kubernetes (Helm)**: Enterprise deployment

---

## Turumba Competitive Advantages

### 1. Microservices Foundation
- Clear service boundaries
- Independent scaling
- Technology flexibility
- Better long-term maintainability

### 2. Multi-tenant by Design
- Account isolation is core
- Users can belong to multiple accounts
- Roles are account-specific
- Tiledesk uses project-based isolation

### 3. Flexible Permission System
- JSON-based permissions
- Custom permissions per role
- Extensible without schema changes
- Tiledesk has fixed roles

### 4. Database Flexibility
- PostgreSQL for relational data
- MongoDB for flexible documents
- Better for complex data models
- Tiledesk is MongoDB-only

### 5. External Auth (Cognito)
- Enterprise SSO included
- MFA out of box
- Proven security
- Tiledesk has built-in auth

### 6. Modern API Gateway
- KrakenD with Go plugins
- Request enrichment
- Rate limiting
- Centralized management

### 7. Simpler Core
- Focused on fundamentals
- Not trying to be AI platform
- Easier to understand and modify

---

## What Turumba Could Learn from Tiledesk

### Immediate Opportunities

1. **Conversation Flow Architecture**
   ```
   Visitor → Widget → Bot Engine → [AI Response | Human Handoff]
                         ↓
                   Knowledge Base (RAG)
   ```

2. **Human Handoff Pattern**
   - Bot confidence threshold
   - Explicit transfer request
   - Agent availability check
   - Seamless conversation continuity

3. **Rich Message Types**
   - Text messages
   - Buttons/Quick replies
   - Cards with images
   - Carousels
   - Forms/Input collection

### Medium-term Opportunities

4. **Knowledge Base/RAG**
   - Document ingestion pipeline
   - Vector embedding storage
   - Retrieval API
   - Source citation

5. **Bot Building Blocks**
   - Intent recognition
   - Entity extraction
   - Conditional logic
   - API call actions
   - Variable management

6. **Channel Abstraction**
   - Unified message format
   - Channel-specific adapters
   - Single bot, multiple channels

### Long-term Opportunities

7. **LLM Integration Framework**
   - Provider abstraction (OpenAI, Anthropic, etc.)
   - Prompt management
   - Response streaming
   - Cost tracking

8. **Visual Flow Editor**
   - React Flow or similar
   - Drag-and-drop blocks
   - Connection validation
   - Export/import flows

9. **Analytics Dashboard**
   - Conversation metrics
   - Bot performance
   - Human handoff rates
   - Customer satisfaction

---

## Data Model Comparison

### Tiledesk (MongoDB)
```
projects (tenants)
├── _id
├── name
├── settings
├── widget_config
└── channels[]

users (agents)
├── _id
├── email
├── projects[] (access)
├── role
└── status (online, offline, busy)

faq_kb (knowledge bases)
├── _id
├── project_id
├── name
├── type (internal, external)
└── settings

faq (intents/responses)
├── _id
├── id_faq_kb
├── question
├── answer
├── intent_id
├── webhook_enabled
└── attributes

requests (conversations)
├── _id
├── project_id
├── lead (visitor)
├── participants[] (agents)
├── department
├── status (open, closed)
├── channel (widget, whatsapp, etc.)
├── tags[]
└── attributes

messages
├── _id
├── request_id
├── sender (bot, agent, visitor)
├── type (text, image, button, etc.)
├── text
├── metadata
└── attributes

bots
├── _id
├── project_id
├── name
├── type (internal, external, dialogflow)
├── url (webhook)
└── intents[]

departments
├── _id
├── project_id
├── name
├── routing
├── bot_id (default bot)
└── agents[]
```

### Turumba 2.0 (PostgreSQL + MongoDB)
```
PostgreSQL:
users → accounts → roles → account_users (junction)

MongoDB:
contacts (flexible document storage)
```

**Gap Analysis**: Tiledesk has extensive models for AI (faq_kb, faq, bots), conversations (requests, messages), and routing (departments). Turumba would need these for AI-powered chat.

---

## Deployment & Resource Comparison

| Aspect | Tiledesk | Turumba 2.0 |
|--------|----------|-------------|
| **Min RAM** | 4GB+ | ~512MB |
| **Min CPU** | 2+ cores | 1 core |
| **Dependencies** | MongoDB, Redis, RabbitMQ | PostgreSQL, MongoDB |
| **Complexity** | High (many services) | Low |
| **AI/GPU** | Optional (LLM) | None |
| **Kubernetes** | ✅ Helm charts | ❌ Docker Compose only |

---

## AI Architecture Analysis

### Tiledesk AI Pipeline
```
User Message
     ↓
Intent Classification (NLU)
     ↓
┌────┴────┐
│ Known   │ Unknown
│ Intent  │ Intent
└────┬────┴────┬────┘
     ↓         ↓
FAQ Response  LLM + RAG
     ↓         ↓
     └────┬────┘
          ↓
   Confidence Check
          ↓
   ┌─────┴─────┐
   │ High      │ Low
   │ Confidence│ Confidence
   └─────┬─────┴─────┬─────┘
         ↓           ↓
   Send Response  Human Handoff
```

### Key AI Components
1. **Intent Classifier**: Matches user input to known intents
2. **Entity Extractor**: Pulls structured data from text
3. **Knowledge Retriever**: RAG for unstructured queries
4. **LLM Generator**: Generates responses from context
5. **Confidence Scorer**: Decides bot vs human

---

## Recommendations for Turumba Roadmap

### If Building AI Chatbot Features

**Phase 1: Basic Bot**
1. Intent/response model (FAQ-style)
2. Simple pattern matching
3. Conversation state machine
4. Human handoff trigger

**Phase 2: AI Enhancement**
1. LLM integration (OpenAI API)
2. Basic RAG (document retrieval)
3. Streaming responses
4. Fallback handling

**Phase 3: Advanced AI**
1. Visual flow builder
2. Custom NLU training
3. Multi-turn context
4. Analytics and optimization

### If Staying Platform-Focused (Recommended)

Selectively adopt:
1. **Human handoff pattern** - Useful for any chat
2. **Rich message types** - Cards, buttons, etc.
3. **Channel abstraction** - Single API, multiple channels
4. **Department routing** - Skills-based assignment

---

## Summary

| | Tiledesk | Turumba 2.0 |
|-|----------|-------------|
| **Strength** | AI-first with no-code builder, RAG | Flexible multi-tenant foundation |
| **Weakness** | Complex, AI-focused only | Features not yet built |
| **Best For** | Teams wanting AI chatbot platform | Building custom multi-tenant platform |

**Strategic Assessment**:

Tiledesk excels at:
- AI chatbot building (no-code)
- LLM/RAG integration
- Human-in-the-loop workflows
- Multi-channel deployment

Turumba can differentiate by:
1. **Focused scope** - Not trying to be AI platform
2. **Simpler deployment** - No RabbitMQ, Redis required
3. **Multi-tenancy** - Better B2B architecture
4. **Lighter footprint** - Easier to operate
5. **Flexible foundation** - Build any type of app

**Recommendation**: Tiledesk is an **excellent reference for AI chatbot patterns**. If Turumba adds AI features, study Tiledesk's:
1. Human handoff logic
2. RAG implementation
3. No-code flow builder
4. Channel abstraction

However, Tiledesk's AI-first architecture may be overkill. Turumba could integrate AI more simply:
- Direct LLM API calls
- Simple document retrieval
- Human handoff based on keywords/sentiment
- No visual flow builder initially

The AI features should complement the multi-tenant foundation, not dominate it.
