import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: vi.fn(), replaceCredentialIfUnchanged: vi.fn() } }));
import { IntegrationService } from '../src/services/integrationService';
import { ShopifyClient } from '../src/services/shopifyClient';
const expired = { shop: 'test.myshopify.com', accessToken: 'old', expiresAt: '2020-01-01T00:00:00.000Z', allowWrites: false };
let stored: Record<string, unknown> | null;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SHOPIFY_TENANT_ID', 'tenant');
  vi.stubEnv('SHOPIFY_SHOP', expired.shop);
  vi.stubEnv('SHOPIFY_CLIENT_ID', 'client');
  vi.stubEnv('SHOPIFY_CLIENT_SECRET', 'private');
  stored = { ...expired };
  vi.mocked(IntegrationService.getCredential).mockImplementation(async () => stored);
  vi.mocked(IntegrationService.replaceCredentialIfUnchanged).mockImplementation(async (_tenant, _provider, _expected, config) => { stored = config; return true; });
  fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'renewed', expires_in: 86400 })));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Automatic Shopify renewal', () => {
  it('renews before use, encrypts through the credential service and preserves read-only mode', async () => {
    await ShopifyClient.forTenant('tenant');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({ accessToken: 'renewed', allowWrites: false, shop: expired.shop });
    expect(IntegrationService.replaceCredentialIfUnchanged).toHaveBeenCalledWith('tenant', 'shopify', expired, expect.objectContaining({ accessToken: 'renewed' }));
  });
  it('does not renew unexpired credentials', async () => {
    stored = { ...expired, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await ShopifyClient.forTenant('tenant');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never uses another tenants client credentials', async () => {
    await expect(ShopifyClient.forTenant('other')).rejects.toThrow('matching tenant');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never sends the secret to a different stored store', async () => {
    stored = { ...expired, shop: 'another.myshopify.com' };
    await expect(ShopifyClient.forTenant('tenant')).rejects.toThrow('matching tenant');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent refreshes in the process', async () => {
    await Promise.all([ShopifyClient.forTenant('tenant'), ShopifyClient.forTenant('tenant')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(IntegrationService.replaceCredentialIfUnchanged).toHaveBeenCalledTimes(1);
  });
  it('does not recreate an integration removed or changed during refresh', async () => {
    vi.mocked(IntegrationService.replaceCredentialIfUnchanged).mockResolvedValue(false);
    await expect(ShopifyClient.forTenant('tenant')).rejects.toThrow('changed during renewal');
    expect(stored).toEqual(expired);
  });
  it('preserves old data on provider failure and allows a later fresh attempt', async () => {
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(ShopifyClient.forTenant('tenant')).rejects.toThrow('HTTP 401');
    expect(IntegrationService.replaceCredentialIfUnchanged).not.toHaveBeenCalled();
    await ShopifyClient.forTenant('tenant');
    expect(stored).toMatchObject({ accessToken: 'renewed' });
  });
  it('rejects writes before refreshing a read-only connection', async () => {
    await expect(ShopifyClient.forTenant('tenant', true)).rejects.toThrow('disabled');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
