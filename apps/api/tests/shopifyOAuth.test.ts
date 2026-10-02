import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { createShopifyInstallUrl, exchangeShopifyAuthorizationCode, refreshShopifyOfflineToken, verifyShopifyCallbackHmac } from '../src/services/shopifyAuth';

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.SHOPIFY_CLIENT_ID = 'client-id';
  process.env.SHOPIFY_CLIENT_SECRET = 'test-shopify-secret';
  process.env.SHOPIFY_REDIRECT_URI = 'https://api.example.com/api/v1/shopify/oauth/callback';
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe('Shopify merchant OAuth', () => {
  it('builds a merchant consent URL for an allowlisted Shopify domain', () => {
    const url = new URL(createShopifyInstallUrl('demo-shop.myshopify.com', 'random-state'));
    expect(url.origin).toBe('https://demo-shop.myshopify.com');
    expect(url.pathname).toBe('/admin/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(process.env.SHOPIFY_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('random-state');
    expect(url.searchParams.has('expiring')).toBe(false);
    expect(() => createShopifyInstallUrl('https://demo-shop.myshopify.com/path', 'state')).toThrow();
  });

  it('validates Shopify callback HMAC and rejects query tampering', () => {
    const query: Record<string, unknown> = { shop: 'demo-shop.myshopify.com', state: 'opaque-state', timestamp: '12345', code: 'one-time-code' };
    const message = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
    query.hmac = crypto.createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET!).update(message).digest('hex');
    expect(verifyShopifyCallbackHmac(query)).toBe(true);
    expect(verifyShopifyCallbackHmac({ ...query, shop: 'attacker.myshopify.com' })).toBe(false);
  });

  it('exchanges the authorization code for expiring offline tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'access', expires_in: 3600, refresh_token: 'refresh', refresh_token_expires_in: 7776000 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await exchangeShopifyAuthorizationCode('demo-shop.myshopify.com', 'code');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get('client_secret')).toBe('test-shopify-secret');
    expect(body.get('code')).toBe('code');
    expect(body.get('expiring')).toBe('1');
    expect(token.accessToken).toBe('access');
    expect(token.refreshToken).toBe('refresh');
    expect(Date.parse(token.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('rotates the refresh token before the offline token expires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'next-access', expires_in: 3600, refresh_token: 'next-refresh', refresh_token_expires_in: 7776000 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await refreshShopifyOfflineToken('demo-shop.myshopify.com', 'old-refresh');
    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(token.refreshToken).toBe('next-refresh');
  });
});
