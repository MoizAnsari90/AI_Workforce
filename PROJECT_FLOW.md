# AI Employee Platform — Complete Architecture, Flow & Feature Guide

Yeh document **AI Employee Platform** (Multi-tenant SaaS) ka mukammal overview, project flow, agents ki working, aur recent major enhancements (Action Tools, HITL Approvals, Niche Templates, Voice Agents, WhatsApp Settings, Toast Notifications, Agent Pause/Resume, Live DB Dashboard, aur Cyberpunk Dark Theme UI) ki tafseel bayan karta hai.

---

## 1. Project Overview: Ye Project Kia Hai aur Kis Kaam Ka Hai?
**AI Employee Platform** aik enterprise-grade Multi-tenant SaaS application hai jo businesses ko mukhtalif autonomous AI Agents (Virtual Employees) deploy karne ki sahulat deti hai. Yeh agents business ke mukhtalif departments (Customer Support, Sales, Marketing, Operations, Finance) ko automate karte hain, tasks execute karte hain, aur Gemini AI / LLM ki taqat se intelligent decisions lete hain.

### Hum Is Se Kia Kar Sakte Hain?
- **Multi-Tenant Setup:** Independent workspaces aur strict tenant isolation ke sath companies register hoti hain.
- **Action-Oriented API Execution:** Agents sirf text generate nahi karte, balkay external APIs (Shopify refunds/stock, QuickBooks/Xero invoices, CRM leads) par direct actions execute کرتے hain.
- **Human-in-the-Loop (HITL) Approvals:** High-risk ya high-value actions (jaise refunds, POs > $1000) automatically pause ho kar admin approval queue mein jate hain.
- **Vertical Niche Workflow Bundles:** Pre-configured industry templates (E-commerce Operations, Real Estate Lead Qualification) one-click deploy kiye ja sakte hain.
- **Real-Time Voice Agents:** Inbound/Outbound voice calls via Vapi aur Retell AI ke sath integrate kar ke call transcripts aur intents process kiye jate hain.
- **WhatsApp Integration Settings:** Tenants apna WhatsApp Business API Phone Number ID aur Access Token secure settings page (`/dashboard/settings/whatsapp`) se configure kar sakte hain.

---

## 2. Tech Stack & Theme UI
- **Backend:** Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, BullMQ (Redis queue), Google Gemini API (`@google/genai`).
- **Frontend:** Next.js (App Router), React, Tailwind CSS, shadcn/ui components.
- **Visual Design & Animation:** Cyberpunk dark theme (`#040914`), glowing cyan accents, and smooth upright orbital animations featuring 6 specialized AI agents revolving around a central AI brain node.
- **Notifications:** Global Toast Notification system (`ToastContext`) replacing browser alerts.

---

## 3. Architecture & Request Flow
Project monorepo architecture par mushtamil hai:
```
D:\Agent\
├── apps\
│   ├── api\        # Backend Express API, Prisma schema, Tools, Services, AI Agents
│   └── web\        # Next.js Dashboard UI, Approvals, Templates, Voice Logs, WhatsApp Settings
├── packages\
│   └── shared\     # Shared types and utilities
```

### Core Execution Flow:
1. **Inbound Event / Request / Webhook:** User action, webhook (WhatsApp, Shopify, Vapi, Retell), ya UI request backend par aati hai.
2. **Tenant Isolation & Security:** `enforceTenantIsolation` aur `rbacMiddleware` ensure karte hain ke request secure aur authorized hai.
3. **Action Interception & HITL Guardrail (`ActionExecutorService`):**
   - Agar action risky hai (e.g. Shopify refund, high-value PO), toh execution pause ho kar `ApprovalRequest` (`pending`) create hoti hai aur Real-time Socket.io event (`approval:created`) dashboard par emit hota hai.
   - Agar action low-risk hai ya approved hai, toh mutaliqa tool (`ShopifyTool`, `QuickBooksTool`, `CrmTool`) direct external API execution perform karta hai.
4. **Audit Logging & Live Metrics:** Har autonomous action aur human review immutable `AuditLog` mein record hota hai, aur dashboard par live database metrics fetch hote hain.

---

## 4. Specialized Agents & Core Services

1. **Support AI (`supportAgentService.ts`, `whatsappService.ts`)**: Handles customer conversations, FAQs, RAG retrieval, and Shopify order actions/refunds.
2. **Sales AI (`salesService.ts`, `leadService.ts`)**: Manages lead scoring, pipelines, CRM lead creation, and real estate qualification voice calls.
3. **Marketing AI (`marketingService.ts`)**: Plans campaigns, drafts content, and enforces strict HITL publishing gates.
4. **Operations AI (`operationsService.ts`)**: Tracks inventory, warehouse locations, stock alerts, and automated purchase orders.
5. **Finance AI (`financeService.ts`)**: Manages financial records, invoices, payment records, and QuickBooks/Xero ledger integrations.
6. **Voice Agents (`voiceService.ts`, `VoiceSession`)**: Integrates Vapi & Retell AI webhooks to process call transcripts, intents, and summaries.
7. **Template Store (`templateService.ts`)**: Manages pre-configured niche workflow bundles and 1-click tenant deployments (`/dashboard/templates`).
8. **Agent Control Center (`/dashboard`)**: Live DB metrics, recent activity feed, and **Agent Pause/Resume** toggle switches (`PATCH /api/v1/tenants/:tenantId/agents/:agentId/toggle`).

---

## 5. Summary
Yeh platform complete Autonomous AI Workforce ecosystem provide karta hai jahan AI employees business operations ko 24/7 autonomously run karte hain, jabkay HITL Approval Engine, Strict Tenant Isolation, aur Cyberpunk UI isay enterprise-grade SaaS banate hain.
