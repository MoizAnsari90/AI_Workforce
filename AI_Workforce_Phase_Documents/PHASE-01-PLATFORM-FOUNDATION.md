# Phase 01 — AI Workforce Platform Foundation

## Goal
Finish the reusable SaaS foundation required by every future AI employee.

## Depends On
Phase 00.

## Scope
- PostgreSQL + pgvector
- Redis
- Prisma
- Database migrations
- Multi-tenant data model
- Authentication
- RBAC
- Tenant isolation
- Configuration management
- API error handling
- Logging
- Audit foundation
- Shared TypeScript types

## Required Principles
Every tenant-owned record must have a clear tenant boundary.

Never rely only on frontend filtering for tenant security.

Every authenticated request must resolve:
- user
- tenant
- role
- permissions

## Suggested Core Entities
Tenant
User
Role
Permission
Business
Agent
AgentVersion
Task
Workflow
Tool
ApprovalRequest
AuditLog
KnowledgeSource
DocumentChunk
Conversation
Message
Event

## Acceptance Criteria
- Local PostgreSQL and Redis run reliably.
- Prisma schema and migrations work from a clean database.
- API health check works.
- Authentication works.
- RBAC is enforced server-side.
- Tenant A cannot read/write Tenant B data.
- Audit records can be created for sensitive actions.
- Tests cover authentication and tenant isolation.
- Build/lint/tests pass.

## Non-Goals
- No marketing/sales/finance automation yet.
- No autonomous production actions.
- No broad rewrite of existing WhatsApp functionality.

## Gemini Instruction
First inspect current code and docs. Implement only foundation requirements. After each logical unit, run appropriate tests and validation. Do not mark the phase complete if tenant isolation is untested.
