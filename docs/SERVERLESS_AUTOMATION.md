# Scheduled automation on the no-card deployment

The live HTTP API runs on Vercel Functions. An account-owned **Upstash QStash Free** resource invokes `POST /internal/automation/tick` every five minutes. This replaces the requirement for an always-running worker in the prototype deployment. The existing persistent-host worker path is retained for a future always-on service.

## Execution and safety

- The callback requires QStash's JWT signature, verified with the official SDK against the exact raw body and configured canonical API URL. Current and next signing keys support rotation. Missing, forged, expired, tampered and wrong-destination messages are rejected before any work starts.
- A Redis lease prevents overlapping callback cycles. Only the owner can release it; the 300-second expiry permits recovery after a killed function. Cleanup finishes before the HTTP response.
- Each cycle starts a temporary BullMQ consumer with concurrency one, a 20-second intake window and a target batch of five jobs. It stops accepting work and waits for already-active work before closing. BullMQ renews active job locks; delayed/unhandled jobs stay in Redis for the next cycle.
- The same uncertain-WhatsApp-delivery rule stops automatic retries when a provider might already have accepted a send.
- Niche automation, store reports and autonomy scheduling use batches of two with a soft 150-second deadline. An in-flight operation can exceed the soft deadline; the provider's function duration remains the hard limit. Existing persisted leases/idempotency/unknown-delivery handling remain responsible for interruption recovery.
- Only a completed cycle writes `ai-workforce:automation:last-run`. Responses and logs do not expose credentials, customer messages or job payloads.

## Runtime configuration

API Production environment:

```dotenv
BACKGROUND_WORKERS_ENABLED=false
SERVERLESS_AUTOMATION_ENABLED=true
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
```

The existing private `REDIS_URL`, database/encryption/provider credentials and actual `PUBLIC_API_URL` are also required. QStash keys are injected by the Marketplace integration. The deployment tool uses `QSTASH_TOKEN` privately to create the schedule. Do not put signing keys, tokens or populated env files in Git.

Schedule: `*/5 * * * *`, POST `{}` with `Content-Type: application/json`, one delivery retry, 240-second HTTP response timeout. Check the API project's function timeout supports that budget before enabling it. Use only one schedule for the canonical destination.

## Limits and user-visible behavior

This is periodic processing, not an always-on worker: queued WhatsApp messages/reminders may wait roughly five minutes plus delivery, batch backlog and cold-start time. Synchronous dashboard text/voice questions use the normal API and do not wait for this schedule. This is unsuitable for time-critical clinic/reception promises without a separately designed latency/availability guarantee.

The schedule creates 288 normal deliveries/day; a retry on every delivery would make 576, within QStash's currently published 1,000-message/day Free allowance. Other publishes/retries share that quota. Upstash Redis also has finite command/storage limits, and queue activity can exhaust them. No auto-upgrade or paid plan is authorized by this setup. Free hosting is a prototype configuration, not unlimited capacity or a production SLA.

The callback must remain publicly reachable over HTTPS while protected by signature verification. Do not disable application authentication elsewhere or expose an unsigned manual trigger. Keep external customer/provider integrations disabled until their credentials and consent/acceptance tests are complete.

## Verification

Tests cover callback signature checks, rotated keys, overlapping delivery, retryable failures and a real isolated Redis queue batch. Live verification publishes a signed delivery through QStash and reads the private Redis completion marker; unsigned requests must return 401. No real customer messages/calls are sent during deployment checks.

Official references: [Receiver verification](https://upstash.com/docs/qstash/sdks/ts/examples/receiver), [schedules](https://upstash.com/docs/qstash/features/schedules), [Free quotas](https://upstash.com/pricing/qstash).
