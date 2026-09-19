# Phase 02 — Support AI Employee

## Goal
Turn the existing WhatsApp AI Employee functionality into the first production-quality AI Workforce employee.

## Depends On
Phase 01.

## Scope
- Meta WhatsApp Cloud API
- Webhook ingestion
- BullMQ asynchronous processing
- FAQ matching
- pgvector RAG
- LLM response generation
- Conversation memory
- AI active/inactive state
- Human takeover
- Live chat
- Socket.io
- Agent audit trail
- Support agent configuration
- Business tone/instructions
- Direct Shopify Action Execution (Order Cancel, Order Refund via Shopify API)
- Real-Time Voice/Call Agent Support (Inbound/Outbound Voice Calls via Retell AI / Vapi integrations)
- Human-in-the-Loop (HITL) Approval Flow for high-value refunds or exception actions

## Message Flow
WhatsApp / Voice Call (Retell AI / Vapi)
→ Webhook
→ Fast acknowledgement
→ BullMQ
→ Support Agent
→ FAQ / RAG / Direct Action Tool (Shopify)
→ Threshold Check (e.g., Refund amount ≤ $50 vs > $50)
→ If risky/high-value: HITL Approval Queue → Human Decision → Resume/Abort
→ LLM
→ Policy/verification
→ WhatsApp / Voice Response

If AI is inactive:
WhatsApp / Voice
→ Queue
→ Conversation
→ Human Inbox
→ Human response

## Safety
The Support Agent must not invent:
- order information
- refunds
- policies
- delivery status
- customer-specific facts

If confidence is insufficient, escalate.

## Acceptance Criteria
- Webhook responds quickly.
- Messages are processed asynchronously.
- FAQ matching works.
- RAG retrieval works.
- AI can be paused per conversation/contact.
- Human message automatically pauses AI where specified.
- Human can resume AI.
- All relevant actions are logged.
- Tests cover AI/human handoff.
- No cross-tenant conversation access.

## Non-Goals
- Sales automation.
- Marketing automation.
- Financial actions.

## Gemini Instruction
Preserve existing working WhatsApp/RAG behavior. Refactor only where required to make it a reusable Support Agent within the Workforce architecture.
