# WhatsApp connection implementation progress

Updated: 6 October 2026. This records the first implementation milestone after
[the readiness audit](WHATSAPP_VOICE_READINESS_AUDIT.md). It is not a live-delivery
certification or a public-launch sign-off.

## Completed in this milestone

- Embedded Signup handles Meta JSON-string and object events, validates exact
  origins and number IDs, and recovers from cancellation, errors and timeouts.
  Concurrent submissions and stale login callbacks are ignored. Unsupported
  finish variants do not silently connect an incomplete account.
- Connection status distinguishes saved credentials, expiring access and required
  delivery testing. The UI no longer labels stored credentials as ready.
- Self-serve setup remains disabled when required platform configuration is absent.
- Legacy signed webhooks validate every recipient number against the destination
  workspace before accepting any part of the batch.
- Disconnect clears workspace credentials without unsubscribing all numbers on a
  shared WhatsApp Business Account from the platform webhook.
- Credential configuration and external account ownership are saved in one
  database upsert, enforcing the existing unique ownership constraint atomically.
- Live sends require workspace credentials and a real provider message ID.
  Simulated sends are restricted to automated tests. Timeout, network failure,
  server error or an incomplete acceptance response does not trigger an automatic
  BullMQ resend of that reply.
- WhatsApp now has a guarded Cloud API registration step. The owner can either
  submit a six-digit registration PIN after confirming the number is a Cloud API
  number, or attest that an existing Cloud API registration is already active.
  The UI warns against migrating an app number through this path; coexistence is
  still an assisted/unsupported path.
- The guided WhatsApp test creates a short-lived one-time phrase. Sending it from
  a separate phone checks inbound webhook routing; the app queues one reply and
  tracks Meta acceptance and delivery receipt separately. Test payloads are
  tenant-encrypted and deduplicated. The test phrase itself is only returned
  when the owner starts a test.
- Clinic/real-estate automatic WhatsApp replies cannot be switched on until a
  successful delivery receipt was recorded within the last 30 days.
- Voice setup can place an explicit test call to a phone the admin controls.
  The UI discloses potential Vapi/carrier charges; the API requires a consent
  confirmation, masks the destination in audit data, records the Vapi call,
  enforces an idempotency key and caps setup calls at three per hour. An
  uncertain provider response blocks retry with the same request and tells the
  admin to check Vapi call activity.

No database migration was added by this milestone. Restart the API and web dev
servers to use the changes. Do not replace existing encryption keys.

## Automated verification

- API TypeScript build and Next.js production build passed.
- Seven focused suites passed: 54 tests, run with `--maxWorkers=1` using the
  normal test timeout. An earlier concurrent run timed out on one existing
  real-estate booking test; the sequential rerun passed.
- Coverage includes signup parsing, status privacy, disconnect isolation,
  recipient ownership, live-send failure behavior, uncertain-send queue retries,
  webhook signatures, support handling and niche booking/provider workflows.
- Current API TypeScript build, web TypeScript check and Next.js production
  build all passed. The Next.js build reports the repository's existing
  middleware filename deprecation warning.
- The earlier Support inbox UI-only milestone was type-checked and included in
  the successful production build; no new test suite was run in that earlier turn.

## Remaining delivery milestones

### Support inbox reliability update — 7 October 2026

- General Support inbox is available at `/dashboard/support-inbox`.
- Conversation history starts with the latest 50 messages; older messages can be
  loaded with a tenant/conversation-bound cursor. The AI context also uses recent
  history instead of the first messages from a long conversation.
- Conversation lists have paging, and the Needs a person filter is applied by
  the API before the page limit. Selected threads stay stable during polling.
- Drafts belong to individual conversations. Reply attempts retain the exact text
  and request ID in browser session storage across navigation/reload until resolved.
  This storage is scoped by workspace, staff user and conversation; it is cleared
  on acceptance, explicit rejection or staff review of the outcome.
- Staff reply requests require a UUID `requestId` and a trimmed message of up to
  2,000 characters. The server atomically claims the request before sending and
  pauses the conversation itself. Repeating the same request replays acceptance
  or reports uncertainty, without sending again. Changed text with the same ID
  is rejected. A confirmed provider rejection permits a new request after correction.
