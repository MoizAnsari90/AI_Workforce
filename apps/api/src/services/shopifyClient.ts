import { z } from 'zod';
import { IntegrationService } from './integrationService';

export const SHOPIFY_API_VERSION = '2026-07';
export const shopifyCredentialSchema = z.object({
  shop: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, 'Use a myshopify.com hostname without https or a path'),
  accessToken: z.string().trim().min(1),
  allowWrites: z.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
  refreshToken: z.string().min(1).optional(),
  refreshTokenExpiresAt: z.string().datetime().optional(),
}).strict();
export type ShopifyCredential = z.infer<typeof shopifyCredentialSchema>;

export class ShopifyClient {
  constructor(private readonly credential: ShopifyCredential) {}
  private static readonly refreshes = new Map<string, Promise<void>>();
  static async forTenant(tenantId: string, write = false, forceRefresh = false) {
    let stored = await IntegrationService.getCredential(tenantId, 'shopify');
    if (!stored) throw new Error('Shopify is not connected for this tenant');
    let parsed = shopifyCredentialSchema.safeParse(stored);
    if (!parsed.success) throw new Error('Shopify credentials are invalid; reconnect the store');
    if (write && !parsed.data.allowWrites) throw new Error('Shopify write actions are disabled');
    if (forceRefresh || (parsed.data.expiresAt && Date.parse(parsed.data.expiresAt) <= Date.now() + 60000)) {
      const refreshable = Boolean(parsed.data.refreshToken && parsed.data.refreshTokenExpiresAt && Date.parse(parsed.data.refreshTokenExpiresAt) > Date.now());
      if (!refreshable && (process.env.SHOPIFY_TENANT_ID !== tenantId ||
          process.env.SHOPIFY_SHOP?.trim().toLowerCase() !== parsed.data.shop ||
          !process.env.SHOPIFY_CLIENT_ID || !process.env.SHOPIFY_CLIENT_SECRET)) {
        throw new Error('Shopify access token expired or refresh unavailable; configure matching tenant/store client credentials');
      }
      let pending = this.refreshes.get(tenantId);
      if (!pending) {
        const expected = stored;
        const config = parsed.data;
        pending = (async () => {
          const { exchangeShopifyCredentials, refreshShopifyOfflineToken } = await import('./shopifyAuth');
          const token = refreshable
            ? await refreshShopifyOfflineToken(config.shop, config.refreshToken!)
            : await exchangeShopifyCredentials(config.shop, process.env.SHOPIFY_CLIENT_ID!, process.env.SHOPIFY_CLIENT_SECRET!);
          const saved = await IntegrationService.replaceCredentialIfUnchanged(tenantId, 'shopify', expected, { ...config, ...token });
          if (!saved) throw new Error('Shopify connection changed during renewal; retry using the current connection');
        })();
        this.refreshes.set(tenantId, pending);
      }
      try { await pending; } finally {
        if (this.refreshes.get(tenantId) === pending) this.refreshes.delete(tenantId);
      }
      stored = await IntegrationService.getCredential(tenantId, 'shopify');
      parsed = shopifyCredentialSchema.safeParse(stored);
      if (!parsed.success) throw new Error('Shopify connection was removed during renewal');
      if (parsed.data.expiresAt && Date.parse(parsed.data.expiresAt) <= Date.now() + 60000) throw new Error('Shopify renewal did not produce a usable token');
      if (write && !parsed.data.allowWrites) throw new Error('Shopify write actions are disabled');
    }
    return new ShopifyClient(parsed.data);
  }
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://${this.credential.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': this.credential.accessToken },
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new Error('Shopify request could not be confirmed; reconcile before retrying a write');
    }
    if (!response.ok) throw new Error(`Shopify API returned HTTP ${response.status}`);
    const body = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
    if (body.errors?.length) {
      const details = body.errors.map(e => typeof e.message === 'string' ? e.message.split(this.credential.accessToken).join('[redacted]') : 'Unknown GraphQL error').join('; ');
      throw new Error('Shopify rejected the request: ' + details);
    }
    if (!body.data) throw new Error('Shopify returned no data');
    return body.data;
  }
  async verifyConnection() {
    return this.query<{ shop: { id: string; name: string; myshopifyDomain: string }; currentAppInstallation: { accessScopes: Array<{ handle: string }> } }>(
      'query VerifyConnection { shop { id name myshopifyDomain } currentAppInstallation { accessScopes { handle } } }');
  }
}
