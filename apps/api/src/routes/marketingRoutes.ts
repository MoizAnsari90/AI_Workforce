import { Router, Response } from 'express';
import { z } from 'zod';
import { ApiResponse, StandardRoles } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission, requireRole } from '../middleware/rbacMiddleware';
import { prisma } from '../lib/prisma';
import { marketingService } from '../services/marketingService';

export const marketingRouter = Router();
marketingRouter.use('/tenants/:tenantId', authenticate, enforceTenantIsolation);

function send<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = { success: true, data, meta: { timestamp: new Date().toISOString() } };
  res.status(status).json(response);
}

const profileSchema = z.object({
  brandVoice: z.string().optional(),
  approvedClaims: z.array(z.string()).optional(),
  prohibitedClaims: z.array(z.string()).optional(),
  targetAudience: z.string().optional(),
  businessPolicies: z.record(z.string(), z.unknown()).optional(),
});
const campaignSchema = z.object({
  name: z.string().min(1),
  objective: z.string().min(1),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
});

marketingRouter.get('/tenants/:tenantId/marketing/profile', requirePermission('marketing:read'), async (req, res, next) => {
  try { send(res, await marketingService.getProfile(req.params.tenantId)); } catch (error) { next(error); }
});

marketingRouter.put('/tenants/:tenantId/marketing/profile', requirePermission('marketing:write'), async (req, res, next) => {
  try { send(res, await marketingService.updateProfile(req.params.tenantId, profileSchema.parse(req.body), req.user!.userId)); } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/campaigns', requirePermission('marketing:write'), async (req, res, next) => {
  try { send(res, await marketingService.createCampaign(req.params.tenantId, campaignSchema.parse(req.body), req.user!.userId), 201); } catch (error) { next(error); }
});

marketingRouter.get('/tenants/:tenantId/marketing/campaigns', requirePermission('marketing:read'), async (req, res, next) => {
  try { send(res, await marketingService.listCampaigns(req.params.tenantId)); } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/content-drafts', requirePermission('marketing:write'), async (req, res, next) => {
  try {
    const input = z.object({ campaignId: z.string().optional(), title: z.string().min(1), content: z.string().min(1), contentType: z.string().min(1), channel: z.string().min(1), scheduledAt: z.coerce.date().optional(), claims: z.array(z.string()).default([]) }).parse(req.body);
    send(res, await marketingService.createDraft(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

marketingRouter.get('/tenants/:tenantId/marketing/content-drafts', requirePermission('marketing:read'), async (req, res, next) => {
  try { send(res, await marketingService.listDrafts(req.params.tenantId, typeof req.query.status === 'string' ? req.query.status : undefined)); } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/content-drafts/:draftId/publish-request', requirePermission('marketing:write'), async (req, res, next) => {
  try {
    const input = z.object({ agentId: z.string() }).parse(req.body);
    send(res, await marketingService.requestPublish(req.params.tenantId, req.params.draftId, input.agentId, req.user!.userId), 201);
  } catch (error) { next(error); }
});

marketingRouter.get('/tenants/:tenantId/marketing/approval-requests', requirePermission('marketing:read'), async (req, res, next) => {
  try { send(res, await prisma.approvalRequest.findMany({ where: { tenantId: req.params.tenantId, actionType: 'marketing_publish' }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/approval-requests/:approvalId/review', requirePermission('marketing:write'), requireRole(StandardRoles.ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ decision: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }).parse(req.body);
    send(res, await marketingService.reviewPublish(req.params.tenantId, req.params.approvalId, req.user!.userId, input.decision, input.rejectionReason));
  } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/content-drafts/:draftId/publish', requirePermission('marketing:write'), async (req, res, next) => {
  try { send(res, await marketingService.publish(req.params.tenantId, req.params.draftId, req.user!.userId)); } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/campaigns/:campaignId/metrics', requirePermission('marketing:write'), async (req, res, next) => {
  try {
    const input = z.object({ contentDraftId: z.string().optional(), metricName: z.string().min(1), metricValue: z.number() }).parse(req.body);
    send(res, await marketingService.recordMetric(req.params.tenantId, { campaignId: req.params.campaignId, ...input }, req.user!.userId), 201);
  } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/tasks', requirePermission('marketing:write'), async (req, res, next) => {
  try {
    const input = z.object({ campaignId: z.string().optional(), title: z.string().min(1), description: z.string().optional(), scheduledAt: z.coerce.date().optional() }).parse(req.body);
    send(res, await marketingService.createTask(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

marketingRouter.post('/tenants/:tenantId/marketing/leads/:leadId/attribution', requirePermission('marketing:write'), async (req, res, next) => {
  try {
    const input = z.object({ campaignId: z.string(), attributionSource: z.string().min(1) }).parse(req.body);
    send(res, await marketingService.attributeLead(req.params.tenantId, req.params.leadId, input.campaignId, input.attributionSource, req.user!.userId));
  } catch (error) { next(error); }
});
