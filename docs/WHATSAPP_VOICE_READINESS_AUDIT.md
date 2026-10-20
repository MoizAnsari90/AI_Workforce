# WhatsApp and Dograh voice readiness audit

This document records a 6 October 2026 snapshot taken before the Dograh cutover.
Its provider-specific setup findings are historical. The current Dograh design
and setup steps are maintained in [Dograh integration](DOGRAH_INTEGRATION.md).

This is the pre-implementation audit snapshot. See
[connection implementation progress](WHATSAPP_CONNECTION_PROGRESS.md) for fixes
completed since the audit and remaining release work.

Audit date: 6 October 2026. Scope: current local source, configuration presence,
read-only metadata for the workspace previously supplied by the owner, focused
automated tests, and official provider documentation. No live messages or calls
were initiated. No provider credentials or customer content were included in this report.

## Decision

Not ready for an unattended public SaaS rollout. WhatsApp and clinic/real-estate
voice have substantial backend implementations, but connection completion,
readiness evidence and customer onboarding need further work. E-commerce voice
is not implemented by the clinic/real-estate reception engine. Existing Dograh calls
are telephone calls; a WhatsApp Calling API integration was not found.

Local evidence:

- META_APP_ID and META_EMBEDDED_SIGNUP_CONFIG_ID are absent from the local env files.
- PUBLIC_API_URL is absent. Voice connection validation requires a public HTTPS origin.
- META_APP_SECRET, META_VERIFY_TOKEN and INTEGRATION_ENCRYPTION_KEY are present;
  presence does not validate their values or the running process configuration.
- The inspected workspace has no active WhatsApp/Dograh integration records, no
  reception automation configuration and zero Dograh voice-session records.
- The Meta App Review, account verification, account billing, allowed domains and
  provider number capabilities have not been inspected in provider consoles.
- Focused verification: 3 test files, 25 tests passed:
  whatsappSignature.test.ts, nicheProviders.test.ts, nicheAutomation.test.ts.
  Provider requests are mocked. Passing these tests does not prove live delivery.

## Implemented capabilities

- Embedded Signup button and server-side authorization-code exchange.
- Tenant-owned encrypted credentials and number-to-workspace webhook routing.
- Meta signature verification; persisted, deduplicated niche inbound events.
- Clinic booking and real-estate qualification conversations, with confirmation.
- Opt-out, staff handoff, opt-in reminders and explicit CALL callback requests.
- Approved utility-template validation and distinction between accepted and
  delivered messages in niche dispatch records.
- Dograh assistant, phone, tool and webhook configuration validation.
- Bearer authentication plus provider-side call ownership verification.
- Handling uncertain sends without automatically sending a duplicate.

## Gaps to fix before launch

### WhatsApp onboarding and reliability

1. `apps/web/app/(protected)/dashboard/settings/whatsapp/page.tsx` reads
   `event.data.type` directly. A JSON-string postMessage is ignored. Session event
   negotiation, cancellation/error events, missing asset data and timeout recovery
   need explicit handling and browser-level tests. Currently a returned code without
   usable asset data can leave the UI waiting.
2. `apps/api/src/routes/whatsappOnboardingRoutes.ts` exchanges credentials, checks
   assets and subscribes the WABA, but does not register a newly onboarded standard
   Cloud API number or verify that registration is already complete. Implement the
   appropriate registration flow and handle existing/migrated/coexistence numbers
   separately. Do not apply a destructive migration to an existing Business App number.
3. `GET /connection` reports ready from saved credentials and an expiry timestamp.
   It does not prove token validity, number registration, webhook reception or message
   delivery. Expose separate connected, setup-required, test-passed and live states.
4. Disconnect unsubscribes the entire WABA. If multiple workspace numbers share a
   WABA, one disconnect could affect another. Subscription ownership needs reference
   counting or an explicit supported account constraint.
5. The old `/webhook/:tenantId/whatsapp` route still uses the URL tenant for the
   general support path without binding the recipient number to that tenant. Remove
   it from production use or enforce the same number ownership validation as the
   central webhook. Test signed payload replay against a different workspace.
6. The general `whatsappService.sendMessage` path can substitute a mock ID when a
   provider response lacks a message ID; it also has a development mock/global-credential
   fallback. The niche sender rejects missing acceptance IDs. Standardize these paths
   so a live readiness check never reports simulated delivery as success.
7. The parser currently accepts text messages. Interactive replies, audio and media
   need either supported handling or a clear customer response; they must not silently
   disappear from an advertised full support channel.

### Voice and customer experience

1. `apps/web/components/workforce/automation-panel.tsx` requires a private API key,
   assistant ID, phone-number ID and webhook bearer token, plus manual Dograh tool setup.
   This is an administrator setup flow, not an easy merchant onboarding experience.
2. The active reception flow only supports healthcare and real_estate. E-commerce
   template metadata mentions DOGRAH, but no corresponding live Dograh caller was
   found. Choose one supported provider and implement each advertised use case.
