# AI Workforce Production Readiness

Checked on 2026-10-11. This document distinguishes code and local checks from live provider and hosted-environment acceptance.

## Current state

- Shopify store lookup: read-only product, stock and order questions are implemented with tenant scoping. A live test store returned stock for a SKU that exists; the test catalog also contains products with no SKU and those correctly return “not found.” Live order coverage still needs a test order visible to the connected app. See [STORE_ASSISTANT_READINESS.md](./STORE_ASSISTANT_READINESS.md).
- Subscriptions: Stripe Checkout, customer portal, signed raw-body webhook handling, event deduplication, fresh-state reconciliation, per-plan credits and agent limits are implemented. Billing defaults to `BILLING_MODE=disabled`; do not enable enforcement until test prices, webhook secret, and a successful test subscription are configured. `BILLING_ENFORCEMENT=true` blocks paid actions without an active subscription.
- Appointments: calendar availability and booking/cancellation/reminder flows are implemented and have automated API coverage. A live create/cancel/reminder cycle still needs a disposable calendar, test contact, and confirmed timezone. Do not use a real patient's calendar entry as a test.
- WhatsApp and calling: provider setup and safety checks exist, but a real message round-trip and a real call have not been accepted as production proof. Use a dedicated test number and verify provider delivery/status callbacks before enabling automation.
- Hosting and recovery: production Docker Compose, HTTPS routing, health checks, encrypted PostgreSQL backup, object-storage upload, and restore-rehearsal files are present. No production domain, host, or backup bucket is configured, so no deployment or off-site restore has been performed.

## Local verification

The additive `20261009180000_subscription_billing` migration was applied to the local `ai_workforce` PostgreSQL database. It adds billing accounts/events and serializes the paid agent quota check. The migration replay fixture handles PostgreSQL dollar-quoted trigger bodies.

The API TypeScript build and dashboard production build passed. The full API suite passed after the idempotency fixture corrections: 50 files and 441 tests. The assistant request replay test confirms a completed retry returns the saved answer without another store read or credit debit. The local Prisma schema is up to date, and the production Compose file parses with the placeholder environment file; no containers were started.

Run these from the repository root after changing the code:

```powershell
npm.cmd run prisma:generate --workspace=@ai-employee/api
npm.cmd run build --workspace=@ai-employee/api
npm.cmd test --workspace=@ai-employee/api
npx.cmd tsc --noEmit -p apps/web/tsconfig.json
```

## Billing setup

Create monthly recurring Stripe prices in **test mode** first. Configure `BILLING_MODE=test`, a matching `sk_test_` key, the test webhook signing secret, an HTTPS or localhost `WEB_APP_URL`, and `BILLING_PLANS_JSON` whose `priceId`, credits, and agent limits match the prices and product policy. Stripe must deliver `checkout.session.completed`, subscription updates/deletion, and invoice paid/failed events to `/api/v1/billing/webhook`. Complete a test checkout, portal cancellation, failed-payment, duplicate-webhook, and cross-tenant access check before turning enforcement on in a test environment.

Keep a separate database and keys for live mode. `BILLING_MODE=live` requires `sk_live_`, live prices, HTTPS app URLs and the live webhook secret. Do not store Stripe secrets in the web bundle. Never switch a database containing test customers to live mode.

## Deploy and recover

1. Choose a host, region, domain, DNS provider, and off-site S3-compatible backup bucket. Create unique production secrets and set `APP_DOMAIN` and `API_DOMAIN`.
2. Run `node scripts/production-preflight.mjs`; resolve each missing production variable before deployment. For paid launch, run `node scripts/production-preflight.mjs --paid-launch` only after live Stripe is fully configured.
3. Build and inspect the production images, then deploy with `docker compose -f docker-compose.production.yml up -d --build`. Confirm HTTPS, API health, login, tenant boundaries, and provider webhooks.
4. Enable the encrypted backup job and verify an uploaded artifact's checksum. Perform `deploy/restore-rehearsal.sh` against a separate database and record the restore result before accepting production data.
5. Monitor API health, provider error rates, webhook retries, queue age, backup freshness, and database capacity. Configure alert recipients and retention to match the chosen host's controls.

## Remaining evidence for a go-live decision

- Successful store order lookup using an order that exists in the connected test store.
- Stripe test purchase, cancellation, failed payment and duplicate webhook checks; then owner-supplied live plan prices and keys.
- Appointment create, cancel and reminder receipt on a disposable calendar and test contact.
- WhatsApp inbound/outbound receipt and one controlled provider call using a dedicated test number.
- A named host/domain, production secrets, successful HTTPS deployment, tenant-isolation acceptance, and a verified off-site backup restore.

These items depend on external accounts, test records, or an owned host that are not configured in this workspace. The product code and local setup do not by themselves prove those live outcomes.

## Finalization code changes (11 October 2026)

The local schema now includes `store_report_schedules` and
`store_daily_reports` (`20261011000000_store_daily_reports`). An admin can
preview defined Shopify order-period reports and configure owner WhatsApp
delivery with an approved seven-parameter Utility template, business timezone
and recipient consent. Money totals are separated by currency and distinguish
current order value from value on paid orders. Interrupted/ambiguous provider
sends are held for review rather than automatically repeated. This implementation
still needs Meta/Shopify staging acceptance; no report was sent during local
testing.

Stripe now also expires an open checkout when another plan is selected, validates
the callback origin and applies the configured maximum agent count atomically
when a bundle agent is deployed. Each workforce assistant question consumes one
included plan credit when billing enforcement is enabled; exhausted balances
return 402 before reading store data. Local mode remains unmetered. Real Stripe
test-mode completion still needs owner-configured prices and webhook delivery.

The customer-facing support path can answer verified product facts and routes
unverified order/sales requests to staff. Automated channel workers honor the
agent pause and subscription state. These safeguards have automated coverage;
live provider behavior must still be verified with a dedicated test workspace.
