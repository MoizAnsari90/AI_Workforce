# AI Workforce — Phase Document Index

These documents are designed to be executed **one phase at a time** by Gemini/another coding agent.

## Execution order

1. `PHASE-00-PRODUCT-VISION-AND-ARCHITECTURE.md`
2. `PHASE-01-PLATFORM-FOUNDATION.md`
3. `PHASE-02-SUPPORT-AI-EMPLOYEE.md`
4. `PHASE-03-SALES-AI-EMPLOYEE.md`
5. `PHASE-04-MARKETING-AI-EMPLOYEE.md`
6. `PHASE-05-OPERATIONS-INVENTORY-AI-EMPLOYEE.md`
7. `PHASE-06-FINANCE-ACCOUNTING-AI-EMPLOYEE.md`
8. `PHASE-07-WORKFORCE-ORCHESTRATOR-AND-GRAPH.md`
9. `PHASE-08-HARNESS-VERIFICATION-AND-TRUST.md`
10. `PHASE-09-AUTONOMOUS-OPERATIONS-AND-LEAVING-THE-LAPTOP.md`

## Important operating rule

Do NOT give Gemini all phase documents as simultaneous implementation instructions.

For each phase:
1. Read the phase document.
2. Inspect the current repository.
3. Inspect existing project docs and `GEMINI.md`.
4. Identify conflicts before changing code.
5. Create a plan.
6. Implement only this phase.
7. Run tests, lint and build.
8. Update progress/status documentation.
9. Stop and review before starting the next phase.

## Project strategy

This is an evolution of the existing **AI Employee Platform**. Do not create a second repository unless there is a separately approved reason.

The existing WhatsApp + RAG + Human-in-the-Loop work is retained and becomes the Support AI Employee foundation.

## Architecture rule

Future agents should be implemented as reusable platform components, not as unrelated mini-applications.

## Safety rule

Autonomy must always be bounded by:
- permissions
- policies
- verification
- audit logs
- human approval for risky actions

## Change-control rule

If a later phase appears to require changing an earlier phase:
- document the conflict,
- propose the migration,
- do not silently rewrite the architecture,
- get approval before destructive changes.

## Definition of "done"

A phase is done only when:
- acceptance criteria pass,
- tests pass,
- lint/build pass,
- documentation is updated,
- tenant isolation is preserved,
- no known critical regression remains.
