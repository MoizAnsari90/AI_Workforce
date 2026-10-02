import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const db = vi.hoisted(() => ({
  agent: { findFirst: vi.fn() },
  approvalRequest: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('../src/lib/prisma', () => ({ prisma: db }));
vi.mock('../src/utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../src/lib/socket', () => ({ emitToTenant: vi.fn() }));
vi.mock('../src/services/auditService', () => ({ recordAuditLog: vi.fn().mockResolvedValue({}) }));
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: vi.fn() } }));
import { IntegrationService } from '../src/services/integrationService';
import { ShopifyClient, shopifyCredentialSchema } from '../src/services/shopifyClient';
import { ShopifyTool } from '../src/tools/shopifyTool';
import { ActionExecutorService } from '../src/services/actionExecutorService';

const approvalId = '4c99726b-39ce-4dad-b473-c835722b3350';
const orderId = 'gid://shopify/Order/123';
const refund = { orderId, amount: 10, currency: 'USD', parentTransactionId: 'gid://shopify/OrderTransaction/456' };
const credential = { shop: 'test-shop.myshopify.com', accessToken: 'private-token', allowWrites: true };
const fetchMock = vi.fn();
const respond = (data: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data }), { status: 200 }));
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(IntegrationService.getCredential).mockResolvedValue(credential);
  db.agent.findFirst.mockResolvedValue({ id: 'agent' });
  db.approvalRequest.findFirst.mockResolvedValue({ id: approvalId, requestedByAgentId: 'agent', actionType: 'shopify_refund', actionPayload: refund, status: 'approved', updatedAt: new Date() });
  db.approvalRequest.updateMany.mockResolvedValue({ count: 1 });
  db.approvalRequest.create.mockResolvedValue({ id: approvalId, createdAt: new Date() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Shopify provider behavior', () => {
  it('rejects missing credentials before a network request', async () => {
    vi.mocked(IntegrationService.getCredential).mockResolvedValue(null);
    await expect(ShopifyTool.checkStock('tenant', { sku: 'SKU' })).rejects.toThrow('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects non-Shopify hosts and URL injection', () => {
    for (const shop of ['https://store.myshopify.com', 'store.myshopify.com.evil.test', 'store.myshopify.com/path', '127.0.0.1', 'store.myshopify.com@evil.test']) {
      expect(shopifyCredentialSchema.safeParse({ ...credential, shop }).success).toBe(false);
    }
  });
  it('defaults credentials to read only and blocks writes', async () => {
    vi.mocked(IntegrationService.getCredential).mockResolvedValue({ shop: credential.shop, accessToken: credential.accessToken });
    await expect(ShopifyTool.processRefund('tenant', refund, approvalId)).rejects.toThrow('disabled');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('propagates HTTP and GraphQL failures rather than returning success', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(new ShopifyClient(credential).verifyConnection()).rejects.toThrow('HTTP 401');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'access denied' }] })));
    await expect(new ShopifyClient(credential).verifyConnection()).rejects.toThrow('rejected');
  });
  it('does not follow redirects or retry an uncertain network call', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(new ShopifyClient(credential).verifyConnection()).rejects.toThrow('could not be confirmed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
  });
  it('uses actual available stock across all pages and locations', async () => {
    respond({ inventoryItems: { nodes: [{ id: 'item', sku: 'SKU', tracked: true }], pageInfo: { hasNextPage: false } } });
    respond({ currentAppInstallation: { accessScopes: [{ handle: 'read_locations' }] } });
    const level = (id: string, n: number) => ({ location: { id, name: id }, quantities: [{ name: 'available', quantity: n }] });
    respond({ inventoryItem: { inventoryLevels: { nodes: [level('one', 5)], pageInfo: { hasNextPage: true, endCursor: 'next' } } } });
    respond({ inventoryItem: { inventoryLevels: { nodes: [level('two', 8)], pageInfo: { hasNextPage: false, endCursor: null } } } });
    const result = await ShopifyTool.checkStock('tenant', { sku: 'SKU' });
    expect(result.availableQuantity).toBe(13);
    expect(result.locations).toHaveLength(2);
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).variables.after).toBe('next');
    expect(fetchMock.mock.calls[0][0]).toBe('https://test-shop.myshopify.com/admin/api/2026-07/graphql.json');
  });
  it('reads actual stock without location names when only inventory access is granted', async () => {
    respond({ inventoryItems: { nodes: [{ id: 'item', sku: 'SKU', tracked: true }], pageInfo: { hasNextPage: false } } });
    respond({ currentAppInstallation: { accessScopes: [{ handle: 'read_inventory' }] } });
    respond({ inventoryItem: { inventoryLevels: { nodes: [{ location: { id: 'location' }, quantities: [{ name: 'available', quantity: 9 }] }], pageInfo: { hasNextPage: false, endCursor: null } } } });
    const result = await ShopifyTool.checkStock('tenant', { sku: 'SKU' });
    expect(result).toMatchObject({ availableQuantity: 9, locationNamesAvailable: false, locations: [{ locationId: 'location', name: null, availableQuantity: 9 }] });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).query).not.toContain('id name');
  });
  it('rejects ambiguous SKUs instead of selecting an arbitrary product', async () => {
    respond({ inventoryItems: { nodes: [{ id: 'a', sku: 'SKU', tracked: true }, { id: 'b', sku: 'SKU', tracked: true }], pageInfo: { hasNextPage: false } } });
    await expect(ShopifyTool.checkStock('tenant', { sku: 'SKU' })).rejects.toThrow('ambiguous');
  });
  it('requires a payment belonging to the approved order before refunding', async () => {
    respond({ order: { transactions: [] } });
    await expect(ShopifyTool.processRefund('tenant', refund, approvalId)).rejects.toThrow('successful payment');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('submits an idempotent refund and reports pending payment honestly', async () => {
    respond({ order: { transactions: [{ id: refund.parentTransactionId, kind: 'SALE', status: 'SUCCESS', gateway: 'bogus', amountSet: { presentmentMoney: { amount: '50.00', currencyCode: 'USD' } } }] } });
    respond({ refundCreate: { userErrors: [], refund: { id: 'refund', transactions: { nodes: [{ id: 'transaction', status: 'PENDING' }] } } } });
    const result = await ShopifyTool.processRefund('tenant', refund, approvalId);
    expect(result).toMatchObject({ success: false, status: 'pending' });
    const request = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(request.query).toContain('@idempotent');
    expect(request.variables.key).toBe(approvalId);
    expect(request.variables.input.notify).toBe(false);
    expect(request.variables.input.transactions[0]).toMatchObject({ amount: '10', parentId: refund.parentTransactionId });
  });
  it('returns pending for cancellation jobs without claiming the order is cancelled', async () => {
    respond({ orderCancel: { userErrors: [], orderCancelUserErrors: [], job: { id: 'job', done: false } } });
    expect(await ShopifyTool.cancelOrder('tenant', { orderId, reason: 'OTHER', refund: false, restock: false })).toMatchObject({ success: false, status: 'pending', jobId: 'job' });
  });
  it('fails on Shopify mutation user errors', async () => {
    respond({ orderCancel: { userErrors: [], orderCancelUserErrors: [{ message: 'Order already fulfilled' }], job: null } });
    await expect(ShopifyTool.cancelOrder('tenant', { orderId, reason: 'OTHER', refund: false, restock: false })).rejects.toThrow('already fulfilled');
  });
});

