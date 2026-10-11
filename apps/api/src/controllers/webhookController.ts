import { Request, Response, NextFunction } from 'express';
import { whatsappService } from '../services/whatsappService';
import { queueService } from '../services/queueService';
import { prisma } from '../lib/prisma';
import { NotFoundError, ValidationError } from '../errors/AppError';
import { logger } from '../utils/logger';
import { z } from 'zod';
import { acceptNicheInbound } from '../services/nicheAutomationWorker';
import { IntegrationService } from '../services/integrationService';
import { consumeWhatsAppSetupTest } from '../services/whatsappSetupTestService';
import { sendSupportReply } from '../services/supportReplyService';

// ---------------------------------------------------------------------------
// GET /api/v1/webhook/:tenantId/whatsapp — Meta verification challenge
// ---------------------------------------------------------------------------
export async function verifyWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId } = req.params;

    // Validate tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return next(new NotFoundError(`Tenant ${tenantId} not found`));
    }

    const mode = req.query['hub.mode'] as string | undefined;
    const token = req.query['hub.verify_token'] as string | undefined;
    const challenge = req.query['hub.challenge'] as string | undefined;

    const challengeResponse = whatsappService.verifyWebhook(mode, token, challenge);

    if (!challengeResponse) {
      logger.warn('Webhook verification rejected', { tenantId, mode });
      return res.status(403).json({ error: 'Webhook verification failed' });
    }

    return res.status(200).send(challengeResponse);
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/webhook/:tenantId/whatsapp — Inbound message ingestion
// ---------------------------------------------------------------------------
export async function receiveWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId } = req.params;
    const signatureHeader = Array.isArray(req.headers['x-hub-signature-256'])
      ? req.headers['x-hub-signature-256'][0]
      : req.headers['x-hub-signature-256'];
    const rawBody = Buffer.isBuffer(req.body) ? req.body : typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body ?? {}));

    if (!whatsappService.verifySignature(rawBody, signatureHeader)) {
      logger.warn('Webhook signature validation failed', { tenantId, hasSignature: !!signatureHeader, environment: process.env.NODE_ENV });
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Invalid Meta webhook signature' },
      });
    }

    // Validate tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      return next(new NotFoundError(`Tenant ${tenantId} not found`));
    }

    const payload = Buffer.isBuffer(req.body)
      ? JSON.parse(req.body.toString())
      : req.body && typeof req.body === 'object'
        ? req.body
        : JSON.parse(String(req.body ?? '{}'));

    // Persist niche jobs before acknowledgement so provider retries cannot lose them.
      try {
        const parsed = whatsappService.parseWebhookPayload(payload);

        if (parsed.length === 0) {
          logger.debug('Webhook payload contained no actionable messages', { tenantId });
          return res.status(200).json({ status: 'received' });
        }

        // Check the entire batch before queuing any work. Meta's app signature
        // authenticates the payload, not the tenant chosen in this legacy URL.
        const credential = await IntegrationService.getWhatsAppCredential(tenantId);
        if (!credential.phoneNumberId || parsed.some(message => message.phoneNumberId !== credential.phoneNumberId)) {
          return res.status(403).json({ success: false, error: { code: 'WHATSAPP_ACCOUNT_MISMATCH', message: 'This WhatsApp number does not belong to this workspace.' } });
        }
        for (const message of parsed) {
          if (!await consumeWhatsAppSetupTest(tenantId, message) && !await acceptNicheInbound(tenantId, message)) await queueService.enqueue({ tenantId, message });
        }

        logger.info('Webhook messages enqueued', {
          tenantId,
          count: parsed.length,
        });
        return res.status(200).json({ status: 'received' });
      } catch (err) {
        logger.error('Failed to persist webhook payload', { tenantId });
        return res.status(503).json({ error: 'Webhook persistence unavailable. Retry delivery.' });
      }
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// Schema for human reply
// ---------------------------------------------------------------------------
const humanReplySchema = z.object({
  message: z.string().trim().min(1, 'Reply message is required').max(2000),
  requestId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// POST /api/v1/tenants/:tenantId/conversations/:conversationId/reply
// Human agent sends a reply to a paused conversation
// ---------------------------------------------------------------------------
export async function humanReply(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, conversationId } = req.params;
    const { message, requestId } = humanReplySchema.parse(req.body);
    const { recordAuditLog } = await import('../services/auditService');
    const { emitToTenant } = await import('../lib/socket');
    const result = await sendSupportReply({ tenantId, conversationId, userId: req.user!.userId, requestId, message });
    if (!result.replayed) {
      emitToTenant(tenantId, 'message:new', {
        conversationId, direction: 'outbound', senderType: 'human', textContent: message,
      });
      await recordAuditLog({
        tenantId, actorType: 'user', actorId: req.user!.userId,
        operation: 'human_reply_sent', entityType: 'conversation', entityId: conversationId,
        newValue: { textPreview: message.substring(0, 80), sentMessageId: result.sentMessageId },
      }).catch(() => logger.warn('Could not write support reply audit event', { tenantId, conversationId }));
    }

    return res.status(200).json({
      success: true,
      data: result,
      meta: { timestamp: new Date().toISOString(), tenantId },
    });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/tenants/:tenantId/conversations/:conversationId/pause-ai
// Human takeover: disable AI for a conversation
// ---------------------------------------------------------------------------
export async function pauseAI(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, conversationId } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      return next(new NotFoundError('Conversation not found'));
    }

    const { conversationService } = await import('../services/conversationService');
    const { recordAuditLog } = await import('../services/auditService');
    const { emitToTenant } = await import('../lib/socket');

    const updated = await conversationService.pauseAI(tenantId, conversationId, req.user?.userId);
    if (!updated) {
      return next(new NotFoundError('Conversation not found'));
    }

    emitToTenant(tenantId, 'conversation:ai_paused', {
      conversationId,
      pausedByUserId: req.user?.userId,
    });

    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: req.user!.userId,
      operation: 'ai_paused',
      entityType: 'conversation',
      entityId: conversationId,
      newValue: { aiActive: false, assignedAgentId: req.user?.userId },
    });

    return res.status(200).json({
      success: true,
      data: { conversationId, aiActive: updated.aiActive },
      meta: { timestamp: new Date().toISOString(), tenantId },
    });
  } catch (error) {
    next(error);
  }
}

// ---------------------------------------------------------------------------
// POST /api/v1/tenants/:tenantId/conversations/:conversationId/resume-ai
// Resume AI for a conversation
// ---------------------------------------------------------------------------
export async function resumeAI(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId, conversationId } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });

    if (!conversation) {
      return next(new NotFoundError('Conversation not found'));
    }

    const { conversationService } = await import('../services/conversationService');
    const { recordAuditLog } = await import('../services/auditService');
    const { emitToTenant } = await import('../lib/socket');

    const updated = await conversationService.resumeAI(tenantId, conversationId);
    if (!updated) {
      return next(new NotFoundError('Conversation not found'));
    }

    emitToTenant(tenantId, 'conversation:ai_resumed', { conversationId });

    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: req.user!.userId,
      operation: 'ai_resumed',
      entityType: 'conversation',
      entityId: conversationId,
      newValue: { aiActive: true },
    });

    return res.status(200).json({
      success: true,
      data: { conversationId, aiActive: updated.aiActive },
      meta: { timestamp: new Date().toISOString(), tenantId },
    });
  } catch (error) {
    next(error);
  }
}