- Unknown sends, including persistence failure after provider acceptance, require
  checking Meta activity. The UI preserves the attempt and does not automatically
  create a replacement. Staff must explicitly review it before composing a new reply.
- Accepted means Meta accepted the request, not that the customer received it.
  General support delivery/read receipts are not yet shown on each message.
- Read-only support users cannot compose replies or change AI handling. Staff
  takeover is rechecked after AI generation; an HTTP send already in flight
  cannot be recalled.

No database migration is needed for this update. Restart both API and web because
older clients that omit `requestId` will receive a validation error. Live provider
delivery verification remains a separate milestone.

Verification for this update: 14 tests passed across `supportInboxReliability`
and `whatsappQueueRetry`. They cover concurrent/repeated requests, changed-payload
rejection, workspace isolation, provider rejection/uncertainty, failure to persist
after acceptance, recent history and tenant-bound older-history cursors. These
tests mock the database/provider; they are not live WhatsApp or browser tests.
The final API TypeScript build and web TypeScript check also passed.

### Remaining provider and onboarding work

1. Run the number registration and inbound/reply/delivery flow against the actual
   Meta app and a test number; validate the real account's registration and app
   coexistence cases. The “already registered” choice is owner-confirmed until
   the message exchange is delivered.
2. Replace the current Vapi bring-your-own setup with a managed calling option
   after the platform Vapi account, per-market telephone-number supply, billing
   model, supported destinations and service limits are chosen. Existing Vapi
   assistant/tool provisioning is still manual. Test calling has the explicit
   consent and spend-warning controls, but no vendor-side spend cap is configured.
3. Connect bundle selection, channel readiness, automation activation and pause
   controls into one consistent workspace flow, including e-commerce support.

## How to try the new setup locally

1. Restart the API and web development servers. No Prisma schema change or
   migration was added in this phase.
2. In WhatsApp settings, complete Meta signup. Confirm that the selected number
   is on Cloud API. Register it with the six-digit PIN if needed, or use the
   explicit “already registered” choice only when that is true in WhatsApp
   Manager. Do not use this path to move a number out of the WhatsApp app.
3. Confirm that you control a second phone, start the delivery test and send the
   displayed `AIWF ...` phrase from that phone to the business number. The UI
   then follows inbound receipt, queued reply, Meta acceptance and delivery
   receipt. Start a replacement phrase if the page was refreshed or it expired.
4. Only after a delivered receipt can Healthcare or Real Estate automatic
   WhatsApp replies be turned on. For ordinary Support AI, inbound messages are
   stored and routed to the human inbox until delivery has been verified; those
   held conversations may need an admin to resume AI individually after the
   setup test.
5. For a voice test, first connect a Vapi assistant/phone as the current
   bring-your-own setup requires. In Automation & inbox, enter a phone you
   control, confirm permission and potential charges, then request a test call.
   Check Vapi activity and Voice logs for the call outcome. Do not retry after
   an uncertain acceptance until you have checked Vapi.

## Platform prerequisites and live verification

The audit found META_APP_ID, META_EMBEDDED_SIGNUP_CONFIG_ID and PUBLIC_API_URL
missing locally. Configure these for the platform, along with the app secret,
webhook verification token, encryption key and public HTTPS webhook endpoints.
Customers should authorize through Meta rather than paste these platform secrets.
Meta app permissions/review, account and number eligibility, billing and webhook
subscription must be checked in the actual provider account.

No real WhatsApp message, Vapi call, Meta popup or production provider connection
has been tested in this milestone. Automated provider responses are mocked.
The current status intentionally remains incomplete until a real delivery
receipt is persisted. Telephone calling and WhatsApp Calling are separate
integrations; the latter has not been implemented.

The workspace onboarding checklist now shows WhatsApp as an optional channel
when disconnected, and as `Test required` when credentials exist without recent
two-way delivery proof. Core bundle activation can proceed without WhatsApp,
but the existing channel automation gates keep customer replies paused until a
real delivery test passes. This checklist status is based on persisted proof;
it does not replace a live Meta webhook and customer-message verification.
