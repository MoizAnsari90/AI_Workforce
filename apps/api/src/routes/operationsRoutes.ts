import { Router, Response } from 'express';
import { z } from 'zod';
import { ApiResponse, StandardRoles } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission, requireRole } from '../middleware/rbacMiddleware';
import { prisma } from '../lib/prisma';
import { operationsService } from '../services/operationsService';
import { runWorkforceAssistant } from '../services/geminiService';
import { answerWorkforceStockQuestion } from '../services/workforceStockService';
import { answerVerifiedMetrics } from '../services/workforceMetricsService';
import { parseWorkforcePeriod, requestsSpecificPeriod } from '../services/workforcePeriod';
import { AppError, NotFoundError } from '../errors/AppError';
import { billingService } from '../services/billingService';
import { getBusinessProfile } from '../services/businessProfileService';
import { answerMerchantQuestion } from '../services/merchantQuestionService';
import { IdempotencyService } from '../services/idempotencyService';
import { Prisma } from '@prisma/client';
import crypto from 'node:crypto';

export const operationsRouter = Router();
operationsRouter.use('/tenants/:tenantId', authenticate, enforceTenantIsolation);

function send<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = { success: true, data, meta: { timestamp: new Date().toISOString() } };
  res.status(status).json(response);
}

operationsRouter.get('/tenants/:tenantId/operations/dashboard', requirePermission('operations:read'), async (req, res, next) => {
  try {
    const tenantId = req.params.tenantId;
    const [
      inventoryCount,
      lowStockAlerts,
      pendingApprovals,
      completedTasks,
      aiReplies,
      inboundMessages,
      agents,
      businessProfile,
      recentActivity,
      recentPo
    ] = await Promise.all([
      prisma.inventoryRecord.count({ where: { tenantId } }),
      prisma.stockAlert.count({ where: { tenantId, status: 'open' } }),
      prisma.approvalRequest.count({ where: { tenantId, status: 'pending' } }),
      prisma.task.count({ where: { tenantId, status: 'completed', agentId: { not: null } } }),
      prisma.message.count({ where: { tenantId, direction: 'outbound', senderType: 'ai' } }),
      prisma.message.count({ where: { tenantId, direction: 'inbound', senderType: 'customer' } }),
      prisma.agent.findMany({
        where: { tenantId }, orderBy: { createdAt: 'asc' },
        select: {
          id: true, name: true, department: true, isActive: true, createdAt: true,
          _count: { select: { tasks: true } },
          tasks: { where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: 1, select: { title: true, status: true, createdAt: true } },
        },
      }),
      prisma.businessProfile.findUnique({ where: { tenantId }, select: { profile: true, updatedAt: true } }),
      prisma.auditLog.findMany({ where: { tenantId }, take: 5, orderBy: { createdAt: 'desc' } }),
      prisma.purchaseOrder.findMany({ where: { tenantId }, take: 5, orderBy: { createdAt: 'desc' } })
    ]);

    send(res, {
      inventoryCount,
      lowStockAlerts,
      pendingApprovals,
      tasksCompleted: completedTasks,
      aiRepliesPer100Inbound: inboundMessages === 0 ? null : Math.round(aiReplies / inboundMessages * 100),
      agents,
      businessProfile: businessProfile ? { profile: businessProfile.profile, updatedAt: businessProfile.updatedAt.toISOString() } : null,
      checkedAt: new Date().toISOString(),
      recentActivity,
      recentPo,
    });
  } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/workforce/ask', requirePermission('operations:read'), async (req, res, next) => {
  let idempotencyKey: string | undefined;
  let claimed = false;
  try {
    const { question, requestId } = z.object({ question: z.string().trim().min(1).max(2000), requestId: z.string().uuid().optional() }).parse(req.body);
    const tenantId = req.params.tenantId;
    const targetResource = `assistant:${requestId || crypto.randomUUID()}`;
    const generated = await IdempotencyService.generateIdempotencyKey({ tenantId, actionType: 'workforce_ask', targetResource, requestData: question });
    idempotencyKey = generated.key;
    let previous = generated.idempotencyLog;
    if (previous) {
      if (previous.status === 'succeeded' && previous.responseSnapshot) {
        return res.status(200).json({ success: true, data: previous.responseSnapshot, meta: { timestamp: new Date().toISOString() } });
      }
      throw new AppError('This question request is already being processed or failed. Send it again as a new question to start another attempt.', 409, 'REQUEST_ALREADY_PROCESSED');
    }
    try {
      await IdempotencyService.createPendingLog(idempotencyKey, tenantId, 'workforce_ask', targetResource);
      claimed = true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      previous = await IdempotencyService.checkIdempotency(idempotencyKey);
      if (previous?.status === 'succeeded' && previous.responseSnapshot) {
        return res.status(200).json({ success: true, data: previous.responseSnapshot, meta: { timestamp: new Date().toISOString() } });
      }
      throw new AppError('This question request is already being processed. Please wait and refresh the assistant.', 409, 'REQUEST_IN_PROGRESS');
    }
    const sendIdempotent = async (data: unknown) => {
      await IdempotencyService.logSuccess(idempotencyKey!, targetResource, data as Prisma.InputJsonValue);
      claimed = false;
      return send(res, data);
    };
    if (!await billingService.consumeCredits(req.tenantId!, 1, 'workforce_assistant_question')) throw new AppError('Your included workflow credits are used up. Manage your plan in Billing to continue.', 402, 'INSUFFICIENT_CREDITS');
    const commerceAnswer = await answerMerchantQuestion(req.tenantId!, question, req.user?.permissions || []);
    if (commerceAnswer) return await sendIdempotent(commerceAnswer);
    const stockAnswer = await answerWorkforceStockQuestion(req.tenantId!, question);
    if (stockAnswer) return await sendIdempotent(stockAnswer);
    const teamRequested = /\b(bundle|agents?|team|workforce)\b/i.test(question) && /\b(what|which|who|how|doing|work|status|summary|tell|show|describe|kia|kon|kaam|batao|kya)\b/i.test(question);
    const [tenant, inventoryCount, lowStockAlerts, pendingApprovals, completedTasks, totalTasks, inboundMessages, aiReplies, agents, businessProfile] = await Promise.all([
      prisma.tenant.findFirst({ where: { id: tenantId }, select: { name: true } }),
      prisma.inventoryRecord.count({ where: { tenantId } }),
      prisma.stockAlert.count({ where: { tenantId, status: 'open' } }),
      prisma.approvalRequest.count({ where: { tenantId, status: 'pending' } }),
      prisma.task.count({ where: { tenantId, status: 'completed', agentId: { not: null } } }),
      prisma.task.count({ where: { tenantId } }),
      prisma.message.count({ where: { tenantId, direction: 'inbound', senderType: 'customer' } }),
      prisma.message.count({ where: { tenantId, direction: 'outbound', senderType: 'ai' } }),
      teamRequested ? prisma.agent.findMany({
        where: { tenantId }, orderBy: { createdAt: 'asc' },
        select: {
          name: true, department: true, isActive: true, _count: { select: { tasks: true } },
          tasks: { where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: 1, select: { title: true, status: true } },
        },
      }) : Promise.resolve([]),
      teamRequested ? prisma.businessProfile.findUnique({ where: { tenantId }, select: { profile: true } }) : Promise.resolve(null),
    ]);
    if (!tenant) throw new NotFoundError('Workspace was not found');

    const bundleProfile = z.object({ industry: z.enum(['ecommerce', 'real_estate', 'healthcare']) }).passthrough().safeParse(businessProfile?.profile);
    if (teamRequested) {
      const bundleNames = { ecommerce: 'E-commerce', real_estate: 'Real estate', healthcare: 'Clinic / healthcare' };
      const bundleWork: Record<string, string> = {
        ecommerce: 'store operations, product and inventory questions, order workflows, and customer support when the required store and messaging connections are active',
        real_estate: 'property enquiries, lead qualification, and viewing coordination configured for this workspace',
        healthcare: 'clinic reception, patient enquiries, and appointment coordination; it does not provide medical diagnosis or treatment advice',
      };
      const profileIndustry = bundleProfile.success ? bundleProfile.data.industry : null;
      const team = agents.length ? agents.map(agent => {
        const latest = agent.tasks[0];
        return `${agent.name} (${agent.department}; ${agent.isActive ? 'active' : 'paused'}; ${agent._count.tasks} recorded tasks${latest ? `; latest: “${latest.title}” — ${latest.status}` : '; no tasks recorded yet'})`;
      }).join('; ') : 'No agents are deployed yet';
      const answer = `${profileIndustry ? `Your selected bundle is ${bundleNames[profileIndustry]}. It is set up for ${bundleWork[profileIndustry]}.` : 'A business bundle has not been saved in Business setup yet.'} Your workspace has ${agents.length} agent${agents.length === 1 ? '' : 's'}: ${team}. This snapshot comes from current workspace records, checked at ${new Date().toISOString()}.`;
      return await sendIdempotent({ answer, source: 'database', readOnly: true, checkedAt: new Date().toISOString() });
    }

    const replyCoverage = inboundMessages === 0 ? null : Math.round(aiReplies / inboundMessages * 100);
    const metrics = {
      inventoryCount,
      lowStockAlerts,
      pendingApprovals,
      completedAgentTasks: completedTasks,
      totalTasks,
      inboundCustomerMessages: inboundMessages,
      aiOutboundReplies: aiReplies,
      aiRepliesPer100Inbound: replyCoverage,
    };
    const profile = requestsSpecificPeriod(question) ? (await getBusinessProfile(tenantId)).profile : null;
    const period = requestsSpecificPeriod(question) ? parseWorkforcePeriod(question, new Date(), profile?.timezone || 'Asia/Karachi') : null;
    if (period) {
      const dateRange = { gte: period.start, lt: period.end };
      const [periodInbound, periodReplies, periodTasks, periodCompletedTasks, periodApprovals, periodAlerts] = await Promise.all([
        prisma.message.count({ where: { tenantId, direction: 'inbound', senderType: 'customer', createdAt: dateRange } }),
        prisma.message.count({ where: { tenantId, direction: 'outbound', senderType: 'ai', createdAt: dateRange } }),
        prisma.task.count({ where: { tenantId, createdAt: dateRange } }),
        prisma.task.count({ where: { tenantId, status: 'completed', agentId: { not: null }, completedAt: dateRange } }),
        prisma.approvalRequest.count({ where: { tenantId, status: 'pending', createdAt: dateRange } }),
        prisma.stockAlert.count({ where: { tenantId, status: 'open', createdAt: dateRange } }),
      ]);
      Object.assign(metrics, { inboundCustomerMessages: periodInbound, aiOutboundReplies: periodReplies, totalTasks: periodTasks, completedAgentTasks: periodCompletedTasks, pendingApprovals: periodApprovals, lowStockAlerts: periodAlerts });
    }
    const verifiedAnswer = answerVerifiedMetrics(question, metrics, period);
    if (verifiedAnswer) return await sendIdempotent({ answer: verifiedAnswer, source: 'database', readOnly: true, checkedAt: new Date().toISOString() });
    const answer = await runWorkforceAssistant(question, tenant.name, metrics);
    await sendIdempotent({ answer, source: 'gemini', readOnly: true });
  } catch (error) {
    if (claimed && idempotencyKey) {
      await Promise.resolve(IdempotencyService.logFailure(idempotencyKey, error instanceof Error ? error.message : 'Workforce question failed')).catch(() => undefined);
      claimed = false;
    }
    next(error);
  }
});

