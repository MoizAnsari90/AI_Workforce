# Store assistant: implemented scope and launch checklist

Last checked: 11 October 2026.

## What is implemented

The merchant dashboard assistant now routes commerce questions to tenant-bound
Shopify reads before workspace metrics. It does not give Gemini a store token or
allow a model to generate provider queries. Gemini's workspace fallback selects
a validated metric intent; the backend formats the actual database numbers.
Invalid model output and provider failures cannot become invented facts.

| Ask | Verified behavior | Limits |
| --- | --- | --- |
| `Stock for SKU: sku-managed-1` | Existing live Shopify stock by location; WooCommerce exact-SKU stock also works | Up to 5 SKUs; no historical stock |
| `Stock and price of product "HR Clothing part"` | Exact unique title, variant stock, catalog price/currency and product status; works without a SKU | Shopify; 10 search candidates, 20 variants per selected product; ambiguous/incomplete searches need clarification; truncated variants explicitly partial |
| `Order #1001 status` | Exact order name, payment/fulfillment/cancellation status and current total | Shopify; `sales:read` or `admin:all`; no customer contact data; older inaccessible orders are not reported as nonexistent |
| `Sales summary today` / `Daily report yesterday` / `Top products this month` | Paginated current order values and paid-order values by currency, order/unit/payment/fulfillment counts, and top 5 products by current line units | Shopify; `finance:read` or `admin:all`; one period up to 31 days; history and pagination caps fail closed |
| `Low-stock products below 10` | Current tracked variant quantities below the threshold, including negative stock | Shopify; up to 200 variants scanned, 30 matches displayed; incomplete results marked partial; untracked counts excluded explicitly |
| `Workspace summary` / `Pending approvals` / `AI replies today` | Verified workspace database counts | Workspace records, not Shopify analytics |

Sales summaries exclude test and cancelled orders but include unpaid orders.
They report current values of orders **created in the requested period**;
they are not net sales, revenue collected in that period, refund activity,
accounting profit or an exact Shopify Analytics reconciliation. Later edits
and refunds can change those current values. Currencies are never added together.

Inventory reports include draft/archived product labels. Stock across locations
does not guarantee a particular customer's checkout eligibility, shipping
availability, delivery date, or a market-specific price. Prices are catalog
prices. Read requests do not adjust stock, refund/cancel orders or send messages.
Those actions remain in the existing approval-controlled workflows.

Questions should use the examples above. This is a bounded assistant, not an
unrestricted reporting engine. Product names go in double quotes. Questions are
independent; pronouns such as “that item” have no previous-turn context. Profit,
forecasts, best sellers, arbitrary breakdowns and historical inventory are not
implemented. WooCommerce product-name/order/sales parity is still future work.
The customer-facing Support AI can provide verified current product facts. Order,
sales and unsupported requests go to staff; merchant-only order/finance results
are not exposed to an unverified WhatsApp customer.

## Permissions and rollout

1. Product/title and catalog reports need `read_products` and inventory access.
   Existing stock-only connections keep working. Missing scope produces a
   specific reconnect message rather than a zero quantity.
2. Default OAuth scopes, `.env.example`, local scope overrides and
   `shopify.app.toml` now include `read_products`. Shopify app version
   **ai-workforce-4** was released with that scope. Existing installations still
   need merchant consent; releasing an app version does not prove consent.
3. Restart the local API after its environment scope setting changes. Keep the
   configured HTTPS callback tunnel running while authorizing locally.
4. Open **Integrations → Shopify → Update Shopify permissions** and approve as
   the store owner. This starts OAuth for the same store without disconnecting
   it first. Reauthorization currently resets the store-write switch to off.
5. Return to the dashboard and try a product-title question and low-stock scan.
   Do not treat a connected badge alone as proof that the new scopes are granted.

Shopify documents the product/variant fields and order-history access separately:
[ProductVariant](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant),
[Order](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order).
By default, order access covers the last 60 days; older sales periods are blocked
without `read_all_orders`. We have not requested broader history access.

## Verification and honest remaining acceptance

- API TypeScript build and web TypeScript check passed during implementation.
- Eight targeted suites passed, **100 distinct tests across two runs**: commerce,
  stock, workspace metrics, Shopify tools, customer support stock, OAuth,
  credential exchange and Shopify routes. The final regression run passed 49
  tests; the earlier core run passed 83, with overlapping commerce tests.
  Coverage includes tenant isolation,
  permissions, exact matching, malformed data, pagination, decimal currency sums,
  duplicate pages, scan caps, provider errors and rejected model fabrication.
