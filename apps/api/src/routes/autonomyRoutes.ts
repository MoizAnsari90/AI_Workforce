import { Router, Response } from 'express';
import { z } from 'zod';
import { ApiResponse } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { autonomyService } from '../services/autonomyService';

export const autonomyRouter = Router();
autonomyRouter.use('/tenants/:tenantId', authenticate, enforceTenantIsolation);

function send<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = { success: true, data, meta: { timestamp: new Date().toISOString() } };
  res.status(status).json(response);
}

const jobSchema = z.object({
  name: z.string().min(1),
  jobType: z.enum(['health_digest', 'inventory_alerts', 'finance_summary', 'workflow', 'custom']),
  triggerType: z.enum(['schedule', 'event']).optional(),
  eventType: z.string().optional(),
  intervalSeconds: z.number().int().positive().optional(),
  nextRunAt: z.coerce.date().optional(),
  workflowId: z.string().optional(),
  maxRetries: z.number().int().nonnegative().max(10).optional(),
});

autonomyRouter.get('/tenants/:tenantId/autonomy/policy', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await autonomyService.getPolicy(req.params.tenantId)); } catch (error) { next(error); }
});

autonomyRouter.put('/tenants/:tenantId/autonomy/policy', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.updatePolicy(req.params.tenantId, z.object({ maxRunsPerWindow: z.number().int().positive().optional(), runWindowSeconds: z.number().int().positive().optional(), notificationsEnabled: z.boolean().optional() }).parse(req.body), req.user!.userId)); } catch (error) { next(error); }
});

autonomyRouter.post('/tenants/:tenantId/autonomy/jobs', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.createJob(req.params.tenantId, jobSchema.parse(req.body), req.user!.userId), 201); } catch (error) { next(error); }
});

autonomyRouter.get('/tenants/:tenantId/autonomy/jobs', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await autonomyService.listJobs(req.params.tenantId)); } catch (error) { next(error); }
});

autonomyRouter.post('/tenants/:tenantId/autonomy/tick', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.tick(req.params.tenantId)); } catch (error) { next(error); }
});

autonomyRouter.post('/tenants/:tenantId/autonomy/jobs/:jobId/run', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.runJob(req.params.tenantId, req.params.jobId, z.record(z.string(), z.unknown()).parse(req.body)), 201); } catch (error) { next(error); }
});

autonomyRouter.post('/tenants/:tenantId/autonomy/events', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.publishEvent(req.params.tenantId, z.object({ eventKey: z.string().min(1), eventType: z.string().min(1), payload: z.record(z.string(), z.unknown()).optional() }).parse(req.body)), 201); } catch (error) { next(error); }
});

autonomyRouter.post('/tenants/:tenantId/autonomy/runs/:runId/retry', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.retryRun(req.params.tenantId, req.params.runId)); } catch (error) { next(error); }
});

autonomyRouter.get('/tenants/:tenantId/autonomy/dashboard', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await autonomyService.dashboard(req.params.tenantId)); } catch (error) { next(error); }
});

autonomyRouter.get('/tenants/:tenantId/autonomy/notifications', requirePermission('tasks:read'), async (req, res, next) => {
  try { send(res, await autonomyService.listNotifications(req.params.tenantId)); } catch (error) { next(error); }
});

autonomyRouter.post('/tenants/:tenantId/autonomy/notifications/:notificationId/read', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.markNotificationRead(req.params.tenantId, req.params.notificationId)); } catch (error) { next(error); }
});

autonomyRouter.post('/tenants/:tenantId/autonomy/heartbeats/:component', requirePermission('tasks:execute'), async (req, res, next) => {
  try { send(res, await autonomyService.heartbeat(req.params.tenantId, req.params.component, z.object({ status: z.string().optional(), metadata: z.record(z.string(), z.unknown()).optional() }).parse(req.body).status ?? 'healthy', z.object({ status: z.string().optional(), metadata: z.record(z.string(), z.unknown()).optional() }).parse(req.body).metadata)); } catch (error) { next(error); }
});
