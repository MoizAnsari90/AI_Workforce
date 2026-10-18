# Merchant self-serve connector setup

This setup supports the app-side flows for Shopify OAuth, WooCommerce REST key authorization, and WhatsApp Embedded Signup. A merchant still approves access on the provider's own page. Provider app review and production credentials are separate release prerequisites.

## API environment

Keep these values only on the API server:

```dotenv
WEB_APP_URL=https://<dashboard-host>
INTEGRATION_ENCRYPTION_KEY=<stable-private-random-value-at-least-32-characters>
SHOPIFY_CLIENT_ID=<shopify-app-client-id>
SHOPIFY_CLIENT_SECRET=<shopify-app-client-secret>
SHOPIFY_REDIRECT_URI=https://<api-host>/api/v1/shopify/oauth/callback
SHOPIFY_SCOPES=read_inventory,read_orders
WOOCOMMERCE_CALLBACK_URL=https://<api-host>/api/v1/woocommerce/oauth/callback
META_APP_ID=<meta-app-id>
META_APP_SECRET=<meta-app-secret>
META_EMBEDDED_SIGNUP_CONFIG_ID=<approved-embedded-signup-configuration-id>
META_GRAPH_API_VERSION=v26.0
META_VERIFY_TOKEN=<private-webhook-verification-token>
```

Use the scopes needed by enabled features. Shopify store writes remain separately gated in AI Workforce. WooCommerce currently requests read access only.

## Provider dashboards

### Shopify

Register the callback URL exactly as shown above. Public distribution and Shopify's app review are required for a product intended for unrelated merchants. Confirm requested access scopes with the actual product behavior before release. The current connection UI still accepts the `myshopify.com` store domain, then sends the merchant to Shopify's permission screen.

### WooCommerce

Set the callback URL above in API configuration. The merchant enters the store's public HTTPS address in Integrations, then approves the generated read-only key on WordPress. The store must expose `/wp-json/wc/v3/` and resolve to public internet IP addresses; the API blocks local/private IP destinations and HTTP redirects. Some hosts disable WooCommerce's built-in `/wc-auth/v1/authorize` flow, so show their REST API/firewall errors clearly and test supported hosting providers before promising universal compatibility.

### WhatsApp

Use a newly created **Embedded Signup v4** Facebook Login for Business configuration and save its ID as `META_EMBEDDED_SIGNUP_CONFIG_ID`. Select the WhatsApp products/assets/permissions required by the app in Meta's configuration builder; the web launch code uses v4's empty `extras` object and does not send the retired v2/v3 `sessionInfoVersion`.

Create the configuration with the **WhatsApp Embedded Signup** login variation, **WhatsApp Cloud API** product, **System-user access token**, **WhatsApp accounts** assets, and `whatsapp_business_management` plus `whatsapp_business_messaging`. A generic user-token Facebook login configuration can approve login without returning a WhatsApp number; replace that configuration rather than retrying it indefinitely. Add the dashboard HTTPS origin to Facebook Login for Business's allowed JavaScript SDK domains and configure the corresponding allowed OAuth redirects. Enable the JavaScript SDK and Web OAuth login. Local development uses `https://localhost:3000`; a public HTTPS tunnel/domain may be needed if Meta does not accept your local origin. Keep the same origin throughout login and signup.

The manually configured `META_ACCESS_TOKEN` is not a substitute for workspace Embedded Signup. The workspace token comes from the authorization-code exchange and is stored encrypted. An expired developer test token must be regenerated for manual Graph API tests, but changing it alone does not repair a signup configuration.

Configuration reference: [Twilio's Meta Embedded Signup v4 configuration steps](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide#add-embedded-signup-to-your-application). This project uses Meta Cloud API directly; Twilio Partner Solution IDs and Twilio account setup do not apply.

Set the app webhook callback to:

```text
https://<api-host>/api/v1/webhook/whatsapp
```

Set the same private value in the callback verification field and `META_VERIFY_TOKEN`. Subscribe the app to the WhatsApp message webhook field. Finish Meta business verification, App Review and permission access for production onboarding; dashboard configuration IDs do not grant production permission by themselves. The embedded flow's event data includes the selected WABA and phone-number IDs; the API exchanges its one-use authorization code server-side, verifies those assets, subscribes the WABA, and stores the token encrypted per workspace.

The implemented flow covers the standard v4 Embedded Signup path and requires a selected Cloud API phone number before it can save the connection. A WABA-only completion is reported to the user so they can finish number setup. It does not promise WhatsApp Business App coexistence for every existing number. Confirm the account's eligibility and the current Meta-supported coexistence configuration separately. A connected WhatsApp account also has provider-managed billing and messaging-policy requirements.

## Database rollout

Apply the new migration before deploying the API version that routes WhatsApp callbacks by `external_account_id`:

```powershell
cd apps/api
npx prisma migrate deploy
npm run prisma:generate
```

The migration adds an indexed external account ID to encrypted integration records. On Windows, stop any API process that has locked Prisma's query-engine DLL before generating the client. The API process must be restarted after applying the migration.

## Current implementation boundaries

- Shopify: existing OAuth install/callback flow, tenant-scoped encrypted credentials and refresh path. Uninstall webhook/revocation handling still needs a complete lifecycle review.
- WooCommerce: read-only key auth, HTTPS/public-address validation, live API verification, disconnect and exact-SKU tracked-quantity lookup in the support assistant. Order queries, variation/location inventory and a shared full product model are not implemented yet.
- WhatsApp: Meta Embedded Signup, encrypted per-workspace credentials, number-to-workspace webhook routing and outgoing-message credential selection. Automated AI activation remains a deliberate workspace decision.
- One commerce store (Shopify or WooCommerce) and one WhatsApp number per workspace are supported for now. A workspace cannot connect both commerce providers.

Do not claim “fully automatic AI workforce connected” to a merchant until live messages are routed to the right workspace and a test stock answer is checked against that workspace's store.
