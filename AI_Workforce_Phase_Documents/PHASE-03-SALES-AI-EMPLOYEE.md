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
- Direct CRM API Creation (HubSpot, Salesforce API integration)
- Automated Voice Qualification Calls via Vapi / Retell AI for inbound leads
- Vertical Niche Template: "Real Estate Lead Qualification & Appointment Booking" bundle (pre-configured workflows for property inquiry response, qualification, voice call scheduling, and CRM logging)
- Voice and WhatsApp pre-appointment confirmation workflows, including 24-hour reminders and acknowledgement tracking
- Low-confidence and failed-execution fallback routing to live human agent inboxes
- Tenant-scoped idempotency for CRM writes, appointment bookings, slot locks, and follow-up actions

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

Real Estate appointment flow:
Property inquiry / viewing request
→ Validate lead identity, consent, location, budget, timeline, and decision-maker context
→ Qualify and score the lead
→ Find an available viewing slot
→ Atomically lock the slot with an idempotency key
→ Create/update the CRM lead and appointment record
→ Schedule WhatsApp confirmation 24 hours before the viewing
→ Send Voice confirmation when enabled, consented, or WhatsApp delivery fails
→ Record acknowledgement, reschedule, cancellation, or no-response outcome
→ Route low-confidence qualification, ambiguous requests, or failed CRM/scheduling calls to a live sales agent inbox

## Guardrails
Sales Agent cannot:
- invent lead data
- promise unsupported discounts
- alter pricing outside policy
- close high-value deals without configured approval
- delete important CRM records
- bypass consent or do-not-contact rules
- create duplicate CRM records, bookings, or slot locks through retries

If confidence is insufficient, the agent must preserve evidence and route the case to the authenticated same-tenant human inbox rather than guessing.

## Acceptance Criteria
- Leads can be created and tracked.
- Qualification criteria are configurable.
- Sales activities are auditable.
- Follow-up tasks can be scheduled.
- Agent respects communication policies.
- Human approval works for configured risky actions.
- Tenant isolation is maintained.
- Tests cover lead lifecycle and approval paths.
- Real-estate inquiries can qualify leads, book viewing slots, and synchronize approved data with CRM.
- WhatsApp/Voice reminders are scheduled 24 hours before viewings and record delivery/acknowledgement outcomes.
- Low-confidence qualification, ambiguous requests, and failed CRM/scheduling calls route to the same-tenant human inbox.
- CRM writes, bookings, slot locks, and follow-up actions are idempotent under repeated requests.

## Non-Goals
- Full autonomous negotiation.
- Financial transfers.
- Complex forecasting.

## Gemini Instruction
Build reusable CRM/task primitives rather than hard-coding a single business's sales process.
