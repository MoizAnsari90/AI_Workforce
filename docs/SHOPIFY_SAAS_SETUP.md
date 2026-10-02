# Shopify self-serve connection

The dashboard's Integrations page connects a merchant-owned store through Shopify's authorization-code OAuth flow. Merchants enter their `store-name.myshopify.com` domain, review the permissions on Shopify, then return to the dashboard. The platform's Shopify client ID and secret stay on the API server; they are never entered or returned in the browser.

## Shopify app setup

Configure the Shopify app for distribution to the merchants you intend to serve. Apps intended for many unrelated merchants generally need public distribution and Shopify review; a custom-distributed app is limited to the distribution conditions Shopify sets for that app. Set the app's real HTTPS application URL and add this exact callback URL to its allowed redirect URLs:

```text
https://<your-api-host>/api/v1/shopify/oauth/callback
```

Request only the scopes used by the connector and keep the Shopify app's declared scopes in sync with this list:

```text
read_inventory,write_inventory,read_orders,write_orders
```

The app configuration in `shopify.app.toml` currently has development placeholder URLs. Replace those with the deployed application and callback URLs before releasing the app. Shopify also requires the merchant to approve requested scopes; changing app configuration alone does not grant them to an already-installed store.

## API environment

Set these values on the API service. Use the app credentials from Shopify's Dev Dashboard, a strong private encryption key, and the public callback URL registered above.

```dotenv
SHOPIFY_CLIENT_ID=<shopify-app-client-id>
SHOPIFY_CLIENT_SECRET=<shopify-app-client-secret>
SHOPIFY_REDIRECT_URI=https://<your-api-host>/api/v1/shopify/oauth/callback
SHOPIFY_SCOPES=read_inventory,write_inventory,read_orders,write_orders
INTEGRATION_ENCRYPTION_KEY=<private-random-value-at-least-32-characters>
JWT_SECRET=<platform-jwt-secret>
WEB_APP_URL=https://<your-dashboard-host>
```

Apply the existing database migrations before using the connector. Do not commit these secrets. Shopify access and refresh tokens are stored encrypted under the tenant's integration record. Expiring offline access tokens are refreshed and the returned refresh token is rotated in storage. The merchant's refresh token expires eventually; if refresh can no longer proceed, reconnect Shopify.

## Current behavior and limits

- One Shopify store can be connected to each workspace. A different store must be disconnected before another is connected; this avoids silently replacing credentials. Supporting multiple stores requires adding a store selector to integrations and routing every Shopify operation to the chosen store.
- Shopify write actions stay disabled until a workspace admin enables them, and existing approval requirements still apply to refund/cancel actions.
- Disconnecting removes the encrypted token from this platform. To revoke Shopify's installation itself, uninstall the app from Shopify Admin. An uninstall webhook is not wired yet.
- This flow uses Shopify OAuth rather than the client-credentials grant, which only applies to stores inside the app owner's Shopify organization. See [Shopify authentication](https://shopify.dev/docs/apps/build/authentication-authorization), [standalone authorization code grant](https://shopify.dev/docs/apps/build/authentication-authorization/authenticate-standalone-apps), and [app distribution](https://shopify.dev/docs/apps/launch/distribution).

## Verification

Automated OAuth helper tests mock Shopify's HTTP API. To verify a real connection, deploy the API and dashboard over HTTPS, configure the matching callback and scopes in Shopify, then use **Integrations → Connect Shopify** with a development store first. Confirm the store name and scopes appear after returning to the dashboard. The automated build does not verify Shopify app approval or live store permissions.
