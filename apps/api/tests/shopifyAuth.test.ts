import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: vi.fn() } }));
import { exchangeShopifyCredentials } from '../src/services/shopifyAuth';
import { ShopifyClient } from '../src/services/shopifyClient';
import { IntegrationService } from '../src/services/integrationService';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Shopify credential exchange', () => {
  it('uses only the validated official store endpoint and returns expiry', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'token', expires_in: 86400 })));
    vi.stubGlobal('fetch', fetcher);
    const result = await exchangeShopifyCredentials('ai-workforce-test.myshopify.com', 'client', 'secret');
    expect(result.accessToken).toBe('token');
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now() + 86000000);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://ai-workforce-test.myshopify.com/admin/oauth/access_token');
    expect(init.redirect).toBe('error');
    expect(init.body.get('grant_type')).toBe('client_credentials');
  });
  it('blocks arbitrary hosts before transmitting credentials', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(exchangeShopifyCredentials('evil.test', 'client', 'secret')).rejects.toThrow('hostname');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not include provider response bodies or secrets in authentication errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive secret', { status: 401 })));
    await expect(exchangeShopifyCredentials('test.myshopify.com', 'client', 'secret')).rejects.toThrow('HTTP 401');
  });
  it('rejects missing expiry or token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ expires_in: 86400 }))));
    await expect(exchangeShopifyCredentials('test.myshopify.com', 'client', 'secret')).rejects.toThrow('invalid token');
  });
  it('rejects stored expired tokens before network access', async () => {
    vi.mocked(IntegrationService.getCredential).mockResolvedValue({ shop: 'test.myshopify.com', accessToken: 'token', expiresAt: '2020-01-01T00:00:00.000Z' });
    await expect(ShopifyClient.forTenant('tenant')).rejects.toThrow('expired');
  });
  it('redacts access tokens from GraphQL errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: 'bad secret-token' }] }))));
    await expect(new ShopifyClient({ shop: 'test.myshopify.com', accessToken: 'secret-token', allowWrites: false }).verifyConnection()).rejects.toThrow('bad [redacted]');
  });
});
