# Phase 06 — Finance & Accounting AI Employee

## Goal
Create a finance assistant that analyzes and organizes financial information while keeping sensitive financial actions under strict controls.

## Depends On
Phase 05.

## Scope
- Revenue records
- Expenses
- Invoices
- Payments/status records
- Basic financial categorization
- Financial reports
- Cash-flow summaries
- Approval workflows
- Finance audit logs

## Initial Autonomy Boundary
Allowed:
- classify
- summarize
- reconcile candidate records
- generate reports
- flag anomalies
- prepare invoices for review

Human approval required for:
- money transfers
- refunds above configured thresholds
- irreversible accounting changes
- high-value financial commitments

## Acceptance Criteria
- Financial records are tenant-isolated.
- Reports can be generated.
- Agent actions are auditable.
- Sensitive operations are permission-controlled.
- Approval requests work.
- No financial action bypasses policy.

## Non-Goals
- Autonomous banking.
- Autonomous tax filing.
- Replacing licensed financial professionals.

## Gemini Instruction
Implement finance as an approval-first domain. Never introduce an unrestricted money-moving tool.