- Live read-only smoke checks succeeded against the two locally connected
  workspaces: connection/scopes and today's sales-summary request. Both stores
  had no accessible orders for the order probe; only its not-found path was
  exercised live. No test order, refund, stock edit or outbound message was created.
- Those live credentials lack `read_products`; product-name and low-stock live
  acceptance remain pending merchant consent. Mocked tests are not represented
  as live proof. Non-empty live order/sales fixtures and browser acceptance are
  still needed before claiming full production readiness.
- Reusable smoke check (from `apps/api`):
  `npx tsx src/scripts/shopifyAssistantCheck.ts --all-connected`.
  It prints statuses/scopes only, never tokens or customer data. Alternatively
  set `SHOPIFY_TENANT_ID` and omit `--all-connected` to check one workspace.
- No database schema change or migration is required for this assistant update.

## Work remaining besides connecting WhatsApp

### Before a paid pilot

1. **Finish commerce acceptance:** grant product access; check a known product,
   stock change reflected on a new read, real test order/payment/fulfillment
   statuses, non-empty date/currency totals, token refresh and reconnect. Test
   approval-protected writes separately using appropriate test orders.
2. **New-customer/browser acceptance:** register two isolated workspaces, finish
   each bundle's required setup, activate/pause, switch accounts and verify no
   data crosses tenants. Confirm dashboard controls and channel worker activation
   behave consistently; agent flags and niche channel flags are separate today.
3. **Paid subscription acceptance:** Stripe Checkout, customer portal, signed
   webhook verification, event deduplication, subscription reconciliation,
   internal credits and per-plan agent limits are implemented. Complete a real
   Stripe test-mode purchase, renewal/failure, cancellation and duplicate-event
   sequence with owner-configured test prices and secrets before accepting paid
   self-serve customers. Do not enable billing enforcement before that check.
4. **Production operations:** move from localhost/ngrok to stable HTTPS, configure
   production OAuth/webhooks and required provider reviews, verify secrets,
   database backup/restore, Redis/worker recovery, monitoring and spend limits.
   Exercise failed provider calls and retry/deduplication in staging.
   Align the installed Prisma CLI/client versions before standardizing deployment
   commands; the recent successful migration-status check used Prisma 6.4.1
   explicitly, while the API package still declares a newer prerelease CLI.

### Before advertising calling or appointments as fully ready

5. **Voice:** the Dograh integration requires a published agent and telephony
   provisioning. Managed number setup and real inbound/outbound call acceptance
   remain; vendor spend limits and supported markets need configuration.
   E-commerce callback automation and WhatsApp Calling are not implemented.
6. **Appointments:** live create/cancel/reconnect, conflicting slots, timezones,
   retries and reminder delivery need acceptance for clinic/real-estate flows.
   Calendar connection/availability screenshots alone do not prove all of these.

### Subsequent product work

7. WooCommerce reporting parity, larger catalog/background reports, accounting
   definitions/net sales and best-seller analytics, localized onboarding and CRM
   handoff are separate planned capabilities, not current verified features.
   JARVIS is not required for this release.

For WhatsApp number registration, actual delivery proof, staff inbox receipt
visibility and calling specifics, see [connection progress](WHATSAPP_CONNECTION_PROGRESS.md).

## 11 October implementation update

Daily reporting now has a separate database-backed preview/scheduler. It reports
current order value (including unpaid orders) and the value of paid orders in
separate currency totals, plus order and unit counts, fulfillment, and top
products. The WhatsApp template must be an approved Utility template with seven
numbered body parameters. Workspace admins choose an E.164 recipient and local
delivery time and explicitly confirm recipient consent. Provider status is
stored; an ambiguous send is marked unknown and is never blindly repeated.

The daily report migration is `20261011000000_store_daily_reports`; it has been
applied to the local database. The report scheduler, data aggregation, template
validation, and API access controls have automated coverage. This does not
establish a live provider receipt. WhatsApp connection, Meta template approval,
consent and a real delivery remain external acceptance steps. See the
[production readiness record](PRODUCTION_READINESS.md) for the current release
gate.