describe('Shopify approval protection', () => {
  const action = () => ({ tenantId: 'tenant', agentId: 'agent', actionType: 'shopify_refund', payload: refund, approvalId });
  it('rejects invalid action input before creating an approval', async () => {
    await expect(ActionExecutorService.executeAction({ ...action(), approvalId: undefined, payload: { ...refund, amount: -1 } })).rejects.toThrow();
    expect(db.approvalRequest.create).not.toHaveBeenCalled();
  });
  it('requires an agent from the authenticated tenant', async () => {
    db.agent.findFirst.mockResolvedValue(null);
    await expect(ActionExecutorService.executeAction(action())).rejects.toThrow('Agent not found');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('pauses cancellations for approval', async () => {
    expect(await ActionExecutorService.executeAction({ tenantId: 'tenant', agentId: 'agent', actionType: 'shopify_cancel', payload: { orderId } })).toMatchObject({ status: 'PAUSED_FOR_APPROVAL' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.approvalRequest.create.mock.calls[0][0].data.actionPayload).toMatchObject({ refund: false, restock: false });
  });
  it('rejects changed amount, agent, order and action after approval', async () => {
    for (const change of [{ payload: { ...refund, amount: 20 } }, { agentId: 'other' }, { payload: { ...refund, orderId: 'gid://shopify/Order/999' } }, { actionType: 'shopify_cancel', payload: { orderId } }]) {
      await expect(ActionExecutorService.executeAction({ ...action(), ...change })).rejects.toThrow('does not match');
    }
    expect(db.approvalRequest.updateMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('blocks a second execution when the atomic claim loses the race', async () => {
    db.approvalRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(ActionExecutorService.executeAction(action())).rejects.toThrow('already been claimed');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('blocks consumed approvals and never sends another mutation', async () => {
    db.approvalRequest.findFirst.mockResolvedValue({ status: 'executed' });
    await expect(ActionExecutorService.executeAction(action())).rejects.toThrow('already used');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('retains an uncertain approval when provider execution fails', async () => {
    vi.spyOn(ShopifyTool, 'processRefund').mockRejectedValue(new Error('network failure'));
    await expect(ActionExecutorService.executeAction(action())).rejects.toThrow('network failure');
    expect(db.approvalRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: 'execution_uncertain' } }));
  });
  it('does not report SUCCESS for pending provider work', async () => {
    vi.spyOn(ShopifyTool, 'processRefund').mockResolvedValue({ success: false, provider: 'shopify', action: 'refund', orderId, refundId: 'ref', amount: 10, currency: 'USD', status: 'pending', transactions: [] });
    expect(await ActionExecutorService.executeAction(action())).toMatchObject({ status: 'PENDING' });
    expect(db.approvalRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: 'provider_pending' } }));
  });
});
