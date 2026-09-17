# Phase 09 — Autonomous Operations / Leaving the Laptop

## Goal
Enable the AI Workforce to operate continuously through events and scheduled loops while keeping humans in control of risky decisions.

## Depends On
Phase 08.

## Heartbeats / Triggers
Support:
- scheduled jobs
- incoming webhooks
- business events
- task completion events
- threshold alerts

## Standard Agent Loop
Discover
→ Plan
→ Implement/Act
→ Verify
→ Record
→ Continue / Escalate

## Example
Every morning:
- Marketing checks campaign performance.
- Sales checks uncontacted leads.
- Support checks unresolved conversations.
- Operations checks inventory.
- Finance prepares daily summaries.

The owner receives only meaningful exceptions and approval requests.

## Human Gate
Notify human for:
- risky actions
- financial actions
- policy exceptions
- low-confidence decisions
- destructive actions
- configured high-value actions

## Reliability Requirements
- Jobs must be idempotent.
- Failed jobs must be retryable.
- Long-running workflows must persist state.
- Every action must be observable.
- No silent failure.
- No uncontrolled infinite loops.
- Rate limits and budgets must exist.

## Acceptance Criteria
- Scheduled workforce jobs execute reliably.
- Event-driven workflows work.
- Workflow state survives process restart.
- Failed work can resume safely.
- Human approvals pause/resume execution.
- Owner dashboard shows active runs, failures and approvals.
- Audit history is complete.
- Production monitoring and alerting exist.

## Final Outcome
The platform can perform routine business operations autonomously while humans retain strategic control and approval authority.

## Gemini Instruction
Do not interpret "autonomous" as unrestricted. Autonomy is bounded by policies, permissions, verification and human gates.