3. `nicheVoiceController.ts` maps every ended call to completed without evaluating
   its end reason. A completed call record is not evidence of a successful conversation
   or booking. Persist call outcomes, failure reasons and useful support details.
4. Human handoff currently pauses an inbox session; it does not transfer a live call.
5. English guided text flows are implemented. Automatic Urdu/Arabic localization and
   market-specific voice/transcription quality remain unverified.
6. Dashboard agent pause and reception automation switches are separate controls.
   A paused bundle agent is not a universal channel shutdown. Introduce an authoritative
   activation/pause policy enforced by inbound handling and outbound workers.
7. The reminder worker runs in the API process on an interval. Production deployment
   must ensure background execution, recovery and monitoring; a sleeping or scaled-to-zero
   API cannot provide reliable timed reminders by itself.

## Recommended merchant experience

Use Business setup for business data and Integrations for two clear channel cards:
WhatsApp and AI phone calls. Keep technical provider administration outside the
default merchant journey. Show setup progress when returning from provider consent.

### WhatsApp

1. Choose Connect WhatsApp.
2. Explain account/number prerequisites and offer the appropriate existing Business
   App number or standard business-number path. Coexistence must be explicitly
   supported and eligibility checked before promising preservation of the app.
3. Complete Meta's secure Embedded Signup, business/number selection and any required
   verification. The customer should not create a developer app or paste API tokens.
4. AI Workforce completes server-side provisioning and shows outstanding provider steps.
5. Show a chat link/QR and a test phrase. The owner sends it from a separate test phone.
   Track webhook receipt, AI response acceptance and delivery before marking test passed.
6. Choose the business workflow, human contact and approved reminder template from
   fetched options. Display template approval status rather than asking for API names.
7. Explicitly activate automatic replies. Keep messaging and calling consent separate
   from connecting the business's own account.

### AI phone calls

Recommended default: platform-managed voice, subject to provider commercial terms
and telephony availability. Keep bring-your-own Dograh as an advanced option.

1. Select the use case, language and voice preview.
2. Choose an available business number, or an assisted existing-number/forwarding
   setup that the selected carrier supports. A WhatsApp number does not automatically
   become a Dograh telephone number.
3. Provision the tenant's assistant, tools, authenticated server configuration and
   phone assignment on the backend. Isolate resources and usage by workspace.
4. Show fees, supported calling countries and a spending cap before activation.
5. Offer a test call only to an explicitly confirmed test number; validate inbound
   and outbound operation, failed/no-answer outcomes, booking and callback consent.
6. Enable inbound reception and requested callbacks separately. Provide pause,
   usage, failure details and a staff escalation option on the same card.

Pakistan, UAE and US business profiles do not establish phone-number availability,
permission to dial a destination, or voice language quality. Verify each intended
country with the chosen carrier and test supported languages. Dograh's current docs
describe free numbers as US/inbound-only; outbound and international use require
an appropriate imported number/provider. Calls themselves consume paid usage.

## Delivery order and acceptance

1. Fix connection completion, misleading readiness states, tenant routing and the
   unified pause/activation controls. Add tests for these specific failure cases.
2. Implement the WhatsApp guided test and template picker; complete platform Meta
   setup and review. Pilot inbound reply, reminder, STOP and staff handoff with an
   opted-in test contact and reconcile provider delivery IDs.
3. Implement managed voice provisioning and verified-number test controls. Pilot
   inbound and requested outbound calls, no-answer/failure and real calendar results.
4. Validate each advertised bundle and market before enabling it for customers.
   Add token/number health monitoring, cost limits, background-worker monitoring,
   retention controls and actionable provider-error messages.

Do not mark a connection live merely because credentials were saved or an API
accepted a send. Persist the successful test evidence and show the last verified time.

## Official research sources

- [Meta's official Embedded Signup collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup): partner onboarding and app review; some collection sections are partner-type-specific, so do not assume credit-line sharing applies to every Tech Provider.
- [Meta Cloud API registration documentation](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-06605a2c-2b74-4d0a-a035-2c227eae61d1): standard phone registration and PIN.
- [WhatsApp messaging policy](https://business.whatsapp.com/policy): opt-in, opt-out, 24-hour replies, approved templates and escalation.
- [WhatsApp's Business App/Platform same-number explanation](https://whatsappbusiness.com/resources/resource-library/organize-whatsapp-inbox-meta-business-suite/): retaining the Business App while adding Platform features; implementation eligibility still needs verification.
- [Dograh API Trigger](https://docs.dograh.com/voice-agent/api-trigger): trigger an agent from the application backend.
- [Dograh Webhook](https://docs.dograh.com/voice-agent/webhook): send call results to an external callback.
- [Dograh API keys](https://docs.dograh.com/configurations/api-keys): create and protect voice-agent API keys.

Several Meta developer pages returned HTTP 429 during research. Meta's own Postman
collections and WhatsApp business site were used where accessible; provider-console
approvals and a live Embedded Signup session remain unverified.
