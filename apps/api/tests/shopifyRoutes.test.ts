import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../src/middleware/authMiddleware', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Authentication required' });
    req.tenantId = 'tenant-a';
    req.user = { userId: 'user', tenantId: 'tenant-a', role: req.headers['x-test-role'] || 'admin' };
    next();
  },
}));
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { storeCredential: vi.fn() } }));
vi.mock('../src/services/actionExecutorService', () => ({ ActionExecutorService: { executeAction: vi.fn() } }));
vi.mock('../src/services/approvalService', () => ({ ApprovalService: {} }));
vi.mock('../src/tools/shopifyTool', async (original) => {
  const actual = await original<typeof import('../src/tools/shopifyTool')>();
  return { ...actual, ShopifyTool: { checkStock: vi.fn() } };
});
import { shopifyRouter } from '../src/routes/shopifyRoutes';
import { ShopifyClient } from '../src/services/shopifyClient';
import { ShopifyTool } from '../src/tools/shopifyTool';
import { IntegrationService } from '../src/services/integrationService';
const app = express();
app.use(express.json());
app.use('/tenants/:tenantId/shopify', shopifyRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 400).json({ error: error.message }));
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('Shopify admin routes', () => {
  it('rejects anonymous access', async () => {
    expect((await request(app).get('/tenants/tenant-a/shopify/stock?sku=A')).status).toBe(401);
  });
  it('rejects a different tenant even for an admin', async () => {
    expect((await request(app).get('/tenants/tenant-b/shopify/stock?sku=A').set('Authorization', 'Bearer test')).status).toBe(403);
    expect(ShopifyTool.checkStock).not.toHaveBeenCalled();
  });
  it('rejects viewer access', async () => {
    expect((await request(app).get('/tenants/tenant-a/shopify/stock?sku=A').set('Authorization', 'Bearer test').set('x-test-role', 'viewer')).status).toBe(403);
  });
  it('uses the authenticated tenant for stock reads', async () => {
    vi.mocked(ShopifyTool.checkStock).mockResolvedValue({ success: true, provider: 'shopify', action: 'check_stock', sku: 'A', inventoryItemId: 'item', availableQuantity: 7, locations: [] });
    const response = await request(app).get('/tenants/tenant-a/shopify/stock?sku=A').set('Authorization', 'Bearer test');
    expect(response.status).toBe(200);
    expect(ShopifyTool.checkStock).toHaveBeenCalledWith('tenant-a', { sku: 'A' });
  });
  it('verifies access before saving and never returns the token', async () => {
    vi.spyOn(ShopifyClient.prototype, 'verifyConnection').mockResolvedValue({
      shop: { id: 'shop', name: 'Test', myshopifyDomain: 'test.myshopify.com' },
      currentAppInstallation: { accessScopes: [{ handle: 'read_inventory' }] },
    });
    const response = await request(app).put('/tenants/tenant-a/shopify/connection').set('Authorization', 'Bearer test')
      .send({ shop: 'test.myshopify.com', accessToken: 'secret-value' });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain('secret-value');
    expect(IntegrationService.storeCredential).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', config: { shop: 'test.myshopify.com', accessToken: 'secret-value', allowWrites: false },
    }));
  });
  it('does not save invalid provider credentials', async () => {
    vi.spyOn(ShopifyClient.prototype, 'verifyConnection').mockRejectedValue(new Error('HTTP 401'));
    await request(app).put('/tenants/tenant-a/shopify/connection').set('Authorization', 'Bearer test')
      .send({ shop: 'test.myshopify.com', accessToken: 'bad-token' });
    expect(IntegrationService.storeCredential).not.toHaveBeenCalled();
  });
});
