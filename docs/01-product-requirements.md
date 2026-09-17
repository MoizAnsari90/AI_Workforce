# Product Requirements Document (PRD)

## Project: AI Employee Platform
**Document Version:** 1.0.0  
**Status:** Approved (MVP Baseline)  
**Author:** Senior Product Manager & SaaS Architect  
**Date:** July 6, 2026  

---

## 1. Executive Summary

The **AI Employee Platform** is a next-generation B2B multi-tenant SaaS that empowers businesses to create, train, and deploy specialized "AI Employees" to interact directly with their customers on WhatsApp. Utilizing the official **Meta Cloud API**, this platform bridges the gap between raw LLM capabilities and practical, conversational business support. 

For the Minimum Viable Product (MVP), the platform provides tenant onboarding, an advanced AI Training Engine leveraging Retrieval-Augmented Generation (RAG) and structured Q&As, a unified WhatsApp Messaging Gateway, and a **Human-in-the-Loop Live Chat Inbox** allowing human agents to seamlessly take over conversations when needed.

---

## 2. Problem Statement

Small-to-medium businesses (SMBs) and mid-market enterprises face three core challenges in customer support and engagement:
1. **The 24/7 Availability Gap:** Customers expect immediate responses at all hours. Slow response times lead directly to lost leads and lower Customer Satisfaction (CSAT).
2. **High Cost of Human Scale:** Scaling a 24/7 support team is prohibitively expensive, yet traditional rule-based chatbots are rigid, frustrating, and unable to resolve complex queries.
3. **Siloed Inboxes & Lack of Control:** Modern AI tools operate outside business messaging channels, and when businesses experiment with fully autonomous AI, they fear reputation damage due to lack of human supervision or easy override capabilities.

---

## 3. Target Audience

The primary target audience consists of:
*   **E-Commerce Brands (D2C):** Who need to automate product inquiries, stock checks, and simple FAQs.
*   **Local Service Businesses (Clinics, Salons, Consultancies):** Who need to handle appointment booking, service descriptions, and operating hours.
*   **B2B Service Providers:** Seeking to capture and pre-qualify leads directly on WhatsApp.

---

## 4. Business Goals

*   **Fast Time-to-Value (TTV):** Enable a new tenant to onboard, upload their documentation, connect their WhatsApp number, and have a functioning AI Employee live in under 15 minutes.
*   **High AI Deflection Rate:** Achieve a minimum of **70% automated resolution** on routine inquiries during the MVP phase, reducing human support overhead.
*   **Scalable Unit Economics:** Ensure SaaS margins remain >70% by designing highly optimized multi-tenant RAG and LLM token routing.
*   **Tenant Data Rigor:** Establish 100% logical isolation of tenant data to secure enterprise and client privacy.

---

## 5. User Personas

### Persona A: Sarah (Tenant Admin / Business Owner)
*   **Profile:** Owner of a growing online boutique. No engineering or coding experience.
*   **Needs:** To deploy an assistant that understands her product catalogs, policies, and tone, while having clear oversight of billing and usage.
*   **Frustrations:** Dislikes complex software; wants a simple dashboard where she can upload a PDF of her store policies and see immediate results.

### Persona B: Alex (Customer Support Lead / Agent)
*   **Profile:** Head of Customer Support for a mid-sized medical clinic.
*   **Needs:** A central inbox where they can monitor active WhatsApp conversations in real-time. Needs an instant, frictionless way to take over the conversation from the AI when a patient has a complex or sensitive medical question.
*   **Frustrations:** Afraid of "black-box" AI systems that act on customers without human recourse.

### Persona C: John (The End-Customer)
*   **Profile:** A busy customer looking to book a service or inquire about shipping.
*   **Needs:** Fast, natural, and accurate answers directly on WhatsApp, without waiting on hold or downloading an app.
*   **Frustrations:** Hates standard automated IVR menus and rigid "press 1 for X" chatbots.

---

## 6. Core Features (MVP Only)

### 6.1 Multi-Tenant Tenant Administration Dashboard
*   **Workspace Management:** Separation of workspaces, user roles (Admin, Agent), and credentials.
*   **Usage Billing Dashboard:** Multi-tenant subscription status and real-time token/message consumption metrics.

### 6.2 AI Employee Training Engine
*   **RAG Document Ingestion:** Upload PDF, TXT, and enter website URLs. The system automatically chunks, embeds, and stores these in a vector database.
*   **Structured Q&A Directory:** A curated list of exact Question/Answer overrides for deterministic business responses (e.g., exact refund policy text).
*   **System Prompt & Tone Configuration:** Simple sliders and text areas to configure the AI's identity, language, goals, and behavioral boundaries.

### 6.3 Unified WhatsApp Gateway (Meta Cloud API)
*   **Embedded Signup / BYO Credentials:** A seamless settings interface for tenants to input their Meta Business Phone Number ID, App ID, and permanent System User Access Token.
*   **Multi-Tenant Webhook Router:** A scalable, centralized webhook endpoint that securely parses incoming messages and routes them to the correct tenant context.

