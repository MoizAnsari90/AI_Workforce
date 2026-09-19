# Phase 00 — AI Workforce Product Vision & Architecture

## Purpose
Transform the existing **AI Employee Platform** into **AI Workforce — Your Business's Autonomous Operations Team**.

This phase is architecture/specification only. Do not implement major business features yet.

## Product Vision
Build a B2B multi-tenant SaaS where a business can deploy specialized AI employees for:
- Customer Support (including direct Shopify actions and Real-Time Voice Calls via Retell AI / Vapi)
- Sales (including CRM lead creation and Real-Time Voice Qualification Calls)
- Marketing (with strict Human-in-the-Loop publishing gates)
- Operations / Inventory (with automated supplier POs and Shopify stock syncing)
- Finance / Accounting (with direct QuickBooks / Xero API integrations)
- Pre-configured Vertical Niche Templates (e.g., E-commerce Operations Bundle, Real Estate Lead Qualification Bundle)
- Custom agents and workflows

The system must support autonomous work while keeping humans as approval gates for risky, irreversible, sensitive, or high-value actions via a robust Human-in-the-Loop (HITL) Approval Engine.

## Critical Decision
**Do NOT create a new project. Evolve the existing AI Employee Platform repository.**

The existing WhatsApp + RAG + human takeover implementation becomes the foundation for the future **Support AI Employee**.

## Engineering Principles
1. Spec before implementation.
2. Tenant isolation is mandatory.
3. Every agent has explicit responsibilities, tools, permissions and success criteria.
4. Every autonomous action must be auditable.
5. Risky actions require human approval (HITL Approval Gate).
6. Action-Oriented Execution: Separate generation/drafting from direct external API execution (Shopify, CRM, QuickBooks/Xero, etc.).
7. Verification must be separate from generation where practical.
8. Agents must use shared business context but must not have unrestricted access.
9. Prefer reusable platform primitives over department-specific duplicated code (including pre-configured Niche Templates).
10. Real-time voice and multichannel execution (WhatsApp, Web, Retell AI / Vapi) must be natively supported.
11. Do not change the approved technology stack without explicit approval.
12. Preserve backward compatibility when extending existing functionality.

## Target High-Level Architecture

Business Dashboard / Niche Templates
→ Workforce Orchestrator
→ Specialized Agents (Support, Sales, Marketing, Ops, Finance)
→ Channels (WhatsApp, Web, Voice/Retell AI / Vapi)
→ Tool / Action Integration Layer (Shopify, CRM, QuickBooks, etc.)
→ Human-in-the-Loop (HITL) Approval Engine
→ Business Data + Knowledge + Memory
→ Verification / Policy / Approval Layer
→ Audit Logs

## Core Platform Domains
- Tenants
- Users / RBAC
- Businesses
- Agents & Agent Templates
- Workflows & Workflow Templates (Niche Bundles)
- Action-Oriented Tool Executions
- Human Approval Requests & Queues
- Voice Sessions (Retell AI / Vapi)
- External Integration Credentials & Secrets

## Non-Goals
- Do not build every department in this phase.
- Do not add random frameworks.
- Do not rewrite working code without architectural justification.
- Do not introduce autonomous financial transactions yet.

## Deliverables
- Updated architecture document
- Updated domain model
- Agent boundaries
- Tool/permission model
- Event model
- Human approval model
- Phase-by-phase implementation roadmap

## Definition of Done
Architecture is documented, reviewed, internally consistent, and maps cleanly to the existing repository.

## Gemini Instruction
Read the existing repository documentation first. Treat this document as the product direction. Do not implement features from later phases. Identify conflicts with existing architecture before changing anything.
