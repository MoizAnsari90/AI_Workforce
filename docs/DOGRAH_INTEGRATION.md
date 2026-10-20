# Dograh voice integration

AI Workforce connects each business workspace to a Dograh voice agent. Dograh API keys and webhook credentials are encrypted in `ExternalIntegrationCredential`; they are never returned to the browser after saving. The integration keeps the existing tenant-aware reception workflow, appointment rules, Shopify inventory lookup, and Google Calendar availability checks.

## Configure a workspace

1. In Dograh, create and **publish** an agent. Configure its API Trigger and telephony as required by the deployment.
2. In AI Workforce, open **Reception automation → Voice connection → Configure Dograh connection** and save the Dograh API URL, API key, published Agent ID, and a random webhook secret of at least 32 characters.
3. Copy the displayed callback URL into the Dograh agent's Webhook node. Configure that node to send `Authorization: Bearer <same webhook secret>` and a JSON body containing at least `tenant_id`, `workflow_run_id` (or `call_id`), `status`, and any of `duration`, `transcript`, `recording_url`, `transcript_url`, `initial_context`, and `gathered_context`.
4. For live in-call business actions, configure Dograh HTTP API Tool nodes to call the same callback URL with an authenticated payload containing `tenant_id`, `event: "function_call"`, `function: { name, arguments }`, and the customer phone number. Include a stable unique `tool_call_id` or `request_id` on `workforce_turn` calls so retries replay the same booking/action result. Supported names are `workforce_turn`, `shopify_inventory_lookup` (`sku`), and `google_calendar_availability` (`date`). Appointment booking must go through `workforce_turn` so consent, tenant settings, availability, and idempotency checks remain active.
5. Enable voice automation only after the callback and a controlled test call have been verified. Outbound test calls may incur Dograh, telephony, speech, and model-provider charges; the UI requires explicit confirmation.

Dograh's documented outbound API Trigger is `POST {DOGRAH_API_URL}/api/v1/public/agent/workflow/{agent-uuid}` with an `X-API-Key` header and a body containing `phone_number` plus optional `initial_context`. The response's `workflow_run_id` is saved as the voice-session ID. The Dograh Webhook node is configurable rather than a fixed provider event format, so send this application's documented JSON fields. Repeated call-result deliveries safely upsert the same session ID.

## Platform environment variables

`DOGRAH_API_URL`, `DOGRAH_API_KEY`, `DOGRAH_AGENT_ID`, and `DOGRAH_WEBHOOK_SECRET` may be configured as private server-side defaults. Workspace credentials saved in the integration screen take precedence and are stored encrypted. `PUBLIC_API_URL` must be the public HTTPS API origin to generate the callback URL. Never expose these values through `NEXT_PUBLIC_*` variables.

## Example completed-call body

```json
{
  "tenant_id": "<AI Workforce workspace UUID>",
  "workflow_run_id": 12345,
  "status": "completed",
  "duration": 42,
  "transcript": [{ "speaker": "user", "text": "I need to book an appointment" }],
  "initial_context": { "tenant_id": "<AI Workforce workspace UUID>" },
  "gathered_context": { "call_disposition": "appointment_requested" }
}
```

Dograh documentation: [API Trigger](https://docs.dograh.com/voice-agent/api-trigger), [Webhook](https://docs.dograh.com/voice-agent/webhook), [HTTP API tools](https://docs.dograh.com/voice-agent/tools/introduction), [API keys](https://docs.dograh.com/configurations/api-keys).
