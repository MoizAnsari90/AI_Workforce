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
- Healthcare & Clinic Patient Receptionist workflows for administrative appointment scheduling, slot locking, intake, and routing
- Voice and WhatsApp pre-appointment confirmation workflows, including 24-hour reminders and acknowledgement tracking
- Low-confidence and failed-execution fallback routing to live human agent inboxes
- Tenant-scoped idempotency for refunds, cancellations, slot locks, and appointment actions

## Message Flow
WhatsApp / Voice Call (Retell AI / Vapi)
→ Webhook
→ Fast acknowledgement
→ BullMQ
→ Support Agent
→ FAQ / RAG / Direct Action Tool (Shopify) or Appointment/Intake workflow
→ Threshold Check (e.g., Refund amount ≤ $50 vs > $50; appointment risk/policy check)
→ If risky/high-value: HITL Approval Queue → Human Decision → Resume/Abort
→ LLM
→ Policy/verification
→ WhatsApp / Voice Response

For an appointment or viewing:
Appointment request
→ Validate tenant, patient/prospect, consent, and available slot
→ Atomically lock `AppointmentSlot` with an idempotency key
→ Create/update `PatientIntakeRecord` or lead record with field-level encryption where sensitive
→ Schedule WhatsApp reminder for 24 hours before the event
→ Use Voice reminder if enabled, consented, or WhatsApp delivery fails
→ Record acknowledgement, reschedule, cancellation, or no-response outcome
→ Escalate ambiguity, emergency language, low confidence, or failed tool execution to the live human inbox

If AI is inactive:
WhatsApp / Voice
→ Queue
→ Conversation
→ Human Inbox
→ Human response

If confidence is insufficient or an external API fails:
Agent attempt
→ Preserve structured context and error evidence
→ Pause autonomous action
→ Route to the same-tenant human agent inbox
→ Human decision (`resume`, `abort`, or `correct and retry`)
→ Audit the handoff and outcome

## Safety
The Support Agent must not invent:
- order information
- refunds
- policies
- delivery status
- customer-specific facts
- appointment availability or patient-specific clinical facts

If confidence is insufficient, escalate. Healthcare/Clinic receptionist behavior is strictly administrative: it may schedule, collect intake information, answer non-clinical service questions, and route patients, but must never issue a medical diagnosis, prescribe treatment, recommend medication, or handle an emergency as an automated workflow. Emergency language triggers an immediate instruction to contact emergency services and a human staff escalation.

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
- Healthcare appointment and intake workflows preserve tenant isolation and encrypt sensitive fields.
- WhatsApp/Voice reminders are scheduled 24 hours before appointments and record delivery/acknowledgement outcomes.
- Low-confidence, ambiguous, emergency, and failed-execution cases route to the same-tenant human inbox.
- Refund, cancellation, slot-lock, and appointment actions are idempotent under repeated requests.
- Medical-safety tests prove the agent never diagnoses, prescribes, recommends medication, or automates emergency handling.

## Non-Goals
- Sales automation.
- Marketing automation.
- Financial actions.

## Gemini Instruction
Preserve existing working WhatsApp/RAG behavior. Refactor only where required to make it a reusable Support Agent within the Workforce architecture.
