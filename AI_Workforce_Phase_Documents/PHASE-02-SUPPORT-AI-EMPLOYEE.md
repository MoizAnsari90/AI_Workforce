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
- OpenAI response generation
- Conversation memory
- AI active/inactive state
- Human takeover
- Live chat
- Socket.io
- Agent audit trail
- Support agent configuration
- Business tone/instructions

## Message Flow
WhatsApp
→ Webhook
→ Fast acknowledgement
→ BullMQ
→ Support Agent
→ FAQ
→ RAG if needed
→ LLM
→ Policy/verification
→ WhatsApp

If AI is inactive:
WhatsApp
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
