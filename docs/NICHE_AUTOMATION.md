# Clinic and real estate reception automation

## Implemented

Open **Clinic reception** or **Real estate**, then **Automation & inbox**.
Workspace admins can configure one active reception flow per workspace, inspect
customer sessions, reply to WhatsApp enquiries, resume staff handoffs and review
delivery status. All switches default to off. Deploying a bundle does not enable
messages or calls automatically.

- Clinic: consent, contact name, doctor, service, available date/time, explicit
  booking confirmation, appointment status and confirmed cancellation.
- Real estate: consent, name, buy/rent, city, area, property type, budget,
  timeline and funding; save the lead, show matching saved properties, select a
  viewing agent and book a viewing. Matching and qualification use database rules.
- WhatsApp uses guided English questions and numbered choices, not unrestricted
  Gemini chat. Basic commands also accept selected Roman Urdu alternatives.
  Business language preferences do not yet translate these flows automatically.
- Voice uses a saved Vapi assistant with the `workforce_turn` function to run the
  same backend flow. The assistant's model/transcriber/voice are configured in Vapi.
- Customers can request a callback with `CALL` on WhatsApp, opt in to one reminder
  for their confirmed booking with `REMIND`, pause for staff with `HUMAN`, or opt
  out with `STOP`. Only their `START` can clear an opt-out. Staff cannot override it.
- Medical questions are flagged for staff; obvious emergency phrases produce an
  urgent-help message. This is scheduling software, not clinical triage or advice.
  Handoff means a paused inbox item; it does not transfer a phone call to a person.

## Prerequisites and startup

Complete [Business setup and Google OAuth](BUSINESS_SETUP_CALENDAR.md) and
[doctor/service or property/agent setup](NICHE_WORKFLOWS.md). Each booking resource
needs a writable Google calendar. No Gemini key can replace that OAuth grant.

Migration `20261003020000_niche_automation` adds encrypted sessions, a durable
dispatch queue, automation settings and appointment reminder consent. It was
applied locally. On another checkout, stop the API, then run:

```powershell
cd D:\Agent\apps\api
npx prisma migrate deploy
npm run prisma:generate
npm run dev
```

Keep `INTEGRATION_ENCRYPTION_KEY` stable and private. The API process runs the
database-backed worker every five seconds; it must stay running with background
execution available. Queue records survive a restart. This worker does not depend
on Redis. Existing e-commerce support processing is unchanged for workspaces
without reception automation settings.

## WhatsApp and reminders

1. Connect the workspace through **WhatsApp Settings > Embedded Signup**. The
   connection needs a real phone number ID, access token and WABA ID. Global demo
   credentials and simulated sends are not used by reception automation.
2. Configure the public Meta webhook and its signature secret using the existing
   WhatsApp setup. Incoming recipient IDs must match the workspace connection.
3. Save the active business flow and enable automatic WhatsApp reception.
4. For reminders, create a Meta **UTILITY** template with a text body containing
   exactly one positional variable, `{{1}}`, and no header or buttons. Example:
   `Reminder: your appointment is scheduled for {{1}}. Reply STOP to stop reminders.`
   Approval and category classification are Meta's decision. The application
   checks approved status, category, language and parameter shape before use.
5. Enter its exact name and language code, such as `appointment_reminder` and
   `en_US`, choose a lead time of 1–72 hours, then enable reminders.
6. The customer must reply `REMIND` after a confirmed conversation booking.
   Staff-created appointments do not imply reminder consent. `STOP` suppresses
   pending reminders and callbacks across both channels for that phone number.

Replies, including staff replies, use the original signed inbound timestamp and
a conservative 23-hour window. Reminders use the approved template. Cancelled,
unconfirmed, past or opted-out bookings are skipped. A request already accepted
by a provider cannot be recalled by a later STOP message.

Meta's [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy/)
describes opt-in, opt-out, customer-service windows and approved templates.

## Voice setup

Voice setup is an administrator task. It requires a Vapi account, a supported
phone number and a reachable HTTPS API origin; local `localhost` is not reachable
by providers. Configure this backend environment variable and restart the API:

```dotenv
PUBLIC_API_URL=https://your-public-api.example
```

The **Voice connection** section displays the workspace-specific callback URL.
Use that exact URL for the saved assistant and its saved function tool.

1. In Vapi, create a **Bearer Token** custom credential using a random secret of
   at least 32 characters, sent as `Authorization: Bearer <secret>`.
2. Create a saved, synchronous function tool named `workforce_turn`. Disable
   async mode. Its parameters must be:

   ```json
   {
     "type": "object",
     "properties": { "text": { "type": "string", "description": "The customer's current answer or explicit command" } },
     "required": ["text"],
     "additionalProperties": false
   }
   ```

