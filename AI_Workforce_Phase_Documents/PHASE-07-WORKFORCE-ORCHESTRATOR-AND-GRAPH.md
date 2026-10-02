# Phase 07 — Workforce Orchestrator & Agent Graph

## Goal
Connect specialized AI employees into a coordinated workforce.

## Depends On
Phases 01–06.

## Core Concept
Agents should not operate as isolated chatbots.

Example:
Marketing
→ Lead
→ Sales
→ Support
→ Order
→ Operations
→ Finance

## Orchestrator Responsibilities
- Understand business goal
- Select appropriate agent
- Create/route tasks
- Pass approved, minimum-necessary context
- Track execution
- Handle failures, timeouts, and ambiguous provider outcomes
- Request human approval
- Resume work after approval
- Maintain workflow state
- Enforce tenant-scoped idempotency before every state-changing or external action
- Schedule and reconcile WhatsApp/Voice appointment reminders
- Route low-confidence, policy-ambiguous, privacy-sensitive, or failed work to the authenticated same-tenant human inbox
- Enforce healthcare non-medical diagnosis and emergency-routing guardrails
- Preserve privacy boundaries when passing context between agents

## Graph Model
Represent workflows as nodes and transitions.

Node examples:
- Agent task
- Tool action / `ACTION_TOOL_EXECUTION` (Direct API calls: Shopify, CRM, QuickBooks)
- Idempotency claim / `IDEMPOTENCY_GATE` (State transition: `NEW` → `CLAIMED` → `SUCCEEDED` or `FAILED`)
- Verification / `VERIFICATION_GATE`
- Approval / `HITL_APPROVAL_GATE` (State transition: `PENDING_APPROVAL` → Human Decision → Resume/Abort)
- Voice Call Session / `VOICE_CALL_SESSION` (Retell AI / Vapi integration nodes)
- Reminder / `REMINDER_SCHEDULE` (WhatsApp/Voice reminder delivery, acknowledgement, retry, and no-response handling)
- Human handoff / `HUMAN_HANDOFF` (low confidence, emergency, failed execution, or edge case)
- Wait/event

## Cross-Agent Reliability Contract
- Every agent handoff carries an explicit tenant ID, workflow/run ID, idempotency key, permission scope, and minimum-necessary context.
- A downstream agent may not repeat a state-changing action without replaying the original idempotency result.
- Failed or ambiguous nodes are retried only when the retry is provably safe; otherwise they pause for HITL.
- Reminder jobs are scheduled once per appointment event and reconciled by stable appointment ID.
- Healthcare context is minimized and never used to make a diagnosis; emergency signals trigger immediate human escalation.
- Cross-agent execution is observable from trigger to provider confirmation and audit record.

## Acceptance Criteria
- A business workflow can invoke multiple agents.
- Context passed between agents is explicit, tenant-scoped, permission-scoped, and limited to the minimum necessary data.
- Agent permissions remain isolated.
- Failed or ambiguous nodes can be retried safely or paused for HITL.
- Human approval pauses and resumes workflows.
- Every workflow execution is traceable from trigger through provider confirmation and audit record.
- Duplicate events do not create duplicate irreversible actions.
- Tenant-scoped idempotency keys are enforced before every state-changing or external action.
- Healthcare and real-estate reminder jobs are scheduled once per appointment event, reconciled by stable appointment ID, and track delivery/acknowledgement outcomes.
- Low-confidence, privacy-sensitive, policy-ambiguous, and failed work routes to the authenticated same-tenant human inbox.
- Healthcare workflows enforce non-medical diagnosis and emergency-routing guardrails.
- Privacy tests prove encrypted sensitive data and cross-tenant denial across agent handoffs.

## Non-Goals
- Fully open-ended agent-to-agent behavior.
- Unbounded recursive agent spawning.

## Gemini Instruction
Prefer deterministic, observable workflows. Do not let agents call arbitrary other agents without orchestrator policy.
