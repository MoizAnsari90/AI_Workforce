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
- tenant-scoped integration credentials and approval queues

## Suggested Core Entities
Tenant
User
Role
Permission
Business
Agent
AgentTemplate
AgentVersion
Task
Workflow
WorkflowTemplate
Tool
ApprovalRequest
VoiceSession
ExternalIntegrationCredential
AuditLog
KnowledgeSource
DocumentChunk
Conversation
Message
Event
AppointmentSlot
PatientIntakeRecord
IdempotencyLog

## Sensitive Data and Field-Level Encryption
Sensitive tenant data must be classified before storage and protected independently of general database access controls. At minimum, patient intake notes, medical-context fields, sensitive lead details, integration credentials, and regulated identifiers must be encrypted at rest using field-level encryption or an envelope-encryption service.

Required specifications:
- Use authenticated encryption such as AES-256-GCM, with a unique nonce, authentication tag, algorithm/version metadata, and ciphertext stored separately from plaintext.
- Derive or wrap data keys from tenant-scoped keys managed by a KMS or equivalent key-management boundary; never hard-code keys in source code, environment files, logs, or client bundles.
- Keep encryption/decryption behind a server-side data-protection service with least-privilege access and audit logging.
- Encrypt data in transit with TLS and exclude secrets, raw patient notes, and sensitive lead payloads from logs, analytics events, browser storage, and error messages.
- Apply tenant isolation to encrypted records and their indexes; ciphertext must never be used as a substitute for authorization checks.
- Define retention, export, deletion, backup/restore, key-rotation, and incident-response procedures for regulated data.
- Treat HIPAA/GDPR language as a readiness target requiring legal, security, and operational validation; documentation alone is not certification.

## Acceptance Criteria
- Local PostgreSQL and Redis run reliably.
- Prisma schema and migrations work from a clean database.
- API health check works.
- Authentication works.
- RBAC is enforced server-side.
- Tenant A cannot read/write Tenant B data.
- Audit records can be created for sensitive actions.
- `AppointmentSlot`, `PatientIntakeRecord`, and `IdempotencyLog` migrations and tenant-scoped indexes are present.
- `IdempotencyLog` enforces a unique `(tenantId, idempotencyKey)` constraint and supports atomic claim/replay semantics.
- Sensitive fields are encrypted at rest and decrypted only through an audited server-side service.
- Reminder jobs can be scheduled, retried, acknowledged, and traced without duplicating the underlying appointment action.
- Tests cover authentication, tenant isolation, encryption/decryption, idempotent replay, and cross-tenant access denial.
- Build/lint/tests pass.

## Non-Goals
- No marketing/sales/finance automation yet.
- No autonomous production actions.
- No broad rewrite of existing WhatsApp functionality.

## Gemini Instruction
First inspect current code and docs. Implement only foundation requirements. After each logical unit, run appropriate tests and validation. Do not mark the phase complete if tenant isolation is untested.
