import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse, StandardRoles } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requireRole, requirePermission } from '../middleware/rbacMiddleware';
import { prisma } from '../lib/prisma';
import { leadService, LeadStatus } from '../services/leadService';
import { salesService } from '../services/salesService';

export const salesRouter = Router();
salesRouter.use('/tenants/:tenantId', authenticate, enforceTenantIsolation);

const leadInput = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  estimatedValue: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  assignedUserId: z.string().optional(),
  qualificationData: z.record(z.string(), z.unknown()).optional(),
});

const updateLeadInput = leadInput.partial().omit({ source: true });
const policyInput = z.object({
  maxDiscountPct: z.number().min(0).max(100).optional(),
  highValueDealThreshold: z.number().nonnegative().optional(),
  requireApprovalAbove: z.number().nonnegative().optional(),
  qualificationCriteria: z.array(z.object({ key: z.string(), label: z.string(), weight: z.number() })).optional(),
});

function send<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = {
    success: true,
    data,
    meta: { timestamp: new Date().toISOString() },
  };
  res.status(status).json(response);
}

salesRouter.get('/tenants/:tenantId/sales/policy', requirePermission('sales:read'), async (req, res, next) => {
  try { send(res, await salesService.getPolicy(req.params.tenantId)); } catch (error) { next(error); }
});

salesRouter.put('/tenants/:tenantId/sales/policy', requirePermission('sales:write'), async (req, res, next) => {
  try { send(res, await salesService.updatePolicy(req.params.tenantId, policyInput.parse(req.body), req.user!.userId)); } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads', requirePermission('sales:write'), async (req, res, next) => {
  try { send(res, await leadService.create({ tenantId: req.params.tenantId, ...leadInput.parse(req.body) }), 201); } catch (error) { next(error); }
});

salesRouter.get('/tenants/:tenantId/leads', requirePermission('sales:read'), async (req, res, next) => {
  try { send(res, await leadService.listForTenant(req.params.tenantId, typeof req.query.status === 'string' ? req.query.status : undefined)); } catch (error) { next(error); }
});

salesRouter.get('/tenants/:tenantId/leads/pipeline', requirePermission('sales:read'), async (req, res, next) => {
  try { send(res, await leadService.pipelineSummary(req.params.tenantId)); } catch (error) { next(error); }
});

salesRouter.get('/tenants/:tenantId/leads/:leadId', requirePermission('sales:read'), async (req, res, next) => {
  try { send(res, await leadService.findByIdForTenant(req.params.tenantId, req.params.leadId)); } catch (error) { next(error); }
});

salesRouter.patch('/tenants/:tenantId/leads/:leadId', requirePermission('sales:write'), async (req, res, next) => {
  try { send(res, await leadService.update(req.params.tenantId, req.params.leadId, updateLeadInput.parse(req.body))); } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads/:leadId/transition', requirePermission('sales:write'), async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'disqualified']), note: z.string().optional() }).parse(req.body);
    send(res, await leadService.transition(req.params.tenantId, req.params.leadId, input.status as LeadStatus, req.user!.userId, input.note));
  } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads/:leadId/rescore', requirePermission('sales:write'), async (req, res, next) => {
  try { send(res, await leadService.rescore(req.params.tenantId, req.params.leadId, req.user!.userId)); } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads/:leadId/activities', requirePermission('sales:write'), async (req, res, next) => {
  try {
    const input = z.object({ activityType: z.string().min(1), summary: z.string().min(1), payload: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    send(res, await leadService.logActivity({ tenantId: req.params.tenantId, leadId: req.params.leadId, ...input, performedBy: req.user!.userId }), 201);
  } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads/:leadId/follow-ups', requirePermission('sales:write'), async (req, res, next) => {
  try {
    const input = z.object({ title: z.string().min(1), description: z.string().optional(), scheduledAt: z.coerce.date(), assignedAgentId: z.string().optional() }).parse(req.body);
    send(res, await salesService.createFollowUp(req.params.tenantId, req.params.leadId, input), 201);
  } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads/:leadId/outreach/whatsapp', requirePermission('sales:write'), async (req, res, next) => {
  try {
    const input = z.object({ text: z.string().min(1).max(4096) }).parse(req.body);
    send(res, await salesService.sendWhatsAppOutreach(req.params.tenantId, req.params.leadId, input.text, req.user!.userId));
  } catch (error) { next(error); }
});

salesRouter.get('/tenants/:tenantId/follow-ups', requirePermission('sales:read'), async (req, res, next) => {
  try { send(res, await salesService.listFollowUps(req.params.tenantId, typeof req.query.leadId === 'string' ? req.query.leadId : undefined)); } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads/:leadId/approval-requests', requirePermission('sales:write'), async (req, res, next) => {
  try {
    const input = z.object({ actionType: z.enum(['discount', 'close_deal', 'proposal']), discountPct: z.number().min(0).optional(), dealValue: z.number().nonnegative().optional(), agentId: z.string(), payload: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    send(res, await salesService.requestApproval(req.params.tenantId, req.params.leadId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

salesRouter.get('/tenants/:tenantId/approval-requests', requirePermission('approvals:read'), async (req, res, next) => {
  try { send(res, await prisma.approvalRequest.findMany({ where: { tenantId: req.params.tenantId }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/approval-requests/:approvalId/review', requirePermission('approvals:manage'), requireRole(StandardRoles.ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ decision: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }).parse(req.body);
    send(res, await salesService.reviewApproval(req.params.tenantId, req.params.approvalId, req.user!.userId, input.decision, input.rejectionReason));
  } catch (error) { next(error); }
});

salesRouter.post('/tenants/:tenantId/leads/:leadId/memory', requirePermission('sales:write'), async (req, res, next) => {
  try {
    const input = z.object({ memoryType: z.string().min(1), content: z.string().min(1), metadata: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    send(res, await salesService.addMemory(req.params.tenantId, req.params.leadId, input.memoryType, input.content, req.user!.userId, input.metadata), 201);
  } catch (error) { next(error); }
});

salesRouter.get('/tenants/:tenantId/leads/:leadId/memory', requirePermission('sales:read'), async (req, res, next) => {
  try { send(res, await salesService.listMemory(req.params.tenantId, req.params.leadId)); } catch (error) { next(error); }
});