operationsRouter.get('/tenants/:tenantId/operations/policy', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await operationsService.getPolicy(req.params.tenantId)); } catch (error) { next(error); }
});

operationsRouter.put('/tenants/:tenantId/operations/policy', requirePermission('operations:write'), async (req, res, next) => {
  try {
    const input = z.object({ highValuePurchaseThreshold: z.number().nonnegative().optional(), lowStockAlertsEnabled: z.boolean().optional() }).parse(req.body);
    send(res, await operationsService.updatePolicy(req.params.tenantId, input, req.user!.userId));
  } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/locations', requirePermission('operations:write'), async (req, res, next) => {
  try { send(res, await operationsService.createLocation(req.params.tenantId, z.object({ name: z.string().min(1), locationType: z.string().optional() }).parse(req.body), req.user!.userId), 201); } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/locations', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await operationsService.listLocations(req.params.tenantId)); } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/suppliers', requirePermission('operations:write'), async (req, res, next) => {
  try { send(res, await operationsService.createSupplier(req.params.tenantId, z.object({ name: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional() }).parse(req.body), req.user!.userId), 201); } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/suppliers', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await operationsService.listSuppliers(req.params.tenantId)); } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/products', requirePermission('operations:write'), async (req, res, next) => {
  try {
    const input = z.object({ sku: z.string().min(1), name: z.string().min(1), description: z.string().optional(), unitCost: z.number().nonnegative().optional(), currency: z.string().length(3).optional(), reorderPoint: z.number().int().nonnegative().optional(), reorderQuantity: z.number().int().nonnegative().optional(), supplierId: z.string().optional() }).parse(req.body);
    send(res, await operationsService.createProduct(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/products', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await operationsService.listProducts(req.params.tenantId)); } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/inventory', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await operationsService.listInventory(req.params.tenantId, typeof req.query.locationId === 'string' ? req.query.locationId : undefined)); } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/inventory/adjust', requirePermission('operations:write'), async (req, res, next) => {
  try {
    const input = z.object({ productId: z.string(), locationId: z.string(), quantityDelta: z.number().int().refine((value) => value !== 0, 'Quantity delta cannot be zero'), reason: z.string().min(1), reference: z.string().optional() }).parse(req.body);
    send(res, await operationsService.adjustInventory(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/stock-alerts/detect', requirePermission('operations:write'), async (req, res, next) => {
  try { send(res, await operationsService.detectLowStock(req.params.tenantId, req.user!.userId)); } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/stock-alerts', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await operationsService.listAlerts(req.params.tenantId, typeof req.query.status === 'string' ? req.query.status : undefined)); } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/reorder-recommendations', requirePermission('operations:write'), async (req, res, next) => {
  try {
    const input = z.object({ productId: z.string(), locationId: z.string() }).parse(req.body);
    send(res, await operationsService.createReorderRecommendation(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/reorder-recommendations', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await prisma.reorderRecommendation.findMany({ where: { tenantId: req.params.tenantId }, include: { product: true, location: true, purchaseOrder: true }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/purchase-orders', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await prisma.purchaseOrder.findMany({ where: { tenantId: req.params.tenantId }, include: { supplier: true, items: { include: { product: true } } }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

operationsRouter.get('/tenants/:tenantId/operations/approval-requests', requirePermission('operations:read'), async (req, res, next) => {
  try { send(res, await prisma.approvalRequest.findMany({ where: { tenantId: req.params.tenantId, actionType: 'operations_purchase_order' }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/approval-requests/:approvalId/review', requirePermission('operations:write'), requireRole(StandardRoles.ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ decision: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }).parse(req.body);
    send(res, await operationsService.reviewReorderApproval(req.params.tenantId, req.params.approvalId, req.user!.userId, input.decision, input.rejectionReason));
  } catch (error) { next(error); }
});

operationsRouter.post('/tenants/:tenantId/operations/demand-signals', requirePermission('operations:write'), async (req, res, next) => {
  try {
    const input = z.object({ productId: z.string(), locationId: z.string(), periodStart: z.coerce.date(), periodEnd: z.coerce.date() }).parse(req.body);
    send(res, await operationsService.recordDemandSignal(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});
