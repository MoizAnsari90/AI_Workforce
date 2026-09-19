import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ApiResponse, StandardRoles } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { requireRole, requirePermission } from '../middleware/rbacMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { prisma } from '../lib/prisma';
import { recordAuditLog } from '../services/auditService';
import { TemplateService } from '../services/templateService';

export const tenantRouter = Router();

const createTaskSchema = z.object({
  title: z.string().min(1, 'Task title is required'),
  description: z.string().optional(),
  tenantId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Tenant-Isolated Routes
// ---------------------------------------------------------------------------

// GET /api/v1/tenants/:tenantId/tasks
tenantRouter.get(
  '/tenants/:tenantId/tasks',
  authenticate,
  enforceTenantIsolation,
  requirePermission('tasks:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.params.tenantId;

      const tasks = await prisma.task.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });

      const response: ApiResponse<typeof tasks> = {
        success: true,
        data: tasks,
        meta: {
          timestamp: new Date().toISOString(),
          tenantId,
          count: tasks.length,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/v1/tenants/:tenantId/tasks
tenantRouter.post(
  '/tenants/:tenantId/tasks',
  authenticate,
  enforceTenantIsolation,
  requirePermission('tasks:execute'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.params.tenantId;
      const validated = createTaskSchema.parse(req.body);

      const task = await prisma.task.create({
        data: {
          tenantId,
          title: validated.title,
          description: validated.description,
          status: 'pending',
        },
      });

      // Write an audit log for creating this sensitive task
      await recordAuditLog({
        tenantId,
        actorType: 'user',
        actorId: req.user!.userId,
        operation: 'create_task',
        entityType: 'task',
        entityId: task.id,
        newValue: { title: task.title, status: task.status },
      });

      const response: ApiResponse<typeof task> = {
        success: true,
        data: task,
        meta: {
          timestamp: new Date().toISOString(),
          tenantId,
        },
      };

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Admin & RBAC-Enforced Routes
// ---------------------------------------------------------------------------

// GET /api/v1/admin/audit-logs
tenantRouter.get(
  '/admin/audit-logs',
  authenticate,
  requireRole(StandardRoles.ADMIN),
  requirePermission('audit:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditLogs = await prisma.auditLog.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const response: ApiResponse<typeof auditLogs> = {
        success: true,
        data: auditLogs,
        meta: {
          timestamp: new Date().toISOString(),
          tenantId: req.tenantId,
          count: auditLogs.length,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/templates — list available niche templates
tenantRouter.get('/templates', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await TemplateService.seedDefaultTemplates();
    const templates = await TemplateService.listTemplates();
    return res.status(200).json({ success: true, data: templates });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/tenants/:tenantId/templates/deploy — deploy niche template
tenantRouter.post(
  '/tenants/:tenantId/templates/deploy',
  authenticate,
  enforceTenantIsolation,
  requirePermission('agents:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      const { templateId } = req.body;
      if (!templateId) {
        return res.status(400).json({ success: false, error: { message: 'templateId is required' } });
      }
      const deployment = await TemplateService.deployTemplate(tenantId, templateId, req.user!.userId);
      return res.status(201).json({ success: true, data: deployment });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/v1/tenants/:tenantId/voice-sessions — list voice sessions
tenantRouter.get(
  '/tenants/:tenantId/voice-sessions',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.params.tenantId;
      const sessions = await prisma.voiceSession.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return res.status(200).json({ success: true, data: sessions });
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /api/v1/tenants/:tenantId/agents/:agentId/toggle — pause or resume agent
tenantRouter.patch(
  '/tenants/:tenantId/agents/:agentId/toggle',
  authenticate,
  enforceTenantIsolation,
  requirePermission('agents:manage'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, agentId } = req.params;
      const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId } });
      if (!agent) {
        return res.status(404).json({ success: false, error: { message: 'Agent not found' } });
      }

      const updated = await prisma.agent.update({
        where: { id: agentId },
        data: { isActive: !agent.isActive },
      });

      await recordAuditLog({
        tenantId,
        actorType: 'user',
        actorId: req.user!.userId,
        operation: updated.isActive ? 'agent_resumed' : 'agent_paused',
        entityType: 'agent',
        entityId: agentId,
        newValue: { isActive: updated.isActive, name: updated.name },
      });

      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);
