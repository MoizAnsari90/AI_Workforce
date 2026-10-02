# AI Workforce: two-screen merchant onboarding plan

Status: application-side onboarding foundations implemented, 2026-10-02. Provider approval, live provider accounts and end-to-end production onboarding are still release prerequisites.

## Product outcome

A workspace administrator connects one Shopify OR WooCommerce store on Integrations, then connects one WhatsApp Business number on WhatsApp. Normal onboarding requires no merchant-supplied developer client secret, access token, phone-number ID or webhook URL. Provider login, consent, account selection and number verification remain in the providers' hosted flows. Two AI Workforce screens does not mean only two clicks or two total provider screens.

V1 supports many independent customer workspaces, each with one Shopify OR WooCommerce store and one WhatsApp number. The API prevents both commerce providers from being connected to one workspace so stock questions always have one clear source. Model connections by provider and external account ID so multiple stores/numbers can be added later without redesigning tenant isolation. Other ecommerce platforms need their own connectors; there is no universal store connection.

## Observed repository baseline

- `apps/web/app/(protected)/dashboard/integrations/page.tsx` now exposes Shopify and WooCommerce connection cards, callback status and a WhatsApp setup link.
- `apps/api/src/routes/shopifyOAuthRoutes.ts` and the Shopify authentication/client services provide the existing OAuth flow.
- WhatsApp's settings screen now starts Meta Embedded Signup. The API exchanges the code, verifies the WABA/number association, subscribes the WABA, and stores encrypted per-workspace credentials. A shared webhook maps incoming phone-number IDs to a tenant.
- WooCommerce now has store authorization, secure callback verification, read-only REST credential storage, API checks, exact-SKU inventory lookup and disconnect routes. Order and variation/location inventory tools remain future work.
- Shopify setup documentation says uninstall webhooks are not yet wired. Audit existing lifecycle handling before public release.

## Customer journey

### Screen 1: Integrations

1. Select Shopify or WooCommerce.
2. Enter the store address and select Connect.
3. Log in and approve access on the store provider's page.
4. Return to the same screen. Show the verified store name, connection state and initial sync progress.
5. Offer a read-only product/stock check and Continue to WhatsApp.

Shopify uses the existing standalone OAuth authorization-code flow. WooCommerce uses its `/wc-auth/v1/authorize` application authentication endpoint to request key generation after merchant approval, followed by a server-side verification call. Do not require a WordPress plugin for the first compatible-store path; add a supported fallback only if real hosting compatibility warrants it.

WooCommerce preflight must verify HTTPS and a reachable supported WooCommerce API. Failed firewall/permalink/API checks must produce an actionable explanation, not a generic connection error.

### Screen 2: WhatsApp

1. Select Connect WhatsApp.
2. Complete Meta Embedded Signup: login, business/account selection or creation, eligible number selection/registration and required verification.
3. Return to this screen while the backend completes account linkage and webhook subscription.
4. Show the actual number, setup status and any remaining provider action.
5. Let the merchant send a test customer message from their own phone, verify the AI response against the connected store, then explicitly enable automatic replies.

Existing WhatsApp numbers require a supported eligibility/migration/coexistence branch. Do not promise every personal or Business App number can be connected unchanged. Confirm the applicable current Meta flow before implementation.

## Implementation sequence

### 1. Production prerequisites and shared connection state

- Configure real HTTPS dashboard/API URLs and exact callback URLs.
- Confirm Shopify public distribution and review path for unrelated merchants; a custom app distribution is not a general SaaS distribution strategy.
- Configure the platform-owned Meta app, Facebook Login for Business/Embedded Signup configuration, business verification and required permission review. Check current requirements in the production app dashboard.
- Prepare provider-required privacy/data-deletion endpoints and app information.
- Track connection states independently: disconnected, connecting, checking, syncing, ready, needs action and failed. Persist progress so refresh/retry resumes setup.
- Separate provider credentials, verified external identities, capabilities and readiness from the merchant's AI activation setting.

Implementation status: provider settings and account-ID mapping are in place. Deploy and provider-review settings remain external prerequisites.

### 2. Complete Shopify lifecycle and simplify Integrations

