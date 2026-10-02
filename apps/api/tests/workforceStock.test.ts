import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const { getCredential, wooRequest } = vi.hoisted(() => ({ getCredential: vi.fn(), wooRequest: vi.fn() }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: any, res: any, next: any) => {
  if (!req.headers.authorization) return res.sendStatus(401);
  req.tenantId = 'tenant-a';
  req.user = { tenantId: 'tenant-a', userId: 'user', permissions: req.headers['x-no-permission'] ? [] : ['operations:read'] };
  next();
} }));
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential } }));
vi.mock('../src/services/woocommerceClient', async () => {
  const actual = await vi.importActual<typeof import('../src/services/woocommerceClient')>('../src/services/woocommerceClient');
  return { ...actual, WooCommerceClient: class { request = wooRequest; } };
});
vi.mock('../src/services/geminiService', () => ({ runWorkforceAssistant: vi.fn() }));
vi.mock('../src/tools/shopifyTool', () => ({ ShopifyTool: { checkStock: vi.fn() } }));
import { ShopifyTool } from '../src/tools/shopifyTool';
import { runWorkforceAssistant } from '../src/services/geminiService';
import { operationsRouter } from '../src/routes/operationsRoutes';
import { answerWorkforceStockQuestion } from '../src/services/workforceStockService';
import { ShopifyStockError } from '../src/errors/ShopifyStockError';
const app = express();
app.use(express.json(), operationsRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 400).json({ error: err.message }));
beforeEach(() => { vi.clearAllMocks(); getCredential.mockResolvedValue(null); });

it.each(['SKU A aur SKU B dono ka stock?', 'SKUs A, B ka stock?', 'SKU A and B stock?'])('reports every requested SKU independently: %s', async question => {
  vi.mocked(ShopifyTool.checkStock).mockImplementation(async (_tenant, { sku }) => {
    if (sku === 'B') throw new ShopifyStockError('SKU_NOT_FOUND');
    return { success: true, provider: 'shopify', action: 'check_stock', sku, inventoryItemId: 'item', availableQuantity: 7, locations: [], locationNamesAvailable: false };
  });
  const result = await answerWorkforceStockQuestion('tenant-a', question);
  expect(result?.status).toBe('partial');
  expect(result?.answer).toContain('7 available units');
  expect(result?.answer).toContain('SKU B: SKU not found');
  expect(ShopifyTool.checkStock).toHaveBeenCalledWith('tenant-a', { sku: 'B' });
});
it('does not silently truncate a request above the batch limit', async () => {
  const result = await answerWorkforceStockQuestion('tenant-a', 'SKUs A, B, C, D, E, F stock?');
  expect(result?.answer).toContain('up to 5');
  expect(ShopifyTool.checkStock).not.toHaveBeenCalled();
});
it.each(['SKU_AMBIGUOUS', 'INVENTORY_NOT_TRACKED'] as const)('keeps %s distinct from an unknown SKU', async code => {
  vi.mocked(ShopifyTool.checkStock).mockRejectedValue(new ShopifyStockError(code));
  const result = await answerWorkforceStockQuestion('tenant-a', 'SKU A stock?');
  expect(result).toMatchObject({ code, status: 'unavailable' });
});

