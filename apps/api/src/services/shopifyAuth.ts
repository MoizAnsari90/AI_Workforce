import { shopifyCredentialSchema } from './shopifyClient';
import crypto from 'node:crypto';

const shopPattern = shopifyCredentialSchema.shape.shop;
export function shopifyAppCredentials(requireCallback = false) {
  const clientId = process.env.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET?.trim();
  const callbackUrl = process.env.SHOPIFY_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || (requireCallback && !callbackUrl)) throw new Error('Shopify OAuth is not configured (SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_REDIRECT_URI)');
  return { clientId, clientSecret, callbackUrl: callbackUrl! };
}

export function createShopifyInstallUrl(shop: string, state: string) {
  const validShop = shopPattern.safeParse(shop);
  if (!validShop.success) throw new Error('Enter a valid shop-name.myshopify.com domain');
  const { clientId, callbackUrl } = shopifyAppCredentials(true);
  const url = new URL(`https://${validShop.data}/admin/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', process.env.SHOPIFY_SCOPES || 'read_inventory,write_inventory,read_orders,write_orders');
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

export function verifyShopifyCallbackHmac(query: Record<string, unknown>) {
  const hmac = typeof query.hmac === 'string' ? query.hmac : '';
  if (!/^[a-f0-9]{64}$/i.test(hmac)) return false;
  const { clientSecret } = shopifyAppCredentials();
  const message = Object.entries(query)
    .filter(([key, value]) => key !== 'hmac' && key !== 'signature' && typeof value === 'string')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value as string}`)
    .join('&');
  const digest = crypto.createHmac('sha256', clientSecret).update(message).digest();
  const supplied = Buffer.from(hmac, 'hex');
  return supplied.length === digest.length && crypto.timingSafeEqual(supplied, digest);
}

export async function exchangeShopifyAuthorizationCode(shop: string, code: string) {
  const validShop = shopPattern.safeParse(shop);
  if (!validShop.success || !code) throw new Error('Invalid Shopify authorization callback');
  const { clientId, clientSecret } = shopifyAppCredentials(true);
  let response: Response;
  try {
    response = await fetch(`https://${validShop.data}/admin/oauth/access_token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, expiring: '1' }),
    });
  } catch { throw new Error('Shopify token endpoint could not be reached'); }
  if (!response.ok) throw new Error(`Shopify authorization exchange returned HTTP ${response.status}`);
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('access_token' in body) || !('expires_in' in body) ||
      typeof body.access_token !== 'string' || typeof body.expires_in !== 'number' ||
      !('refresh_token' in body) || typeof body.refresh_token !== 'string' ||
      !('refresh_token_expires_in' in body) || typeof body.refresh_token_expires_in !== 'number') {
    throw new Error('Shopify did not return expiring offline token credentials');
  }
  const token = body as { access_token: string; expires_in: number; refresh_token: string; refresh_token_expires_in: number };
  return {
    accessToken: token.access_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refreshToken: token.refresh_token,
    refreshTokenExpiresAt: new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString(),
  };
}

export async function refreshShopifyOfflineToken(shop: string, refreshToken: string) {
  const validShop = shopPattern.safeParse(shop);
  if (!validShop.success) throw new Error('Invalid Shopify shop domain');
  const { clientId, clientSecret } = shopifyAppCredentials();
  let response: Response;
  try {
    response = await fetch(`https://${validShop.data}/admin/oauth/access_token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
  } catch { throw new Error('Shopify token refresh could not be reached'); }
  if (!response.ok) throw new Error(`Shopify token refresh returned HTTP ${response.status}; reconnect the store`);
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('access_token' in body) || !('expires_in' in body) ||
      typeof body.access_token !== 'string' || typeof body.expires_in !== 'number' ||
      !('refresh_token' in body) || typeof body.refresh_token !== 'string' ||
      !('refresh_token_expires_in' in body) || typeof body.refresh_token_expires_in !== 'number') {
    throw new Error('Shopify returned invalid refreshed credentials');
  }
  const token = body as { access_token: string; expires_in: number; refresh_token: string; refresh_token_expires_in: number };
  return {
    accessToken: token.access_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refreshToken: token.refresh_token,
    refreshTokenExpiresAt: new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString(),
  };
}

export async function exchangeShopifyCredentials(shop: string, clientId: string, clientSecret: string) {
  const validShop = shopifyCredentialSchema.shape.shop.safeParse(shop);
  if (!validShop.success) throw new Error('SHOPIFY_SHOP must be a myshopify.com hostname');
  if (!clientId?.trim() || !clientSecret?.trim()) throw new Error('Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET locally');
  let response: Response;
  try {
    response = await fetch(`https://${validShop.data}/admin/oauth/access_token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId.trim(), client_secret: clientSecret.trim() }),
    });
  } catch {
    throw new Error('Shopify token endpoint could not be reached');
  }
  if (!response.ok) throw new Error(`Shopify token exchange returned HTTP ${response.status}; verify credentials, app installation, and that app/store belong to the same organization`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Shopify returned an invalid token response'); }
  if (!body || typeof body !== 'object' || !('access_token' in body) || !('expires_in' in body) || typeof body.access_token !== 'string' || !body.access_token || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    throw new Error('Shopify returned an invalid token response');
  }
  return { accessToken: body.access_token, expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString() };
}
