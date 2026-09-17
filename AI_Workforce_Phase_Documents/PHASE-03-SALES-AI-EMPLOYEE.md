# Phase 03 — Sales AI Employee

## Goal
Create an AI Sales Employee that manages lead qualification and follow-up while respecting business rules and human approval.

## Depends On
Phase 02.

## Scope
- Lead entity
- Lead lifecycle
- Contact/company information
- Lead qualification
- Sales pipeline
- Lead scoring
- Follow-up tasks
- WhatsApp/email integration through approved tools
- CRM activity history
- Sales agent memory
- Sales policies
- Human approval for sensitive actions

## Example Flow
New Lead
→ Research / retrieve known information
→ Qualify
→ Score
→ Contact
→ Follow-up
→ Update CRM
→ Proposal
→ Human approval when required
→ Close

## Guardrails
Sales Agent cannot:
- invent lead data
- promise unsupported discounts
- alter pricing outside policy
- close high-value deals without configured approval
- delete important CRM records

## Acceptance Criteria
- Leads can be created and tracked.
- Qualification criteria are configurable.
- Sales activities are auditable.
- Follow-up tasks can be scheduled.
- Agent respects communication policies.
- Human approval works for configured risky actions.
- Tenant isolation is maintained.
- Tests cover lead lifecycle and approval paths.

## Non-Goals
- Full autonomous negotiation.
- Financial transfers.
- Complex forecasting.

## Gemini Instruction
Build reusable CRM/task primitives rather than hard-coding a single business's sales process.
