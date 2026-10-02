# Phase 08 — Harness Engineering, Verification & Trust

## Goal
Build the safety and reliability harness around the AI Workforce.

## Depends On
Phase 07.

## Harness Components
- Agent instructions/specs
- Tool registry
- Tool permissions
- Policy engine
- Centralized Approval Policy Engine (managing HITL thresholds and rules)
- Context boundaries
- Approval gates
- Verification/checkers (including API execution response verification checkers for Shopify, CRM, QuickBooks/Xero, and clinic scheduling APIs)
- Healthcare non-medical diagnosis and emergency-routing policy checker
- Privacy and field-level encryption verifier
- Reminder delivery and acknowledgement verifier
- Idempotency and duplicate-action verifier
- Rate limits
- Timeouts
- Retry policies
- Idempotency
- Audit logs
- Observability
- Evaluation datasets

## Trust Model
Never trust an agent's statement that work is complete.

Use independent evidence:
- tests
- schema validation
- business rules
- checker agents
- deterministic validators
- external API confirmation where available
- idempotency-log replay evidence
- privacy and tenant-isolation checks

## Verification Rules
### Medical Safety
- A healthcare receptionist may perform administrative scheduling, intake, service-information, and routing tasks only.
- The verifier must reject any output or tool plan that issues a diagnosis, prescribes treatment, recommends medication, interprets symptoms as a diagnosis, or directs an emergency into an automated clinical workflow.
- Emergency language must produce a safe emergency-services instruction and a same-tenant human escalation record.
- Medical-safety violations are release-blocking and must be represented in evaluation datasets.

### Duplicate Action Prevention
- Every state-changing or external action must have a tenant-scoped idempotency key and a durable `IdempotencyLog`.
- The verifier must prove that repeated requests with the same key return the original result and do not create a second refund, cancellation, booking, slot lock, CRM record, or ledger entry.
- Ambiguous provider responses, timeouts, and partial failures must be reconciled or routed to HITL; they must never be blindly retried.
- Duplicate-action tests are required for every external tool adapter.

## Example
Agent:
"Invoice created."

Checker:
- Is invoice valid?
- Is customer correct?
- Is amount within policy?
- Was it actually persisted?
- Was the external API successful?

Only then:
PASS.

## Acceptance Criteria
- Every tool has permissions.
- Risk levels are defined.
- High-risk tools require approval.
- Verification is executed before configured actions are considered complete.
- Failed verification blocks downstream actions.
- Audit logs contain actor, tenant, action, result and timestamp.
- Agent runs can be inspected.
- Security tests cover privilege escalation attempts.
- Healthcare evaluation cases prove agents never diagnose, prescribe, recommend medication, or automate emergency handling.
- Emergency-language cases prove immediate emergency-services guidance and human escalation.
- Duplicate-action tests prove repeated idempotency keys cannot create duplicate refunds, cancellations, bookings, slot locks, CRM records, or ledger entries.
- Reminder tests prove 24-hour WhatsApp/Voice scheduling, delivery tracking, acknowledgement, retry, and no-response behavior.
- Privacy tests prove tenant isolation, field-level encryption, log redaction, consent enforcement, and cross-tenant denial.

## Non-Goals
- Perfect autonomy.
- Removing human oversight.

## Gemini Instruction
Treat the harness as a first-class product component, not scattered if-statements. Keep policies centralized and testable.