3. On the saved tool, set its server URL to the displayed callback and attach the
   bearer credential. Use a timeout suitable for calendar checks and bookings.
4. Attach the saved tool to the saved assistant (its `model.toolIds`). Set the
   assistant's server URL and the same bearer credential. Enable `tool-calls`,
   `status-update` and `end-of-call-report` server events. Assign this assistant
   to the saved Vapi phone number.
5. Configure the assistant's model, voice and transcriber for the pilot language.
   Its opening message should identify it as an automated receptionist. Suggested
   system instructions:

   > For each customer answer call workforce_turn once and wait for its result.
   > Read the returned reply faithfully. Convert an explicitly spoken numbered
   > choice to its digit, and an unambiguous spoken date to YYYY-MM-DD. Ask again
   > when ambiguous. Never invent availability, prices, qualification or booking
   > success. Send YES only after explicit customer confirmation, CANCEL YES only
   > after explicit cancellation confirmation, and REMIND only on explicit request.
   > Preserve STOP and HUMAN requests. Do not give medical advice. When handoff is
   > true, explain that staff must help; do not claim a live transfer. If a tool
   > fails, explain that the action is unverified and direct the caller to staff.

6. Enter the private Vapi API key, saved assistant ID, phone number ID and the
   same bearer token in **Voice connection**. **Verify & save voice** checks the
   assistant/number association and saved tool/server configuration. Secrets
   are encrypted and are not returned to the dashboard.
7. Enable voice above. Complete a real, consented test call before launch. This
   verification step cannot prove the spoken assistant follows its instructions.

The callback verifies the bearer token and fetches the actual call from Vapi to
check workspace phone/assistant ownership. It does not trust the caller details
in the webhook body. Duplicate tool calls return the stored result. The old
unauthenticated `/webhook/:tenantId/voice` callback now returns HTTP 410.

Vapi documents [saved function tools](https://docs.vapi.ai/tools/custom-tools) and
[server authentication](https://docs.vapi.ai/server-url/server-authentication).
Saved server configurations matter because credentials may not be attached to
server URLs supplied through transient call overrides.

## Staff inbox and delivery recovery

The admin inbox shows the latest customer message, last automated reply, flow
stage and handoff reason. Raw conversation state and queued payloads are encrypted
with tenant-bound authenticated encryption; neither is written to application
logs. Unsolicited customer content can contain sensitive information, so configure
retention and provider policies for your deployment. This is not a medical record
system or a healthcare compliance certification.

Staff replies keep automation paused. **Resume reception** starts a fresh enquiry
on the next message. Inbox refresh is manual; the screen shows the latest 100
sessions and dispatches. Monitor it while offering a staffed service.

| Dispatch status | Meaning |
| --- | --- |
| pending / processing | Queued or claimed by the worker. |
| accepted | Provider returned an acceptance ID; delivery is not yet proved. |
| delivered | A signed WhatsApp delivery/read callback was received. |
| completed | Vapi reports the authenticated call ended; not proof of a booking. |
| skipped | Disabled, opted out, expired window, or booking no longer eligible. |
| failed | Explicit provider rejection, or inbound processing exhausted retries. |
| unknown | Timeout, worker interruption or uncertain response; inspect provider activity before another send. |

Inbound events are persisted before acknowledgement, deduplicated and processed
in order per customer. Outbound sends are not automatically retried after an
uncertain response, because the provider may already have accepted the first one.
Calendar uncertainty remains `sync_pending`/`cancel_pending`; use the appointment
screen's **Check / retry sync** or the customer's `STATUS` command.

## Pilot acceptance

Local verification on 4 October 2026: 40 API test files / 309 tests passed;
API TypeScript and web production builds passed. Five browser checks covered
staff/opt-out controls, provider setup error recovery, staff reply/resume, masked
voice credentials and both bundle layouts at mobile/tablet widths. No browser
runtime errors were observed. No lint script is configured in either workspace.
After restarting the local API, `/health` returned healthy with database and
Redis checks both true. The dashboard development server was also restarted.

Automated tests use isolated database tenants and mocked external providers.
They do not send real WhatsApp messages, make calls or verify live Google consent.

For each business flow, use a test contact to complete consent, qualification or
doctor/service selection, availability, YES booking, STATUS, REMIND, cancellation,
HUMAN/staff reply/resume, STOP and START. Compare bookings against the real Google
calendar and message/call IDs against provider dashboards. Verify a reminder
reaches the opted-in test contact and a cancelled booking produces none. Test
voice recognition and confirmation in each intended market/language.

Public rollout still needs real provider acceptance, production hosting,
monitoring/retention, the appropriate account approvals and country-specific
operational review. English guided flows are implemented; automatic Arabic/Urdu
localization, call transfers, bulk property import and external CRM connectors
are separate capabilities.
