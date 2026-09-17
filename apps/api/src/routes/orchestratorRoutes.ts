import { Router, Response } from 'express';
import { z } from 'zod';
import { ApiResponse, StandardRoles } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission, requireRole } from '../middleware/rbacMiddleware';
import { prisma } from '../lib/prisma';
import { orchestratorService } from '../services/orchestratorService';

export const orchestratorRouter = Router();
orchestratorRouter.use('/tenants/:tenantId', authenticate, enforceTenantIsolation);

function send<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = { success: true, data, meta: { timestamp: new Date().toISOString() } };
  res.status(status).json(response);
}

const nodeSchema = z.object({
  key: z.string().min(1),
  type: z.enum(['agent_task', 'tool_action', 'verification', 'approval', 'wait', 'human_handoff']),
  agentId: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const graphSchema = z.object({
  name: z.string().min(1),
  maxRetries: z.number().int().min(0).max(10).optional(),
  nodes: z.array(nodeSchema).min(1),
  edges: z.array(z.object({ from: z.string(), to: z.string(), condition: z.object({ key: z.string(), equals: z.unknown() }).optional() })),
});

orchestratorRouter.post('/tenants/:tenantId/workflows', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await orchestratorService.createWorkflow(req.params.tenantId, graphSchema.parse(req.body), req.user!.userId), 201); } catch (error) { next(error); }
});

orchestratorRouter.get('/tenants/:tenantId/workflows', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await orchestratorService.listWorkflows(req.params.tenantId)); } catch (error) { next(error); }
});

orchestratorRouter.post('/tenants/:tenantId/workflows/:workflowId/executions', requirePermission('tasks:execute'), async (req, res, next) => {
  try {
    const input = z.object({ context: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().min(1) }).parse(req.body);
    send(res, await orchestratorService.startExecution(req.params.tenantId, req.params.workflowId, input.context, input.idempotencyKey, req.user!.userId), 201);
  } catch (error) { next(error); }
});

orchestratorRouter.post('/tenants/:tenantId/workflow-executions/:executionId/advance', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await orchestratorService.advance(req.params.tenantId, req.params.executionId, req.user!.userId)); } catch (error) { next(error); }
});

orchestratorRouter.post('/tenants/:tenantId/workflow-executions/:executionId/retry', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await orchestratorService.retry(req.params.tenantId, req.params.executionId, req.user!.userId)); } catch (error) { next(error); }
});

orchestratorRouter.post('/tenants/:tenantId/workflow-executions/:executionId/events', requirePermission('tasks:execute'), async (req, res, next) => {
  try {
    const input = z.object({ eventKey: z.string().min(1), eventType: z.string().min(1), payload: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    send(res, await orchestratorService.recordEvent(req.params.tenantId, req.params.executionId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

orchestratorRouter.get('/tenants/:tenantId/workflow-executions/:executionId/trace', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await orchestratorService.trace(req.params.tenantId, req.params.executionId)); } catch (error) { next(error); }
});

orchestratorRouter.get('/tenants/:tenantId/workflow-approvals', requirePermission('approvals:read'), async (req, res, next) => {
  try { send(res, await prisma.approvalRequest.findMany({ where: { tenantId: req.params.tenantId, actionType: 'workflow_approval' }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

orchestratorRouter.post('/tenants/:tenantId/workflow-approvals/:approvalId/review', requirePermission('approvals:manage'), requireRole(StandardRoles.ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ decision: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }).parse(req.body);
    send(res, await orchestratorService.reviewApproval(req.params.tenantId, req.params.approvalId, req.user!.userId, input.decision, input.rejectionReason));
  } catch (error) { next(error); }
});
