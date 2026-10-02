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
- Direct QuickBooks / Xero API Integrations for posting invoices, recording expenses, and executing audit-logged reconciliations
- Strict HITL Approval Gates for all external accounting ledger writes
- Strict idempotency checks for every external API call, including `QuickBooksTool` and Xero actions
- Durable `IdempotencyLog` with a unique `(tenantId, idempotencyKey)` constraint, request hash, status, provider reference, response snapshot, attempt count, and timestamps
- Replay semantics: the same key returns the original result; retries never create a second invoice, expense, payment, reconciliation, or ledger entry
- Provider timeout and ambiguous-outcome reconciliation before retry; unresolved outcomes route to HITL rather than being guessed

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
- any external ledger write without a verified idempotency claim and provider confirmation

## External API Idempotency Contract
Every external finance action must:
1. Validate the caller, tenant, permissions, policy, and request hash.
2. Atomically claim a tenant-scoped idempotency key in `IdempotencyLog` before invoking `QuickBooksTool` or the relevant provider adapter.
3. Execute the provider call only after the claim succeeds.
4. Store the provider reference and normalized response.
5. Return the stored result for a repeated key, even when the original call timed out or the provider response was lost.
6. Block retries that could duplicate a financial transaction; route ambiguity to a human approval queue.

## Acceptance Criteria
- Financial records are tenant-isolated.
- Reports can be generated.
- Agent actions are auditable.
- Sensitive operations are permission-controlled.
- Approval requests work.
- No financial action bypasses policy.
- Every external finance action uses a tenant-scoped idempotency key and durable `IdempotencyLog`.
- Repeated requests with the same idempotency key return the original result without creating duplicate ledger entries.
- Provider timeout, retry, and partial-failure scenarios are tested.
- Tests cover duplicate prevention, human fallback, and cross-tenant denial.

## Non-Goals
- Autonomous banking.
- Autonomous tax filing.
- Replacing licensed financial professionals.

## Gemini Instruction
Implement finance as an approval-first domain. Never introduce an unrestricted money-moving tool.
