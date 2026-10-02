import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { ShopifyClient, shopifyCredentialSchema } from '../services/shopifyClient';
import { IntegrationService } from '../services/integrationService';
import { ShopifyTool, shopifyStockSchema } from '../tools/shopifyTool';
import { ActionExecutorService } from '../services/actionExecutorService';
import { ApprovalService } from '../services/approvalService';
import { prisma } from '../lib/prisma';

export const shopifyRouter = Router({ mergeParams: true });
shopifyRouter.use(authenticate, enforceTenantIsolation, requireRole('admin'));
shopifyRouter.put('/connection', async (req, res, next) => {
  try {
    const config = shopifyCredentialSchema.parse(req.body);
    const connection = await new ShopifyClient(config).verifyConnection();
    const scopes = connection.currentAppInstallation.accessScopes.map(s => s.handle);
    if (!scopes.some(s => ['read_inventory', 'write_inventory'].includes(s))) throw new Error('Shopify app requires inventory access');
    if (config.allowWrites && !scopes.includes('write_orders')) throw new Error('Shopify app requires write_orders for write actions');
    await IntegrationService.storeCredential({ tenantId: req.tenantId!, provider: 'shopify', config, userId: req.user!.userId });
    res.json({ success: true, data: { ...connection, allowWrites: config.allowWrites } });
  } catch (error) { next(error); }
});
shopifyRouter.get('/connection', async (req, res, next) => {
  try {
    const stored = await IntegrationService.getCredential(req.tenantId!, 'shopify');
    if (!stored) return res.json({ success: true, data: { connected: false } });
    const client = await ShopifyClient.forTenant(req.tenantId!);
    const connection = await client.verifyConnection();
    res.json({ success: true, data: {
      connected: true, shop: connection.shop.myshopifyDomain, name: connection.shop.name,
      scopes: connection.currentAppInstallation.accessScopes.map(s => s.handle),
      allowWrites: stored.allowWrites === true,
    } });
  } catch (error) { next(error); }
});
shopifyRouter.delete('/connection', async (req, res, next) => {
  try {
    const deleted = await IntegrationService.deleteCredential(req.tenantId!, 'shopify', req.user!.userId);
    res.json({ success: true, data: { disconnected: deleted } });
  } catch (error) { next(error); }
});
shopifyRouter.put('/connection/writes', async (req, res, next) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    const stored = await IntegrationService.getCredential(req.tenantId!, 'shopify');
    if (!stored) return res.status(404).json({ success: false, error: 'Shopify is not connected' });
    if (enabled) {
      const connection = await (await ShopifyClient.forTenant(req.tenantId!)).verifyConnection();
      if (!connection.currentAppInstallation.accessScopes.some(scope => scope.handle === 'write_orders')) {
        return res.status(400).json({ success: false, error: 'Reconnect Shopify and grant write_orders before enabling AI write actions' });
      }
    }
    await IntegrationService.storeCredential({ tenantId: req.tenantId!, provider: 'shopify', config: { ...stored, allowWrites: enabled }, userId: req.user!.userId });
    res.json({ success: true, data: { allowWrites: enabled } });
  } catch (error) { next(error); }
});
shopifyRouter.get('/stock', async (req, res, next) => {
  try { res.json({ success: true, data: await ShopifyTool.checkStock(req.tenantId!, shopifyStockSchema.parse(req.query)) }); }
  catch (error) { next(error); }
});
shopifyRouter.get('/approvals', async (req, res, next) => {
  try {
    res.json({ success: true, data: await prisma.approvalRequest.findMany({
      where: { tenantId: req.tenantId!, actionType: { in: ['shopify_refund', 'shopify_cancel'] } },
      orderBy: { createdAt: 'desc' }, take: 100,
    }) });
  } catch (error) { next(error); }
});
shopifyRouter.post('/approvals/:approvalId/review', async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(['approved', 'rejected']), rejectionReason: z.string().max(500).optional() }).strict().parse(req.body);
    const approval = await prisma.approvalRequest.findFirst({ where: {
      id: req.params.approvalId, tenantId: req.tenantId!, actionType: { in: ['shopify_refund', 'shopify_cancel'] },
    } });
    if (!approval) return res.status(404).json({ success: false, error: 'Shopify approval not found' });
    res.json({ success: true, data: await ApprovalService.reviewApprovalRequest({
      ...input, approvalId: approval.id, tenantId: req.tenantId!, userId: req.user!.userId,
    }) });
  } catch (error) { next(error); }
});
shopifyRouter.post('/actions', async (req, res, next) => {
  try {
    const input = z.object({ agentId: z.string().uuid(), actionType: z.enum(['shopify_refund', 'shopify_cancel', 'shopify_stock_check']),
      payload: z.record(z.string(), z.unknown()), approvalId: z.string().uuid().optional() }).strict().parse(req.body);
    const data = await ActionExecutorService.executeAction({ ...input, tenantId: req.tenantId! });
    res.status(data.status === 'SUCCESS' ? 200 : 202).json({ success: data.status === 'SUCCESS', data });
  } catch (error) { next(error); }
});
