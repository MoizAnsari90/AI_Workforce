import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { prisma } from '../lib/prisma';
import { conversationService } from '../services/conversationService';
import {
  verifyWebhook,
  receiveWebhook,
  humanReply,
  pauseAI,
  resumeAI,
} from '../controllers/webhookController';

export const webhookRouter = Router();

// ---------------------------------------------------------------------------
// WhatsApp Webhook (public — Meta calls this directly)
// GET  /api/v1/webhook/:tenantId/whatsapp  — challenge verification
// POST /api/v1/webhook/:tenantId/whatsapp  — inbound messages
// ---------------------------------------------------------------------------
webhookRouter.get('/webhook/:tenantId/whatsapp', verifyWebhook);
webhookRouter.post('/webhook/:tenantId/whatsapp', receiveWebhook);

// ---------------------------------------------------------------------------
// Conversation Management (authenticated, tenant-isolated)
// ---------------------------------------------------------------------------

// GET /api/v1/tenants/:tenantId/conversations — list conversations (human inbox)
webhookRouter.get(
  '/tenants/:tenantId/conversations',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      const aiActiveStr = req.query.aiActive as string | undefined;
      const aiActiveFilter =
        aiActiveStr === 'true' ? true : aiActiveStr === 'false' ? false : undefined;

      const conversations = await conversationService.listForTenant(tenantId, aiActiveFilter);

      return res.status(200).json({
        success: true,
        data: conversations,
        meta: {
          timestamp: new Date().toISOString(),
          tenantId,
          count: conversations.length,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/v1/tenants/:tenantId/conversations/:conversationId — single conversation with messages
webhookRouter.get(
  '/tenants/:tenantId/conversations/:conversationId',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId, conversationId } = req.params;
      const conversation = await conversationService.findByIdForTenant(tenantId, conversationId);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
      }

      return res.status(200).json({
        success: true,
        data: conversation,
        meta: { timestamp: new Date().toISOString(), tenantId },
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /api/v1/tenants/:tenantId/conversations/:conversationId/reply
webhookRouter.post(
  '/tenants/:tenantId/conversations/:conversationId/reply',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:write'),
  humanReply,
);

// POST /api/v1/tenants/:tenantId/conversations/:conversationId/pause-ai
webhookRouter.post(
  '/tenants/:tenantId/conversations/:conversationId/pause-ai',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:write'),
  pauseAI,
);

// POST /api/v1/tenants/:tenantId/conversations/:conversationId/resume-ai
webhookRouter.post(
  '/tenants/:tenantId/conversations/:conversationId/resume-ai',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:write'),
  resumeAI,
);

// ---------------------------------------------------------------------------
// Support Agent Configuration — Business profile
// ---------------------------------------------------------------------------
const businessConfigSchema = z.object({
  name: z.string().min(1).optional(),
  industry: z.string().optional(),
  brandVoiceGuide: z.string().optional(),
  supportPhoneNumberId: z.string().optional(),
  supportAccessToken: z.string().optional(),
});

// GET /api/v1/tenants/:tenantId/support-config
webhookRouter.get(
  '/tenants/:tenantId/support-config',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      const business = await prisma.business.findFirst({ where: { tenantId } });

      return res.status(200).json({
        success: true,
        data: business
          ? {
              id: business.id,
              name: business.name,
              industry: business.industry,
              brandVoiceGuide: business.brandVoiceGuide,
              // Never expose tokens in response
              hasSupportAccessToken: !!business.supportAccessToken,
              hasPhoneNumberId: !!business.supportPhoneNumberId,
            }
          : null,
        meta: { timestamp: new Date().toISOString(), tenantId },
      });
    } catch (error) {
      next(error);
    }
  },
);

import { recordAuditLog } from '../services/auditService';

// ... (existing imports)

// PUT /api/v1/tenants/:tenantId/support-config
webhookRouter.put(
  '/tenants/:tenantId/support-config',
  authenticate,
  enforceTenantIsolation,
  requirePermission('support:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tenantId } = req.params;
      const validated = businessConfigSchema.parse(req.body);

      const existing = await prisma.business.findFirst({ where: { tenantId } });

      const business = existing
        ? await prisma.business.update({
            where: { id: existing.id },
            data: {
              ...(validated.name ? { name: validated.name } : {}),
              industry: validated.industry ?? existing.industry,
              brandVoiceGuide: validated.brandVoiceGuide ?? existing.brandVoiceGuide,
              supportPhoneNumberId: validated.supportPhoneNumberId ?? existing.supportPhoneNumberId,
              supportAccessToken: validated.supportAccessToken ?? existing.supportAccessToken,
            },
          })
        : await prisma.business.create({
            data: {
              tenantId,
              name: validated.name ?? 'My Business',
              industry: validated.industry ?? null,
              brandVoiceGuide: validated.brandVoiceGuide ?? null,
              supportPhoneNumberId: validated.supportPhoneNumberId ?? null,
              supportAccessToken: validated.supportAccessToken ?? null,
            },
          });

      // Audit log the update (without secrets)
      await recordAuditLog({
        tenantId,
        actorType: 'user',
        actorId: req.user!.userId,
        operation: existing ? 'support_config_updated' : 'support_config_created',
        entityType: 'business',
        entityId: business.id,
        newValue: {
          name: business.name,
          industry: business.industry,
          brandVoiceGuidePreview: business.brandVoiceGuide?.substring(0, 50),
          hasSupportAccessToken: !!business.supportAccessToken,
          hasPhoneNumberId: !!business.supportPhoneNumberId,
        },
        oldValue: existing
          ? {
              name: existing.name,
              industry: existing.industry,
              brandVoiceGuidePreview: existing.brandVoiceGuide?.substring(0, 50),
              hasSupportAccessToken: !!existing.supportAccessToken,
              hasPhoneNumberId: !!existing.supportPhoneNumberId,
            }
          : undefined,
      });

      return res.status(200).json({
        success: true,
        data: {
          id: business.id,
          name: business.name,
          industry: business.industry,
          brandVoiceGuide: business.brandVoiceGuide,
          hasSupportAccessToken: !!business.supportAccessToken,
          hasPhoneNumberId: !!business.supportPhoneNumberId,
        },
        meta: { timestamp: new Date().toISOString(), tenantId },
      });
    } catch (error) {
      next(error);
    }
  },
);