- Reuse and audit existing state validation, encrypted credentials and token refresh.
- Verify identity and required permissions before displaying Connected.
- Handle uninstall/revocation, refresh failure and reconnection.
- Add idempotent webhook processing and initial product/inventory sync where required; retain freshness timestamps and live checks for stock answers.
- Present permissions in business language; keep raw technical details in an optional details panel.

Implementation status: existing authorization and UI remain in use. Add and validate uninstall/revocation webhooks and live installation checks.

### 3. Replace normal WhatsApp credential entry with Embedded Signup

- Bind signup to the authenticated workspace and admin, validate callback/session origin and exchange authorization codes on the backend.
- Verify the granted WABA and number belong to the authorized business; derive identity server-side rather than trusting posted IDs.
- Store credentials encrypted and map each incoming number/account to exactly the correct workspace.
- Complete number registration/subscription steps required by the selected onboarding flow.
- Track incoming, outgoing and delivery events separately. A saved token alone is not proof of a working channel.
- Do not fall back to another tenant's or platform-wide production credentials when a tenant connection is missing.
- Add disconnect, reconnect, expired access and clear pending-verification states.

Implementation status: standard signup, account verification, encrypted storage, shared webhook routing, tenant credential selection and disconnect/reconnect controls are in code. Meta permissions/review and live event validation remain.

### 4. Add WooCommerce through a shared commerce interface

- Implement short-lived, single-use authorization correlation and secure key callbacks, then verify the actual store using the granted credentials.
- Validate arbitrary merchant URLs and redirects; prevent internal-network requests from server-side store checks.
- Encrypt per-connection keys, support revocation and verify webhook signatures.
- Normalize products, variants/SKUs, locations where supported, inventory and orders behind provider-specific adapters. Expose capability differences explicitly.
- Route the assistant through the workspace's selected connection. Do not assume Shopify's multi-location stock semantics exist in every WooCommerce store.

Implementation status: read-only WooCommerce authorization, verification, secure credential storage, disconnect and exact-SKU live stock answers in the WhatsApp/support assistant are in code. Add broader product/order capabilities and complete live hosting compatibility review.

### 5. Validate the complete business flow and release a pilot

- Connect two independent test merchants and prove their store data, WhatsApp numbers and credentials never mix.
- Test approved, denied, cancelled and expired authorization; refresh; duplicate callbacks/webhooks; disconnect; reconnect; and interrupted setup.
- Ask a product-stock question over WhatsApp and verify the response against that tenant's actual store. Change stock in a controlled test store and verify freshness.
- Verify missing/ambiguous products do not produce invented stock quantities.
- Verify messaging behavior follows the applicable Meta service-window/template requirements; show any provider billing/setup action that blocks readiness.
- Keep store writes opt-in and preserve human approval for refunds/cancellations. Verify order-specific customer information is not disclosed without appropriate customer verification.
- Run a small merchant pilot before general availability. Measure completion rate, time excluding provider review, and where help was needed.

## Definition of done

A new eligible merchant can connect their store and WhatsApp through the two application screens without developer credentials or staff editing their environment. Store reads, incoming messages, tenant routing and an actual AI response are independently verified. Failed or pending provider steps remain visible and retryable. Public availability requires the relevant provider approvals; code completion alone is not approval.

Recommended order: shared state and platform prerequisites, Shopify plus WhatsApp as a complete pilot, then WooCommerce on the same flow. Start provider review preparation early; review duration is external and should not be promised as engineering delivery time.

## References

- Shopify standalone authorization: https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps
- Shopify distribution: https://shopify.dev/docs/apps/launch/distribution/select-distribution-method
- WooCommerce application authentication endpoint: https://woocommerce.github.io/woocommerce-rest-api-docs/
- Current WooCommerce REST API: https://developer.woocommerce.com/docs/apis/rest-api/v3/
- Meta-owned Embedded Signup collection: https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
- Meta official sample app and prerequisites: https://github.com/fbsamples/business-messaging-sample-tech-provider-app

Meta developer documentation pages returned HTTP 429 during this planning review; Meta's own Postman documentation and official sample repository were available through search. Confirm detailed permissions and number-onboarding eligibility against the app dashboard/current official documentation during implementation.