### 6.4 Shared Live Chat Inbox (Human-in-the-Loop)
*   **Real-Time Dashboard:** A unified, real-time message stream (powered by WebSockets) displaying all active customer conversations.
*   **AI Control Switches:** A manual toggle button per contact allowing human agents to **Pause/Resume** the AI's autonomous responses.
*   **Interactive Takeover:** Support for agents to send manual messages directly to the customer on WhatsApp, immediately silencing the AI employee.

---

## 7. User Journey

### 7.1 Tenant Onboarding & Setup
```
[Sign Up] ➔ [Select Plan] ➔ [Connect WhatsApp Meta Credentials] ➔ [Upload PDF/URLs & Q&As] ➔ [Test in Sandbox] ➔ [Go Live]
```
1. **Sarah (Admin)** signs up on the SaaS web app.
2. She connects her Meta Cloud API credentials and selects her dedicated business phone number.
3. She uploads her "Store-Policies.pdf" and adds 5 critical FAQs in the Structured Q&A tab.
4. She writes a quick system instruction: *"You are Chloe, an expert assistant for Sarah's boutique. Be polite, concise, and professional."*
5. She tests the AI in a preview window directly inside the web dashboard.

### 7.2 Customer-AI Communication & Human Handoff
```
[Customer WhatsApp Message] ➔ [Webhook Ingestion] ➔ [Is AI Active?] 
                                   ├── YES ➔ [Check Q&As / Execute RAG Search] ➔ [Generate LLM Response] ➔ [Send WhatsApp Message]
                                   └── NO  ➔ [Route to Live Chat Inbox for Human Agent]
```
1. **John (End-Customer)** sends a WhatsApp message: *"Do you ship to Canada, and what is your refund policy?"*
2. The webhook routes this to the **AI Employee Platform**.
3. The platform verifies that the AI is **Active** for this contact.
4. The RAG pipeline queries the embedded vectors of `Store-Policies.pdf` and retrieves relevant context.
5. The LLM constructs a response citing the precise refund policy.
6. The customer receives a natural response on WhatsApp within 2.5 seconds.
7. If John asks: *"Can I get a discount because my package is late?"* (a query defined as requiring human intervention):
   *   The AI flags the issue, automatically **pauses** itself, and marks the status as **"Action Required"**.
   *   An alert is triggered in the **Live Chat Inbox** for **Alex (Support Agent)**.
   *   Alex reviews the chat history on the dashboard, switches off the AI toggle, and types: *"Hi John, I see your package was delayed. I've credited $10 back to your card."*

---

## 8. Functional Requirements (FR)

### 8.1 Onboarding & Multi-Tenancy (FR-AUTH)
*   **FR-AUTH-1:** The platform must isolate tenant data logically (using database-level foreign keys or schema separation) ensuring zero data cross-contamination.
*   **FR-AUTH-2:** Supported user registration, password hashing (argon2/bcrypt), and session management.
*   **FR-AUTH-3:** Role-Based Access Control (RBAC): `Admin` can edit settings, billing, and training sources. `Agent` can access the Live Chat Inbox and toggle AI but cannot alter credentials or billing.

### 8.2 AI Training & Ingestion (FR-TRAIN)
*   **FR-TRAIN-1:** The system must accept PDF and TXT files up to 10MB, chunking text using recursive character splitters and generating embeddings.
*   **FR-TRAIN-2:** The system must allow recursive crawling of single-page URLs provided by the tenant.
*   **FR-TRAIN-3:** Structured Q&A Module: Admin can create/edit key-value pairs of Exact Question Patterns and Exact Answer Overrides. If an incoming message matches a pattern (semantic similarity score > 0.85), the platform returns the override directly, bypassing the RAG model.

### 8.3 WhatsApp Message Processing Pipeline (FR-MSGGW)
*   **FR-MSGGW-1:** The SaaS must expose a single `/api/v1/webhooks/whatsapp` endpoint capable of receiving Meta Cloud API webhooks.
*   **FR-MSGGW-2:** The webhook handler must parse the Meta payload, extract the sender's phone number, tenant identifier, message ID, and message type (text/media).
*   **FR-MSGGW-3:** Webhook requests must be processed asynchronously using a queue (e.g., Redis / BullMQ) to respond to Meta with a `200 OK` within 2 seconds, preventing Meta from retrying webhooks.

