# Shopify connection and testing

The backend now calls Shopify Admin GraphQL API 2026-07 for stock reads, payment refunds and order cancellations. A successful local build or mocked test does not verify a live store.

## First test: read only

1. Use a development store if available. Install the Shopify app on the intended store and grant inventory/location read access. The existing TOML also requests product/inventory/order write scopes; this connector keeps writes disabled independently.
2. Obtain an **Admin API access token**, not a Storefront token or client secret. For an app and store in the same Shopify organization, follow [Shopify's client credentials guide](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant). This grant is only for eligible stores in your organization; other stores need Shopify's authorization flow. For the tenant/store selected in the local environment, client-credential tokens now renew automatically when an operation starts within 60 seconds of expiry. Manual access tokens without matching client credentials still require reconnection.
Alternatively, set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET locally. The connect command exchanges these with Shopify and stores the token expiry. Subsequent tenant operations automatically renew near expiry. Client credentials take precedence over SHOPIFY_ACCESS_TOKEN when present.

3. Put the following values in the ignored `apps/api/.env` locally. Never paste secrets into chat or commit them:

```dotenv
SHOPIFY_TENANT_ID=<existing platform tenant UUID>
SHOPIFY_SHOP=<store>.myshopify.com
SHOPIFY_ACCESS_TOKEN=<Admin API access token>
SHOPIFY_TEST_SKU=<unique SKU with tracked inventory>
INTEGRATION_ENCRYPTION_KEY=<private random value of at least 32 characters>
```

Keep an existing integration encryption key unchanged. Changing it makes previously stored credentials unreadable. The database must already contain the platform tenant and external integration credential table. Review migration status before applying any pending migrations; no migrations are automatically applied by these commands.

4. From the repository root:

```powershell
npm.cmd -w @ai-employee/api run shopify:connect
npm.cmd -w @ai-employee/api run shopify:check
```

Connect verifies the provider before storing encrypted credentials and always sets `allowWrites: false`. Check reads shop information and, if a test SKU is set, available quantities at each location. Compare those quantities with Shopify Admin. Neither command refunds, cancels, restocks or sends customer notifications. An invalid/expired token, missing scope, absent SKU or ambiguous SKU fails instead of returning simulated success.

## Authenticated API

All routes below are under `/api/v1/tenants/:tenantId/shopify` and require the platform admin Bearer token for that same tenant. Use HTTPS outside localhost. Credentials are never returned.

| Method/path | Input/purpose |
| --- | --- |
| PUT /connection | JSON `{shop, accessToken, allowWrites:false}`; verify and save |
| GET /connection | Verify stored credentials and show granted scopes |
| GET /stock?sku=... | Read live available stock; optional `locationId` GID |
| GET /approvals | List Shopify approvals and execution state |
| POST /actions | `{agentId, actionType, payload, approvalId?}` |
| POST /approvals/:approvalId/review | `{status:"approved"}` or `{status:"rejected", rejectionReason:"..."}` |

For writes, explicitly reconnect with `allowWrites:true` and `write_orders` scope. Use an existing agent belonging to the tenant. First submit the action without an approvalId, review the resulting pending approval, then resubmit the same action/payload with that approvalId. Changed order, amount, action or agent is rejected. Approval consumption is atomic; a consumed or uncertain approval is never automatically retried.

Refund payload:

```json
{
  "orderId": "gid://shopify/Order/123",
  "amount": 1,
  "currency": "USD",
  "parentTransactionId": "gid://shopify/OrderTransaction/456",
  "reason": "Approved test refund"
}
```

Use actual IDs from a paid test order, its successful SALE/CAPTURE transaction, and the customer's payment currency. Refunds are payment-only here, without line-item restocking. They use the approval UUID as the provider idempotency key. [Shopify refund API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/refundCreate).

Cancellation payload:

```json
{"orderId":"gid://shopify/Order/123","reason":"OTHER","restock":false,"refund":false}
```

Cancellation can still void payment authorizations even when refund is false. Confirm the exact test order and expected side effects before approval. Customer notifications are disabled. [Shopify cancellation API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/orderCancel).

A cancellation job or unsettled refund returns PENDING, not SUCCESS. Confirm completion in Shopify Admin. For `execution_uncertain` or `provider_pending`, reconcile the order/payment with the provider before creating any new approval. Automatic webhook reconciliation is not implemented.

## Remaining deployment setup

This is a backend connector supporting Admin API tokens and tenant-bound client-credential renewal. The existing `shopify.app.toml` application/callback URLs remain placeholders because the real public app URL has not been supplied. Do not treat the app as ready for embedded installation or OAuth: configure the actual HTTPS URLs and implement that installation flow before distributing it. The connector smoke test above does not use those placeholder URLs. No live mutation or deployment is performed by the automated tests.

## Local verification

```powershell
npm.cmd run build
npm.cmd -w @ai-employee/api test -- tests/shopify.test.ts tests/shopifyRoutes.test.ts tests/healthcare.test.ts tests/idempotency.test.ts
```

The targeted tests mock provider/network/database calls. The existing broader integration suite uses a configured local database; run it only against an isolated test database.

## Provider-only verification

Run: npm.cmd -w @ai-employee/api run shopify:check -- --verify

This exchanges client credentials and reads the shop and a small inventory sample without saving a token or requiring a platform tenant. The sample excludes location names so it works without read_locations. Full SKU stock checks require a nonempty unique SKU and inventory access. Location names are optional and only requested when the corresponding permission is granted. The token and client secret are never printed. Scope changes in shopify.app.toml do not grant permissions until the app version and store installation are updated.


## Automatic renewal and configured stock test

The local connection belongs to the yaseen tenant and ai-workforce-test.myshopify.com. SHOPIFY_TEST_SKU is set to the existing tracked sku-managed-1 product. No product SKU or inventory quantity was changed.

Renewal checks both SHOPIFY_TENANT_ID and SHOPIFY_SHOP before using the environment client credentials. Concurrent requests within one API process share a renewal attempt. Encrypted persistence compares the old credential snapshot and refuses to recreate a removed connection or overwrite a changed setting. A provider failure leaves the saved token unchanged. Multiple API processes may independently renew; a process that loses the persistence race reports a retryable connection-change error rather than overwriting another process.

To verify a real renewal explicitly:

```powershell
npm.cmd -w @ai-employee/api run shopify:check -- --refresh
```

The read_locations-20260929 app version has been released. A stale Shopify development preview can keep older scopes active even after a release. When that preview contains only obsolete app configuration, use Shopify's app dev clean command for the test store to restore the active version, then refresh the token and check granted scopes. Inspect preview contents first; previews containing extensions can have associated data.

## Verified store result (2026-09-29)

- Account: yaseen; store: ai-workforce-test.myshopify.com.
- Saved connection and real token renewal succeeded. Write actions remain disabled.
- Existing tracked SKU sku-managed-1 returned 100 available units: 50 at each of two locations.
- Location IDs are available with current inventory access. Location names are returned as null, with locationNamesAvailable=false, until read_locations (or equivalent name-read permission) is granted. The stock quantity remains usable.
- Version read-locations-20260929 was released and the stale configuration-only development preview was cleaned. The store token still did not list read_locations after refresh.
- Store owner should open AI Workfotce Test under Shopify Admin > Apps and approve an update prompt if shown. Afterwards run shopify:check -- --refresh to verify the actual granted scope and names. Do not assume a released config means the scope is granted.
- The direct Shopify App ID and fetched remote config confirm the same app is connected. A preliminary inline-shell ID comparison was misleading; do not use it to infer a different app.
- Avoid printing raw shopify app info --json: it can include local dotenv values. Filter metadata before logging.

To exercise the support assistant's natural-language, read-only Shopify stock path without creating a conversation or sending WhatsApp messages, run:

```powershell
npm.cmd -w @ai-employee/api run shopify:check -- --refresh --assistant
```

Stock questions with an exact SKU are answered from live Shopify data; missing SKUs are requested, and provider errors are escalated instead of guessed. This does not enable Shopify writes or test refund/cancellation actions.

Renewal and stock regression commands:

```powershell
npm.cmd -w @ai-employee/api test -- tests/shopify.test.ts tests/shopifyAuth.test.ts tests/shopifyRefresh.test.ts tests/shopifyCredentialRefresh.test.ts tests/shopifyRoutes.test.ts
npm.cmd -w @ai-employee/api run build
```
