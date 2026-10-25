import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { automationConfig, defaultAutomation, enqueueNicheDispatch, getAutomationConfig, openAutomation, openAutomationData, sealAutomationData } from '../services/nicheAutomationStore';
import { verifyReminderTemplate, whatsappCredential } from '../services/nicheProviders';
import { connectDograh, dograhWebhookUrl, getDograhCredential, sendDograhCall } from '../services/dograh';
import { type NicheConversationState } from '../services/nicheConversationService';
import { ConflictError, NotFoundError, TooManyRequestsError } from '../errors/AppError';
import { IntegrationService } from '../services/integrationService';
import { getWhatsAppSetupTestStatus, hasRecentWhatsAppDeliveryProof } from '../services/whatsappSetupTestService';
import { DispatchError } from '../services/nicheProviders';
import { IdempotencyService } from '../services/idempotencyService';

export const nicheAutomationRouter = Router();
const base = '/tenants/:tenantId/reception-automation';
nicheAutomationRouter.use(base, authenticate, enforceTenantIsolation, requireRole('admin'));
nicheAutomationRouter.get(base, async (req, res, next) => {
  try {
    const tenantId = req.tenantId!; const [config, sessions, jobs, credential, voiceSessions] = await Promise.all([getAutomationConfig(tenantId), prisma.nicheSession.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: 100 }), prisma.nicheDispatch.findMany({ where: { tenantId, type: { notIn: ['turn_receipt', 'inbound', 'provider_delivery_receipt'] } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, type: true, status: true, providerId: true, createdAt: true } }), IntegrationService.getCredential(tenantId, 'dograh'), prisma.voiceSession.findMany({ where: { tenantId, provider: 'DOGRAH' }, orderBy: { createdAt: 'desc' }, take: 30, select: { callId: true, status: true, metadata: true, createdAt: true } })]);
    let webhookUrl: string | null = null; try { webhookUrl = dograhWebhookUrl(tenantId); } catch { /* Public origin is optional until voice setup. */ }
    res.json({ success: true, data: { config: config || defaultAutomation, voiceConnected: !!credential, webhookUrl, voiceTests: voiceSessions.filter(item => (item.metadata as { purpose?: string } | null)?.purpose === 'connection_test').map(item => ({ callId: item.callId, status: item.status, createdAt: item.createdAt })), sessions: sessions.map(item => { const state = openAutomationData<NicheConversationState>(item.encryptedState, tenantId); return { id: item.id, channel: item.channel, name: state.name || 'New contact', phone: state.phone, paused: item.paused, optedOut: item.optedOut, handoffReason: item.handoffReason, stage: state.stage, lastReply: state.lastReply, lastCustomerMessage: state.lastCustomerMessage, updatedAt: item.updatedAt }; }), jobs } });
  } catch (error) { next(error); }
});
nicheAutomationRouter.put(base, async (req, res, next) => {
  try {
    const config = automationConfig.parse(req.body); const tenantId = req.tenantId!;
    const previous = await getAutomationConfig(tenantId);
    if (config.whatsappEnabled || config.remindersEnabled) await whatsappCredential(tenantId);
    if (config.whatsappEnabled && !previous?.whatsappEnabled) {
      if (!await hasRecentWhatsAppDeliveryProof(tenantId)) {
        throw new ConflictError('Run the WhatsApp delivery test successfully within the last 30 days before enabling automatic replies.');
      }
    }
    if (config.remindersEnabled) await verifyReminderTemplate(tenantId, config);
    if (config.voiceEnabled) await getDograhCredential(tenantId);
    if ((config.voiceEnabled || config.whatsappEnabled) && !await prisma.businessProfile.findUnique({ where: { tenantId } })) throw new ConflictError('Save Business setup first.');
    await prisma.$transaction(async tx => { await tx.nicheAutomation.upsert({ where: { tenantId }, create: { tenantId, config }, update: { config } }); await tx.auditLog.create({ data: { tenantId, actorId: req.user!.userId, actorType: 'user', operation: 'reception_automation_updated', entityType: 'integration', entityId: tenantId } }); });
    res.json({ success: true, data: { config } });
  } catch (error) { next(error); }
});
nicheAutomationRouter.post(`${base}/voice`, async (req, res, next) => { try { res.json({ success: true, data: await connectDograh(req.tenantId!, req.user!.userId, req.body) }); } catch (error) { next(error); } });
nicheAutomationRouter.post(`${base}/voice/test-call`, async (req, res, next) => {
  try {
    const input = z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/), requestId: z.string().uuid(), confirmControlAndCharges: z.literal(true) }).strict().parse(req.body);
    const tenantId = req.tenantId!;
    await getDograhCredential(tenantId);
    const recentTests = await prisma.idempotencyLog.count({ where: { tenantId, actionType: 'dograh_test_call', startedAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
    if (recentTests >= 3) throw new TooManyRequestsError('Three voice setup calls have already been requested this hour. Check Dograh activity before trying again.');
    const { key, idempotencyLog } = await IdempotencyService.generateIdempotencyKey({ tenantId, actionType: 'dograh_test_call', targetResource: `test:${input.requestId}`, requestData: input.phone });
    if (idempotencyLog) {
      if (idempotencyLog.status === 'succeeded' && idempotencyLog.providerRef) return res.status(200).json({ success: true, data: { callId: idempotencyLog.providerRef, status: 'already_placed' } });
      throw new ConflictError('This test request is already in progress or needs review. Check Dograh call activity before starting another call.');
    }
    try { await IdempotencyService.createPendingLog(key, tenantId, 'dograh_test_call', `test:${input.requestId}`); }
    catch { throw new ConflictError('This test call request was already received. Check Dograh call activity before retrying.'); }
    try {
      const callId = await sendDograhCall(tenantId, input.phone, `setup-test:${input.requestId}`);
      await prisma.voiceSession.upsert({ where: { callId }, create: { tenantId, provider: 'DOGRAH', callId, status: 'initiated', metadata: { purpose: 'connection_test', requestedBy: req.user!.userId, requestId: input.requestId } }, update: {} });
      await IdempotencyService.logSuccess(key, callId, { callId, status: 'initiated' });
      await prisma.auditLog.create({ data: { tenantId, actorId: req.user!.userId, actorType: 'user', operation: 'dograh_connection_test_call', entityType: 'voice_session', entityId: callId, newValue: JSON.stringify({ destinationSuffix: input.phone.slice(-4) }) } });
      return res.status(202).json({ success: true, data: { callId, status: 'initiated', destination: `${input.phone.slice(0, -4).replace(/\d/g, '•')}${input.phone.slice(-4)}` } });
    } catch (error) {
      const uncertain = error instanceof DispatchError && error.uncertain;
      await IdempotencyService.logFailure(key, uncertain ? 'Provider acceptance is unknown; check Dograh before retrying.' : 'Provider rejected the test call.');
      if (uncertain) throw new ConflictError('Dograh may have accepted the call. Check call activity before requesting another test call.');
      throw error;
    }
  } catch (error) { next(error); }
});
nicheAutomationRouter.delete(`${base}/voice`, async (req, res, next) => { try { await IntegrationService.deleteCredential(req.tenantId!, 'dograh', req.user!.userId); res.json({ success: true, data: { disconnected: true } }); } catch (error) { next(error); } });
nicheAutomationRouter.post(`${base}/sessions/:id/resume`, async (req, res, next) => {
  try {
    const item = await prisma.nicheSession.findFirst({ where: { tenantId: req.tenantId!, id: z.string().uuid().parse(req.params.id) } }); if (!item) throw new NotFoundError('Session not found.');
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`session:${req.tenantId!}:${item.customerHash}`}))`;
      const current = await tx.nicheSession.findUniqueOrThrow({ where: { id: item.id } });
      if (current.optedOut) throw new ConflictError('This customer opted out. Only their START message can opt them in again.');
      const state = openAutomationData<NicheConversationState>(current.encryptedState, req.tenantId!);
      const config = await getAutomationConfig(req.tenantId!);
      await tx.nicheSession.update({ where: { id: item.id }, data: { paused: false, handoffReason: null, encryptedState: sealAutomationData({ phone: state.phone, stage: 'welcome' }, req.tenantId!, config?.kind || defaultAutomation.kind) } });
      await tx.auditLog.create({ data: { tenantId: req.tenantId!, actorId: req.user!.userId, actorType: 'user', operation: 'receptionist_resumed', entityType: 'niche_session', entityId: item.id } });
    }, { maxWait: 60_000 });
    res.json({ success: true, data: { resumed: true } });
  } catch (error) { next(error); }
});
nicheAutomationRouter.post(`${base}/sessions/:id/reply`, async (req, res, next) => {
  try {
    const { text, requestId } = z.object({ text: z.string().trim().min(1).max(2000), requestId: z.string().uuid() }).strict().parse(req.body);
    const item = await prisma.nicheSession.findFirst({ where: { tenantId: req.tenantId!, id: z.string().uuid().parse(req.params.id), channel: 'whatsapp' } }); if (!item) throw new NotFoundError('WhatsApp session not found.');
    if (item.optedOut) throw new ConflictError('This customer opted out. Wait for their START message.');
    const inbound = await prisma.nicheDispatch.findFirst({ where: { tenantId: req.tenantId!, scope: item.customerHash, type: 'inbound' }, orderBy: { createdAt: 'desc' } });
    const receivedAt = inbound ? openAutomationData<{ receivedAt: string }>(inbound.encryptedPayload, req.tenantId!).receivedAt : '';
    if (!receivedAt || Date.parse(receivedAt) < Date.now() - 23 * 3600_000) throw new ConflictError('The reply window expired. Wait for a new customer message.');
    const state = openAutomationData<NicheConversationState>(item.encryptedState, req.tenantId!);
    const config = await getAutomationConfig(req.tenantId!);
    const job = await enqueueNicheDispatch(req.tenantId!, `human:${requestId}`, 'whatsapp_reply', { phone: state.phone, text, receivedAt, humanReply: true }, undefined, config?.kind || defaultAutomation.kind);
    await prisma.nicheSession.updateMany({ where: { id: item.id, optedOut: false }, data: { paused: true, handoffReason: 'staff_reply' } });
    res.status(202).json({ success: true, data: { id: job.id, status: job.status } });
  } catch (error) { next(error); }
});
