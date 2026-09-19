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
- Verification/checkers (including API execution response verification checkers for Shopify, CRM, and QuickBooks/Xero API success confirmation)
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

## Non-Goals
- Perfect autonomy.
- Removing human oversight.

## Gemini Instruction
Treat the harness as a first-class product component, not scattered if-statements. Keep policies centralized and testable.
