# AI Workforce — Autonomous Operations Team

A B2B multi-tenant SaaS platform where businesses deploy specialized, autonomous AI employees across Customer Support, Sales, Marketing, Operations, and Finance.

Evolved from the **AI Employee Platform**, the system integrates official Meta Cloud API WhatsApp messaging, pgvector RAG, and real-time human takeover as the foundation for the **Support AI Employee**, while establishing a reusable multi-agent workforce orchestration layer with strict human approval gates.

## Architecture & Tech Stack

- **Frontend:** Next.js + TypeScript + Tailwind CSS + Shadcn UI (`apps/web`)
- **Backend:** Express.js + TypeScript (`apps/api`)
- **Database ORM:** Prisma ORM
- **Database:** PostgreSQL + pgvector
- **Queue / Event Router:** Redis + BullMQ
- **Real-Time:** Socket.io
- **Package Manager:** npm (npm workspaces)
- **Shared Primitives:** TypeScript types and contracts (`packages/shared`)

## Project Structure

```text
ai-workforce/
├── apps/
│   ├── api/                           # Express backend API
│   └── web/                           # Next.js frontend web app
├── packages/
│   └── shared/                        # Shared types and domain primitives
├── docs/                              # System documentation & specifications
│   ├── 01-product-requirements.md     # Baseline PRD
│   ├── 02-software-requirements-specification.md # Software requirements (Express.js)
│   ├── 03-database-design.md          # Database design (Support baseline)
│   └── 04-ai-workforce-architecture.md# Full AI Workforce architecture & domain model
├── AI_Workforce_Phase_Documents/      # 10-Phase implementation guide (Phases 00–09)
├── tasks/
│   └── master-roadmap.md              # Sequenced master implementation roadmap
├── GEMINI.md                          # Foundational AI guidelines & interaction rules
├── README.md                          # Project overview
└── package.json                       # Monorepo workspaces configuration
```

## Implementation Phases

The platform is developed strictly in sequential, bounded phases:

- **Phase 00:** Product Vision & Architecture (Done)
- **Phase 01:** Platform Foundation (Done — Prisma, PostgreSQL, Auth, RBAC, Tenant Isolation)
- **Phase 02:** Support AI Employee (Done — WhatsApp Webhook, BullMQ, pgvector RAG, Live Chat, Human Handoff)
- **Phase 03:** Sales AI Employee (Done — Tenant-scoped CRM, scoring, follow-ups, sales policies, approvals, and audit history)
- **Phase 04:** Marketing AI Employee (Done — Brand rules, campaign planning, content validation, approval-gated publishing, metrics, and attribution)
- **Phase 05:** Operations & Inventory AI Employee (Done — Products, suppliers, locations, transactional inventory, alerts, reorder approvals, and demand signals)
- **Phase 06:** Finance & Accounting AI Employee (Done — Immutable financial records, categorization, reconciliation, reports, invoice drafts, payment statuses, and approval-first controls)
- **Phase 07:** Workforce Orchestrator & Agent Graph (Done — Deterministic graph execution, explicit context, retries, approvals, events, and traceability)
- **Phase 08:** Harness, Verification & Trust (Done — Tool permissions, JSON Schema verification, approvals, rate limits, idempotency, run inspection, and auditability)
- **Phase 09:** Autonomous Operations & Headless Execution (Done — Persisted schedules, event triggers, retries, budgets, notifications, heartbeats, and owner dashboard)

## Getting Started

## Security hardening: tool registry and tenant-scoped permissions

This task hardens the harness tool boundary without broad RBAC or environment work.

- Tool definitions are now unique per tenant, so a tool name in one tenant cannot be resolved from another tenant.
- Tool lookup is scoped to the current tenant during registration and invocation.
- Agent tool execution is blocked when the active agent version has a non-empty allowlist and the target tool is not explicitly permitted.
- Tool invocation continues to require the actor to hold every permission declared by the tool, preventing privilege escalation through permission-only bypasses.

Remaining risk: this change addresses the registry boundary and agent allowlist enforcement only. It does not yet cover broader RBAC hardening, production secret policy, monitoring, or operations dashboards.

### Development Scripts

```bash
# Install dependencies
npm install

# Build all workspaces
npm run build

# Run development servers concurrently
npm run dev
```
