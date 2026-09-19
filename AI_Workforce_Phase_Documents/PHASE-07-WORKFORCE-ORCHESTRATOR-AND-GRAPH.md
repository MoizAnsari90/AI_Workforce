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
- Pass approved context
- Track execution
- Handle failures
- Request human approval
- Resume work after approval
- Maintain workflow state

## Graph Model
Represent workflows as nodes and transitions.

Node examples:
- Agent task
- Tool action / `ACTION_TOOL_EXECUTION` (Direct API calls: Shopify, CRM, QuickBooks)
- Verification
- Approval / `HITL_APPROVAL_GATE` (State transition: `PENDING_APPROVAL` → Human Decision → Resume/Abort)
- Voice Call Session / `VOICE_CALL_SESSION` (Retell AI / Vapi integration nodes)
- Wait/event
- Human handoff

## Acceptance Criteria
- A business workflow can invoke multiple agents.
- Context passed between agents is explicit.
- Agent permissions remain isolated.
- Failed nodes can be retried safely.
- Human approval pauses and resumes workflows.
- Every workflow execution is traceable.
- Duplicate events do not create duplicate irreversible actions.

## Non-Goals
- Fully open-ended agent-to-agent behavior.
- Unbounded recursive agent spawning.

## Gemini Instruction
Prefer deterministic, observable workflows. Do not let agents call arbitrary other agents without orchestrator policy.
