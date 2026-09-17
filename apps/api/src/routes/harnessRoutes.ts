import { Router, Response } from 'express';
import { z } from 'zod';
import { ApiResponse, StandardRoles } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission, requireRole } from '../middleware/rbacMiddleware';
import { prisma } from '../lib/prisma';
import { harnessService } from '../services/harnessService';

export const harnessRouter = Router();
harnessRouter.use('/tenants/:tenantId', authenticate, enforceTenantIsolation);

function send<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = { success: true, data, meta: { timestamp: new Date().toISOString() } };
  res.status(status).json(response);
}

harnessRouter.get('/tenants/:tenantId/harness/policy', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await prisma.harnessPolicy.upsert({ where: { tenantId: req.params.tenantId }, update: {}, create: { tenantId: req.params.tenantId } })); } catch (error) { next(error); }
});

harnessRouter.put('/tenants/:tenantId/harness/policy', requirePermission('tasks:execute'), async (req, res, next) => {
  try {
    const input = z.object({ maxInvocationsPerWindow: z.number().int().positive().optional(), rateWindowSeconds: z.number().int().positive().optional(), maxAgentRunIterations: z.number().int().positive().optional() }).parse(req.body);
    send(res, await harnessService.updatePolicy(req.params.tenantId, input, req.user!.userId));
  } catch (error) { next(error); }
});

harnessRouter.post('/tenants/:tenantId/harness/tools', requirePermission('agents:manage'), requireRole(StandardRoles.ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1), description: z.string().min(1), parameterSchema: z.record(z.string(), z.unknown()), verificationSchema: z.record(z.string(), z.unknown()).optional(), requiredPermissions: z.array(z.string()).min(1), riskLevel: z.enum(['low', 'medium', 'high']).optional(), requiresApproval: z.boolean().optional(), timeoutMs: z.number().int().positive().optional(), maxRetries: z.number().int().nonnegative().optional() }).parse(req.body);
    send(res, await harnessService.registerTool(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

harnessRouter.get('/tenants/:tenantId/harness/tools', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await harnessService.listTools(req.params.tenantId)); } catch (error) { next(error); }
});

harnessRouter.post('/tenants/:tenantId/harness/invocations', requirePermission('tasks:execute'), async (req, res, next) => {
  try {
    const input = z.object({ toolName: z.string(), idempotencyKey: z.string().min(1), payload: z.record(z.string(), z.unknown()), actorType: z.string().optional(), agentId: z.string().optional() }).parse(req.body);
    send(res, await harnessService.invokeTool(req.params.tenantId, { ...input, actorId: req.user!.userId, actorPermissions: req.user!.permissions }), 201);
  } catch (error) { next(error); }
});

harnessRouter.post('/tenants/:tenantId/harness/invocations/:invocationId/verify', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await harnessService.completeInvocation(req.params.tenantId, req.params.invocationId, z.record(z.string(), z.unknown()).parse(req.body), req.user!.userId)); } catch (error) { next(error); }
});

harnessRouter.get('/tenants/:tenantId/harness/approval-requests', requirePermission('approvals:read'), async (req, res, next) => {
  try { send(res, await prisma.approvalRequest.findMany({ where: { tenantId: req.params.tenantId, actionType: 'harness_tool_invocation' }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

harnessRouter.post('/tenants/:tenantId/harness/approval-requests/:approvalId/review', requirePermission('approvals:manage'), requireRole(StandardRoles.ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ decision: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }).parse(req.body);
    send(res, await harnessService.reviewInvocation(req.params.tenantId, req.params.approvalId, req.user!.userId, input.decision, input.rejectionReason));
  } catch (error) { next(error); }
});

harnessRouter.post('/tenants/:tenantId/harness/runs', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await harnessService.startRun(req.params.tenantId, z.object({ agentId: z.string().optional(), workflowExecutionId: z.string().optional(), context: z.record(z.string(), z.unknown()).optional() }).parse(req.body), req.user!.userId), 201); } catch (error) { next(error); }
});

harnessRouter.post('/tenants/:tenantId/harness/runs/:runId/iterations', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await harnessService.recordIteration(req.params.tenantId, req.params.runId, z.object({ action: z.string().min(1), result: z.record(z.string(), z.unknown()).optional(), status: z.string().optional() }).parse(req.body)), 201); } catch (error) { next(error); }
});

harnessRouter.get('/tenants/:tenantId/harness/runs', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await harnessService.listRuns(req.params.tenantId)); } catch (error) { next(error); }
});

harnessRouter.post('/tenants/:tenantId/harness/evaluation-datasets', requirePermission('tasks:execute'), async (req, res, next) => {
  try {
    const input = z.object({ name: z.string().min(1), description: z.string().optional(), cases: z.array(z.object({ input: z.record(z.string(), z.unknown()), expected: z.record(z.string(), z.unknown()) })) }).parse(req.body);
    send(res, await harnessService.createEvaluationDataset(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});
