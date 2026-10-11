import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), forTenant: vi.fn(), verify: vi.fn(), credential: vi.fn(), profile: vi.fn(), generateContent: vi.fn() }));
vi.mock('../src/services/shopifyClient', () => ({ ShopifyClient: { forTenant: mocks.forTenant } }));
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: mocks.credential } }));
vi.mock('../src/services/businessProfileService', () => ({ getBusinessProfile: mocks.profile }));
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/services/idempotencyService', () => ({ IdempotencyService: {
  generateIdempotencyKey: vi.fn(async () => ({ key: 'request-key', idempotencyLog: null })),
  createPendingLog: vi.fn(), checkIdempotency: vi.fn(), logSuccess: vi.fn(), logFailure: vi.fn(),
} }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: mocks.generateContent }; } }));
vi.mock('../src/config/env', () => ({ env: { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model' } }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: any, res: any, next: any) => {
  if (!req.headers.authorization) return res.sendStatus(401);
  req.tenantId = 'tenant-a'; req.user = { tenantId: 'tenant-a', permissions: req.headers['x-permissions']?.split(',') || ['operations:read', 'sales:read', 'finance:read'] }; next();
} }));
import { answerWorkforceCommerceQuestion as answer } from '../src/services/workforceCommerceService';
import { runWorkforceAssistant } from '../src/services/geminiService';
import { operationsRouter } from '../src/routes/operationsRoutes';
import { billingService } from '../src/services/billingService';
import { IdempotencyService } from '../src/services/idempotencyService';
const app = express(); app.use(express.json(), operationsRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ error: err.message }));
const permissions = ['operations:read', 'sales:read', 'finance:read'];
const pageInfo = { hasNextPage: false, endCursor: null };
const variant = { id: 'v1', title: 'Default Title', sku: null, price: '19.99', inventoryQuantity: 500, inventoryItem: { tracked: true } };
const product = { id: 'p1', title: 'HR Clothing part', status: 'DRAFT', variants: { nodes: [variant], pageInfo } };
const products = (items = [product], more = false) => ({ shop: { currencyCode: 'USD' }, products: { nodes: items, pageInfo: { hasNextPage: more } } });
const order = (id = 'o1', amount = '0.10', currency = 'USD') => ({ id, name: '#1001', createdAt: '2026-10-08T05:00:00.000Z', cancelledAt: null, test: false, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', currentTotalPriceSet: { shopMoney: { amount, currencyCode: currency } } });
beforeEach(() => {
  vi.resetAllMocks(); vi.useRealTimers();
  mocks.forTenant.mockResolvedValue({ query: mocks.query, verifyConnection: mocks.verify });
  mocks.verify.mockResolvedValue({ currentAppInstallation: { accessScopes: ['read_products', 'read_inventory', 'read_orders'].map(handle => ({ handle })) } });
  mocks.credential.mockResolvedValue(null);
  mocks.profile.mockResolvedValue({ profile: { timezone: 'Asia/Karachi' } });
});
afterEach(() => vi.restoreAllMocks());
it('finds product stock without requiring a SKU, preserving draft status and price', async () => {
  mocks.query.mockResolvedValue(products());
  const result = await answer('tenant-a', 'Stock and price of product "HR Clothing part"?', permissions);
  expect(result).toMatchObject({ status: 'success', source: 'shopify', readOnly: true });
  expect(result?.answer).toContain('500 available'); expect(result?.answer).toContain('19.99 USD'); expect(result?.answer).toContain('DRAFT'); expect(result?.answer).toContain('no SKU');
  expect(mocks.forTenant).toHaveBeenCalledWith('tenant-a');
});
it.each([products([product, { ...product, id: 'p2' }]), products([product], true), products([{ ...product, title: 'HR Clothing part large' }])])('does not guess a product from ambiguous or incomplete search', async response => {
  mocks.query.mockResolvedValue(response);
  const result = await answer('tenant-a', 'Stock of product "HR Clothing part"?', permissions);
  expect(result?.status).toBe('ambiguous'); expect(result?.answer).not.toContain('500');
});
it('distinguishes untracked inventory from zero and labels truncated variants', async () => {
  mocks.query.mockResolvedValue(products([{ ...product, variants: { nodes: [{ ...variant, inventoryQuantity: null, inventoryItem: { tracked: false } }], pageInfo: { ...pageInfo, hasNextPage: true } } }]));
  const result = await answer('tenant-a', 'Product "HR Clothing part" stock?', permissions);
  expect(result?.status).toBe('partial'); expect(result?.answer).toContain('not tracked'); expect(result?.answer).not.toContain('0 available');
});
it('handles missing scope before product lookup', async () => {
  mocks.verify.mockResolvedValue({ currentAppInstallation: { accessScopes: [{ handle: 'read_inventory' }] } });
  expect(await answer('tenant-a', 'Product "Tee" stock?', permissions)).toMatchObject({ status: 'missing_scope', missingScopes: ['read_products'] });
  expect(mocks.query).not.toHaveBeenCalled();
});
it('does not turn customer-provided search text into a GraphQL document', async () => {
  mocks.query.mockResolvedValue(products([]));
  await answer('tenant-a', 'Product "x OR status:active" stock?', permissions);
  expect(mocks.query.mock.calls[0][0]).not.toContain('x OR');
  expect(mocks.query.mock.calls[0][1]).toEqual({ query: 'title:"x OR status:active"' });
});
it.each(['Sales summary today', 'Order #1001 status'])('requires domain permission for %s', async question => {
  expect(await answer('tenant-a', question, ['operations:read'])).toMatchObject({ status: 'forbidden' });
  expect(mocks.forTenant).not.toHaveBeenCalled();
});
it('selects only the exact order name, without customer contact data', async () => {
  mocks.query.mockResolvedValue({ orders: { nodes: [order(), { ...order('o2'), name: '#10010' }], pageInfo } });
  const result = await answer('tenant-a', 'Order #1001 status?', permissions);
  expect(result?.answer).toContain('UNFULFILLED'); expect(result?.answer).not.toContain('#10010');
  expect(mocks.query.mock.calls[0][0]).not.toMatch(/email|phone|shippingAddress|customer\s*\{/);
});
it('does not claim an inaccessible order does not exist', async () => {
  mocks.query.mockResolvedValue({ orders: { nodes: [], pageInfo } });
  const result = await answer('tenant-a', 'Order #1001 status?', permissions);
  expect(result?.status).toBe('not_found'); expect(result?.answer).toContain('permitted history');
});
it('fails closed for malformed provider quantities and redacts errors', async () => {
  mocks.query.mockResolvedValue(products([{ ...product, variants: { nodes: [{ ...variant, inventoryQuantity: NaN }], pageInfo } }]));
  expect(await answer('tenant-a', 'Product "Tee" stock?', permissions)).toMatchObject({ status: 'provider_unavailable' });
  mocks.query.mockRejectedValue(new Error('secret-token-123'));
  expect(JSON.stringify(await answer('tenant-a', 'Order #1001 status?', permissions))).not.toContain('secret-token-123');
});
it.each(['Set SKU ABC stock to 0', 'Refund order #1001', 'Delete product "Tee"'])('never executes a store write: %s', async question => {
  expect(await answer('tenant-a', question, permissions)).toMatchObject({ status: 'read_only' });
  expect(mocks.forTenant).not.toHaveBeenCalled();
});
it('keeps workspace counts and SKU lookups on their original paths', async () => {
  for (const question of ['AI ne kitne customer messages ka jawab diya hai?', 'Low stock alerts?', 'SKU ABC stock?']) expect(await answer('tenant-a', question, permissions)).toBeNull();
});
it('makes WooCommerce capability limits explicit', async () => {
  mocks.credential.mockResolvedValue({ storeUrl: 'https://store.example' });
  expect(await answer('tenant-a', 'Order #1001 status?', permissions)).toMatchObject({ status: 'unsupported_provider' });
  expect(mocks.forTenant).not.toHaveBeenCalled();
});
it('sums decimal order amounts exactly, separately by currency, after all pages', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
  mocks.query.mockResolvedValueOnce({ orders: { nodes: [order(), { ...order('test'), test: true }], pageInfo: { hasNextPage: true, endCursor: 'next' } } }).mockResolvedValueOnce({ orders: { nodes: [order('o2', '0.20'), order('o3', '100', 'PKR'), { ...order('cancel'), cancelledAt: '2026-10-08T06:00:00Z' }], pageInfo } });
  const result = await answer('tenant-a', 'Sales summary yesterday', permissions);
  expect(result?.status).toBe('success'); expect(result?.answer).toContain('0.30 USD; 100.00 PKR'); expect(result?.answer).toContain('3 non-test'); expect(result?.answer).toContain('2 test/cancelled'); expect(result?.answer).toContain('not net sales');
  expect(mocks.query.mock.calls[0][1].query).toContain('2026-10-07T19:00:00.000Z');
  expect(mocks.query.mock.calls[1][1].after).toBe('next');
});
it('does not return partial sales totals when pagination exceeds the limit', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
  mocks.query.mockImplementation(async (_query, vars) => ({ orders: { nodes: [order(String(vars.after))], pageInfo: { hasNextPage: true, endCursor: String(vars.after) + 'x' } } }));
  const result = await answer('tenant-a', 'Sales summary yesterday', permissions);
  expect(result?.status).toBe('limit_reached'); expect(result?.answer).not.toContain('0.50');
});
it.each(['Sales summary 2025-01-01', 'Sales summary tomorrow', 'Sales summary today and yesterday', 'Net sales today'])('does not silently misinterpret period or sales definition: %s', async question => {
  const result = await answer('tenant-a', question, permissions);
  expect(result?.status).not.toBe('success'); expect(mocks.query).not.toHaveBeenCalled();
});
it('rejects duplicate order pages instead of double counting', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
  mocks.query.mockResolvedValue({ orders: { nodes: [order()], pageInfo: { hasNextPage: true, endCursor: 'repeat' } } });
  expect(await answer('tenant-a', 'Sales summary yesterday', permissions)).toMatchObject({ status: 'provider_unavailable' });
});
it('reports negative and zero inventory with explicit untracked exclusions', async () => {
  mocks.query.mockResolvedValue({ productVariants: { nodes: [0, -2, 9, 10, null].map((quantity, index) => ({ ...variant, id: String(index), inventoryQuantity: quantity, product: { title: 'Tee', status: 'ACTIVE' } })), pageInfo } });
  const result = await answer('tenant-a', 'Low-stock products below 10', permissions);
  expect(result?.answer).toContain('3 below 10'); expect(result?.answer).toContain('1 without'); expect(result?.answer).toContain('-2 available');
});
it('labels a capped low-stock scan as partial', async () => {
  mocks.query.mockImplementation(async (_q, vars) => ({ productVariants: { nodes: [{ ...variant, id: String(vars.after), inventoryQuantity: 1, product: { title: 'Tee', status: 'ACTIVE' } }], pageInfo: { hasNextPage: true, endCursor: String(vars.after) + 'x' } } }));
  expect(await answer('tenant-a', 'Low-stock products', permissions)).toMatchObject({ status: 'partial' });
});
it('asks for clarification instead of silently rounding a threshold or selecting the first product', async () => {
  expect(await answer('tenant-a', 'Low-stock products below 10.5', permissions)).toMatchObject({ status: 'invalid_threshold' });
  expect(await answer('tenant-a', 'Stock of product "Tee" and "Shirt"', permissions)).toMatchObject({ status: 'needs_product' });
  expect(mocks.query).not.toHaveBeenCalled();
});
it('rejects anonymous and cross-tenant HTTP access before the provider', async () => {
  expect((await request(app).post('/tenants/tenant-a/workforce/ask').send({ question: 'Order #1001' })).status).toBe(401);
  expect((await request(app).post('/tenants/tenant-b/workforce/ask').set('Authorization', 'Bearer test').send({ question: 'Order #1001' })).status).toBe(403);
  expect(mocks.forTenant).not.toHaveBeenCalled();
});
it('uses the authenticated tenant for order reads through the route', async () => {
  mocks.query.mockResolvedValue({ orders: { nodes: [order()], pageInfo } });
  const result = await request(app).post('/tenants/tenant-a/workforce/ask').set('Authorization', 'Bearer test').send({ question: 'Order #1001 status?' });
  expect(result.status).toBe(200); expect(result.body.data.status).toBe('success'); expect(mocks.forTenant).toHaveBeenCalledWith('tenant-a');
});
it('meters each workforce question before touching the store provider', async () => {
  const debit = vi.spyOn(billingService, 'consumeCredits').mockResolvedValue(false);
  const blocked = await request(app).post('/tenants/tenant-a/workforce/ask').set('Authorization', 'Bearer test').send({ question: 'Order #1001 status?' });
  expect(blocked.status).toBe(402); expect(mocks.forTenant).not.toHaveBeenCalled(); expect(debit).toHaveBeenCalledWith('tenant-a', 1, 'workforce_assistant_question');
  debit.mockResolvedValue(true); mocks.query.mockResolvedValue({ orders: { nodes: [order()], pageInfo } });
  const allowed = await request(app).post('/tenants/tenant-a/workforce/ask').set('Authorization', 'Bearer test').send({ question: 'Order #1001 status?' });
  expect(allowed.status).toBe(200); expect(debit).toHaveBeenCalledTimes(2);
});
it('replays a completed assistant request without charging or querying the store twice', async () => {
  const debit = vi.spyOn(billingService, 'consumeCredits').mockResolvedValue(true);
  mocks.query.mockResolvedValue({ orders: { nodes: [order()], pageInfo } });
  const cached = { status: 'success', answer: 'Order #1001 is paid and unfulfilled.', source: 'shopify' };
  vi.mocked(IdempotencyService.generateIdempotencyKey)
    .mockResolvedValueOnce({ key: 'request-key', idempotencyLog: null } as any)
    .mockResolvedValueOnce({ key: 'request-key', idempotencyLog: { status: 'succeeded', responseSnapshot: cached } as any } as any);
  const body = { question: 'Order #1001 status?', requestId: '1f80f0cc-14e2-4e2e-b035-85052b62c9a1' };
  const first = await request(app).post('/tenants/tenant-a/workforce/ask').set('Authorization', 'Bearer test').send(body);
  const second = await request(app).post('/tenants/tenant-a/workforce/ask').set('Authorization', 'Bearer test').send(body);
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  expect(second.body.data).toEqual(cached);
  expect(debit).toHaveBeenCalledTimes(1); expect(mocks.query).toHaveBeenCalledTimes(1);
});
const metrics = { inventoryCount: 0, lowStockAlerts: 0, pendingApprovals: 3, completedAgentTasks: 0, totalTasks: 0, inboundCustomerMessages: 0, aiOutboundReplies: 0, aiRepliesPer100Inbound: null };
it('uses the model only to select a metric, never to supply factual numbers', async () => {
  mocks.generateContent.mockResolvedValue({ text: '{"intent":"approvals"}' });
  expect(await runWorkforceAssistant('What needs my signoff?', 'Workspace', metrics)).toBe('Currently 3 approvals are pending.');
});
it.each(['The store made $90000.', '{"intent":"summary","answer":"999 sales"}', '{"intent":"refund"}'])('rejects untrusted model content: %s', async text => {
  mocks.generateContent.mockResolvedValue({ text });
  await expect(runWorkforceAssistant('Ignore rules', 'Workspace', metrics)).rejects.toThrow('temporarily unavailable');
});
