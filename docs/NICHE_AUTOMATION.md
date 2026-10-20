# Clinic and real estate reception automation

Workspace admins can configure clinic or real-estate reception, review tenant-isolated customer sessions, reply to WhatsApp enquiries, resume staff handoffs, and review delivery status. All switches default to off. Deploying a bundle does not enable messaging or calling automatically.

## Dograh voice integration

Voice calls use Dograh. Configure the workspace's Dograh API URL, API key, published Agent ID, and webhook secret under **Reception automation → Voice connection**. Credentials are encrypted at rest and never returned to the dashboard. Configure `PUBLIC_API_URL` on the API host so the UI can display the HTTPS callback endpoint. Full Dograh setup, expected callback fields, and supported live tools are in [DOGRAH_INTEGRATION.md](DOGRAH_INTEGRATION.md).

The Dograh API Trigger starts outbound calls using `phone_number` and `initial_context`; the returned `workflow_run_id` becomes the unique voice-session ID. A Dograh Webhook node posts completed call data to `/api/webhooks/dograh`. Each workspace has its own bearer secret, and callbacks are rejected unless the tenant-bound credential validates. Duplicate call-result deliveries upsert the same session. Live HTTP API tools are restricted to `workforce_turn`, `shopify_inventory_lookup`, and `google_calendar_availability`; booking goes through the existing consent, availability, and idempotency flow.

Outbound test calls require explicit permission confirmation and may incur Dograh, telephony, speech, and model-provider charges. Enable voice only after configuring the webhook and testing with a controlled phone number.

## Existing business and privacy controls

- Clinic flows require customer consent, contact name, doctor, service, available date/time, and explicit booking confirmation. Medical questions are handed to staff; emergency phrases return an urgent-help message. The system does not provide clinical advice or transfer a call to a human.
- Real-estate flows gather qualification details, match stored listings, and allow viewing requests through the existing booking flow.
- WhatsApp users can request an AI callback with `CALL`, opt into a reminder with `REMIND`, request staff with `HUMAN`, or opt out with `STOP`. Only `START` clears an opt-out. Pending messages and callbacks are checked against current consent and session state.
- Tenant-bound encrypted storage is used for session state and credentials. Do not place secrets in frontend-public environment variables or logs.

## Validation

Local automated tests use isolated test tenants and mocked external providers. They verify callback authentication, tenant isolation, idempotent call sessions, voice tool dispatch, and existing booking rules. They do not make real calls or establish live Dograh, Meta, or Google consent. Complete a controlled provider call and compare its result with the Voice Logs page before enabling production traffic.