it.each(['Check stock for SKU: ABC-1', 'SKU ABC-1 ka stock kitna hai?'])('routes %s to tenant-scoped Shopify without Gemini', async question => {
  vi.mocked(ShopifyTool.checkStock).mockResolvedValue({ success: true, provider: 'shopify', action: 'check_stock', sku: 'ABC-1', inventoryItemId: 'item', availableQuantity: 0, locations: [{ locationId: 'loc', name: 'Warehouse', availableQuantity: 0 }], locationNamesAvailable: true });
  const res = await request(app).post('/tenants/tenant-a/workforce/ask').set('Authorization', 'Bearer test').send({ question });
  expect(res.status).toBe(200);
  expect(ShopifyTool.checkStock).toHaveBeenCalledWith('tenant-a', { sku: 'ABC-1' });
  expect(res.body.data).toMatchObject({ source: 'shopify', status: 'success', readOnly: true, checkedAt: expect.any(String) });
  expect(res.body.data.answer).toContain('Warehouse: 0 units');
  expect(runWorkforceAssistant).not.toHaveBeenCalled();
});
it('asks for SKU for the product-name question without guessing', async () => {
  const answer = await answerWorkforceStockQuestion('tenant-a', 'Support AI plz check HR Clothing part product are avalable in stock in your store');
  expect(answer?.status).toBe('needs_sku');
  expect(ShopifyTool.checkStock).not.toHaveBeenCalled();
});
it('keeps database stock alert metrics on the existing metrics path', async () => {
  expect(await answerWorkforceStockQuestion('tenant-a', 'How many low stock alerts are open?')).toBeNull();
  expect(await answerWorkforceStockQuestion('tenant-a', 'Which agents are available?')).toBeNull();
});
it('returns an explicit unavailable result on provider failure without leaking secrets or inventing stock', async () => {
  vi.mocked(ShopifyTool.checkStock).mockRejectedValue(new Error('secret-provider-token'));
  const answer = await answerWorkforceStockQuestion('tenant-a', 'sku-managed-1 ka stock kitna hai?');
  expect(ShopifyTool.checkStock).toHaveBeenCalledWith('tenant-a', { sku: 'sku-managed-1' });
  expect(answer?.status).toBe('unavailable');
  expect(JSON.stringify(answer)).not.toContain('secret-provider-token');
  expect(answer).not.toHaveProperty('stock');
});
it('answers WooCommerce SKU stock from the connected workspace store', async () => {
  getCredential.mockResolvedValue({ storeUrl: 'https://shop.example', consumerKey: 'ck_12345678', consumerSecret: 'cs_12345678' });
  wooRequest.mockResolvedValue([{ id: 7, sku: 'ABC-1', name: 'T-shirt', manage_stock: true, stock_quantity: 11, stock_status: 'instock' }]);
  const answer = await answerWorkforceStockQuestion('tenant-a', 'Check stock for SKU: ABC-1');
  expect(answer).toMatchObject({ source: 'woocommerce', status: 'success', stock: { availableQuantity: 11 } });
  expect(answer?.answer).toContain('Live WooCommerce stock for SKU ABC-1 (T-shirt): 11 available units');
  expect(wooRequest).toHaveBeenCalledWith(expect.stringContaining('products?sku=ABC-1'));
  expect(ShopifyTool.checkStock).not.toHaveBeenCalled();
});

it('does not invent WooCommerce stock when inventory is not tracked', async () => {
  getCredential.mockResolvedValue({ storeUrl: 'https://shop.example', consumerKey: 'ck_12345678', consumerSecret: 'cs_12345678' });
  wooRequest.mockResolvedValue([{ id: 7, sku: 'ABC-1', name: 'T-shirt', manage_stock: false, stock_quantity: null, stock_status: 'instock' }]);
  const answer = await answerWorkforceStockQuestion('tenant-a', 'Check stock for SKU: ABC-1');
  expect(answer).toMatchObject({ source: 'woocommerce', status: 'unavailable', code: 'INVENTORY_NOT_TRACKED' });
  expect(answer?.answer).toContain('WooCommerce does not track inventory');
});
it('rejects anonymous, cross-tenant and unprivileged requests before Shopify access', async () => {
  expect((await request(app).post('/tenants/tenant-a/workforce/ask').send({ question: 'SKU ABC stock?' })).status).toBe(401);
  expect((await request(app).post('/tenants/tenant-b/workforce/ask').set('Authorization', 'Bearer test').send({ question: 'SKU ABC stock?' })).status).toBe(403);
  expect((await request(app).post('/tenants/tenant-a/workforce/ask').set('Authorization', 'Bearer test').set('x-no-permission', 'yes').send({ question: 'SKU ABC stock?' })).status).toBe(403);
  expect(ShopifyTool.checkStock).not.toHaveBeenCalled();
});