### 8.4 Live Chat & Handoff (FR-LIVEC)
*   **FR-LIVEC-1:** The system must maintain real-time bidirectional messaging between the Live Chat UI and WhatsApp using WebSockets.
*   **FR-LIVEC-2:** Every customer contact record must have a boolean `ai_active` flag. If `ai_active = false`, incoming WhatsApp messages from this sender only append to the inbox and trigger notification alerts; no LLM processing is invoked.
*   **FR-LIVEC-3:** The Live Chat dashboard must display a prominent, clickable "Pause AI" toggle next to every open conversation.
*   **FR-LIVEC-4:** If a human agent sends a manual message via the dashboard, the system must automatically set `ai_active = false` for that contact.

### 8.5 Analytics & Billing (FR-ANABILL)
*   **FR-ANABILL-1:** Stripe checkout integration for core plan subscription.
*   **FR-ANABILL-2:** The dashboard must display total WhatsApp messages sent/received and LLM token usage.

---

## 9. Non-Functional Requirements (NFR)

### 9.1 Security & Compliance
*   **NFR-SEC-1 (Data Isolation):** Multi-tenant database queries must utilize a global tenant filter middleware to prevent leakage.
*   **NFR-SEC-2 (Encryption):** All data must be encrypted in transit via TLS 1.3 and at rest using AES-256 (including Meta API tokens stored in the DB).
*   **NFR-SEC-3 (Privacy):** Conversations must comply with standard GDPR policies (tenants must have the ability to export and delete customer records upon request).

### 9.2 Reliability & Scaling
*   **NFR-REL-1 (Concurrency):** Webhook workers must scale horizontally to support burst traffic of up to 500 concurrent incoming messages without message drops.
*   **NFR-REL-2 (Idempotency):** The webhook parser must handle duplicate Meta webhook delivery (Meta payload `id` check) to prevent duplicate AI responses.

### 9.3 Performance
*   **NFR-PER-1 (End-to-End Latency):** The overall round-trip time from customer WhatsApp message delivery to AI response delivery must not exceed **3.5 seconds** (assuming normal LLM API performance).
*   **NFR-PER-2 (UI Real-time Sync):** The Live Chat UI must reflect new incoming and outgoing messages within 100ms of state changes.

---

## 10. Success Metrics

| Metric Group | ID | Metric Definition | Target MVP Baseline |
| :--- | :--- | :--- | :--- |
| **Product Engagement** | PM-01 | **Average Response Time** | < 3.0 seconds |
| | PM-02 | **AI Resolution (Deflection) Rate** | > 70% of total incoming chats |
| | PM-03 | **Human Takeover Rate** | < 30% of total incoming chats |
| **SaaS Performance** | PM-04 | **Onboarding Drop-off Rate** | < 20% from signup to first test message |
| | PM-05 | **Platform Uptime** | 99.9% availability of webhook router |
| **SaaS Business** | PM-06 | **Gross Margin** | > 75% |

---

## 11. Future Scope (Non-MVP)

The following features are **explicitly excluded** from the MVP scope and deferred to later phases:
1.  **Multi-Channel Unified Inbox:** Adding Instagram Direct, Facebook Messenger, Telegram, and Live Web chat widgets.
2.  **Outbound Messaging Broadcasts:** Bulk-campaign engine allowing tenants to send marketing templates to user lists within Meta guidelines.
3.  **Advanced Integrations:** Direct native syncing with CRMs (Salesforce, HubSpot) and E-commerce platforms (Shopify, WooCommerce) to look up live orders and modify database states.
4.  **Voice AI Employees:** Enabling real-time voice-to-voice interactive call handlers on WhatsApp.

---

## 12. Risks and Assumptions

### 12.1 Key Assumptions
*   **Meta API Access:** We assume that tenants can obtain official WhatsApp Phone Number IDs and complete Meta Business Verification to scale their messaging.
*   **Third-party LLM Availability:** We assume OpenAI, Anthropic, or equivalent models maintain high availability and do not suffer extended outages.

### 12.2 Critical Risks & Mitigation Strategies

| ID | Identified Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **R-01** | **LLM Hallucinations:** AI provides incorrect pricing or wrong store policies. | High | **Strict Prompt engineering,** limiting context search purely to the vector DB, and setting the model `temperature` to 0. Also, providing the **Structured Q&A override module** to lock in absolute facts. |
| **R-02** | **Meta Webhook Rate Limiting / Blocking:** Meta rate-limits the platform's central Webhook URL. | High | Implement a **Redis-backed message queue** to instantly offload webhook payloads and reply to Meta with a fast `200 OK`, separating ingestion from LLM processing. |
| **R-03** | **Meta Business Verification Friction:** Tenants abandon onboarding because they find Meta Developer Account setup too difficult. | Medium | Provide interactive, step-by-step documentation guides with video tutorials in the onboarding dashboard. Implement standard embedded signups once the platform grows. |
| **R-04** | **Unbounded Token / API Costs:** A single rogue end-customer spams an AI Employee, incurring huge OpenAI/Meta API costs for the tenant. | High | Implement strict **rate-limiting per contact** (e.g., maximum 10 messages per minute, 50 per day) and enforce hard monthly spending limits per tenant. |
