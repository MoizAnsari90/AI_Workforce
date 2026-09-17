# Project AI Workforce: Autonomous Operations Team

## 1. Introduction
**AI Workforce** is a multi-tenant B2B platform that enables businesses to deploy an autonomous team of specialized AI employees to manage core business functions, transforming manual operations into a scalable, automated engine.

## 2. Project Goal & Purpose
The primary purpose is to shift businesses from **human-only operations** to **AI-assisted/autonomous operations** while maintaining safety via human-in-the-loop (HITL) approval for critical or risky actions. 

## 3. Project Status: COMPLETED
The project has successfully reached full implementation of the 10-phase roadmap, covering architectural vision through autonomous, headless operations. All core features (Support, Sales, Marketing, Operations, Finance, Orchestrator, Verification, and Autonomous Job Scheduling) are implemented, integrated, and verified with an extensive automated test suite.

## 4. Architectural Overview & Agent Collaboration
The architecture is based on a modular, tenant-isolated approach where specialized agents communicate via a central **Workforce Orchestrator** and a common business data/context layer.

### Agent Breakdown
- **Support Agent**: Handles inbound inquiries (FAQ/RAG), auto-escalates high-risk patterns to human inbox.
- **Sales Agent**: Manages lead CRM, qualification, and follow-ups.
- **Marketing Agent**: Plans campaigns, drafts content, enforces brand guidelines, requires human approval for publishing.
- **Operations/Inventory Agent**: Manages stock levels, identifies reorder needs, generates PO drafts.
- **Finance Agent**: Tracks financial records, invoice drafting, expense categorization (read-only for sensitive financial movement).
- **Workforce Orchestrator**: Manages workflow graphs, inter-agent context passing, and state persistence.
- **Verification Harness**: Validates all tool inputs/outputs, enforces permission/risk policies, and prevents unauthorized actions.

### Interaction Model
Agents operate within a "permissioned sandbox." They interact with business data via validated tools. High-risk actions automatically trigger a persistent `ApprovalRequest` record, pausing the agent or orchestrator until a human administrator approves or rejects the action via the dashboard.

## 5. User Guide
1. **Tenant Onboarding**: Each business is set up as a tenant with isolated data.
2. **Configuration**: Administrators configure agent behaviors, brand voice, and approval thresholds in the Business Dashboard.
3. **Execution**:
    - **Inbound/Event-driven**: Agents react to WhatsApp messages, leads, or low-stock alerts.
    - **Scheduled/Autonomous**: Headless jobs (managed by the orchestrator) perform daily health checks, inventory reconciliations, or summary report generation.
4. **Human-in-the-Loop (HITL)**: Administrators review and take action on `ApprovalRequest` entries, pause/resume agents, and directly address escalated queries from the human inbox dashboard.

## 6. Implementation Documentation (`AI_Workforce_Phase_Documents`)
This directory contains the specification and design evolution for the platform:
- **PHASE-00**: Core architecture, domain model, and principles.
- **PHASE-01-10**: Detailed design for each functional department, the orchestrator/harness layers, and commercial SaaS readiness.
- **PHASE-INDEX-AND-EXECUTION-GUIDE**: Map to implementation and validation status.

---

*This document serves as the high-level project index for LLM agents to understand current scope and architectural constraints.*
