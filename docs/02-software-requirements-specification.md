# Software Requirements Specification (SRS)

## Project: AI Employee Platform
**Document Version:** 1.0.0  
**Status:** Approved (SaaS Blueprint)  
**Author:** Senior SaaS Architect  
**Date:** July 6, 2026  

---

## 1. System Overview

The **AI Employee Platform** is a B2B multi-tenant SaaS application that enables businesses to deploy AI-powered virtual employees to engage with customers on WhatsApp. The platform integrates Meta Cloud API for WhatsApp communication, uses Retrieval-Augmented Generation (RAG) for AI responses, and provides a human-in-the-loop live chat inbox for seamless agent takeover. Key architectural components include:
- **Express.js Backend Server** for API and webhook handling
- **PostgreSQL with pgvector** for multi-tenant data storage and semantic search
- **Redis + BullMQ** for asynchronous message queueing
- **Socket.io** for real-time live chat
- **Next.js Dashboard** for tenant administration

---

## 2. User Roles

| Role | Description | Permissions |
|------|-------------|-------------|
| **Admin** | Tenant business owner or manager | Full access: onboarding, billing, credentials, AI training, live chat |
| **Agent** | Customer support staff | Limited access: live chat, toggle AI responses, view chat history |
| **End-Customer** | WhatsApp user interacting with the AI employee | Sends/receives WhatsApp messages |

---

## 3. Functional Requirements

### 3.1 Onboarding & Multi-Tenancy (FR-AUTH)
- **FR-AUTH-1:** Logical tenant data isolation to prevent cross-contamination
- **FR-AUTH-2:** User registration with secure password hashing (bcrypt/argon2)
- **FR-AUTH-3:** Role-Based Access Control (RBAC): Admin vs Agent permissions

### 3.2 AI Training & Ingestion (FR-TRAIN)
- **FR-TRAIN-1:** PDF/TXT file upload (up to 10MB) with automatic chunking and embedding
- **FR-TRAIN-2:** Single-page URL crawling for content ingestion
- **FR-TRAIN-3:** Structured Q&A overrides with semantic matching (score > 0.85)

### 3.3 WhatsApp Message Processing (FR-MSGGW)
- **FR-MSGGW-1:** Single `/api/v1/webhooks/whatsapp` endpoint for Meta webhooks
- **FR-MSGGW-2:** Async queue processing (Redis/BullMQ) to respond to Meta within 2 seconds
- **FR-MSGGW-3:** Payload parsing and tenant routing by phone_number_id

### 3.4 Live Chat & Handoff (FR-LIVEC)
- **FR-LIVEC-1:** Real-time bidirectional messaging via WebSockets
- **FR-LIVEC-2:** Per-contact `ai_active` boolean flag to control AI responses
- **FR-LIVEC-3:** "Pause AI" toggle per conversation
- **FR-LIVEC-4:** Automatic AI pause when human agent sends a message

### 3.5 Analytics & Billing (FR-ANABILL)
- **FR-ANABILL-1:** Stripe checkout integration
- **FR-ANABILL-2:** Message and token usage dashboard

---

## 4. Non-Functional Requirements

### 4.1 Security & Compliance (NFR-SEC)
- **NFR-SEC-1:** Global tenant filter middleware for all database queries
- **NFR-SEC-2:** TLS 1.3 (in transit) and AES-256 (at rest) encryption
- **NFR-SEC-3:** GDPR-compliant customer data export/deletion

### 4.2 Reliability & Scaling (NFR-REL)
- **NFR-REL-1:** Support for 500 concurrent incoming messages without drops
- **NFR-REL-2:** Idempotent webhook handling (duplicate Meta payload check)

### 4.3 Performance (NFR-PER)
- **NFR-PER-1:** End-to-end response latency < 3.5 seconds
- **NFR-PER-2:** Live chat UI sync within 100ms of state changes

---

## 5. Business Rules

1. **AI Resolution Priority:** Structured Q&A overrides take precedence over RAG/LLM responses when semantic similarity > 0.85
2. **Rate Limiting:** Max 5 customer messages per minute; excess triggers AI mute and spam flag
3. **Human Takeover:** Agent message automatically sets `ai_active = false`
4. **Tenant Isolation:** All database queries include explicit `tenant_id` filter
5. **Idempotency:** Duplicate Meta webhooks (same `id`) are ignored to prevent duplicate responses

---

## 6. User Flows

### 6.1 Tenant Onboarding Flow
1. Admin signs up and creates a tenant account
2. Admin connects Meta Cloud API credentials (phone number ID, access token)
3. Admin uploads training materials (PDF/TXT/URLs) and configures structured Q&As
4. Admin sets AI system prompt and tone
5. Admin tests AI in sandbox preview
6. AI employee goes live on WhatsApp

### 6.2 Customer-AI Conversation Flow
1. End-customer sends WhatsApp message
2. Meta webhook routes payload to platform
3. System checks if `ai_active = true` for contact
4. If active:
   - Check structured Q&As first
   - If no match: execute RAG search and generate LLM response
   - Send response back via Meta API
5. If inactive:
   - Route to live chat inbox with alert for agent
   - No AI response generated

### 6.3 Human Takeover Flow
1. Agent sees conversation in live chat inbox
2. Agent clicks "Pause AI" toggle or sends manual message
3. System sets `ai_active = false`
4. Agent responds to customer directly
5. Agent can re-enable AI later by toggling back on
