import { z } from 'zod';
import { hasSubscription } from './subscriptionService';
import { hasActiveChannelAgent } from './agentActivationService';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { type ParsedWhatsAppMessage } from './whatsappService';
import { customerHash, enqueueNicheDispatch, getAutomationConfig, normalizePhone, openAutomation, sealAutomation } from './nicheAutomationStore';
import { processNicheTurn } from './nicheConversationService';
import { decryptAppointmentContact } from './nicheWorkflowService';
import { DispatchError, sendNicheVoiceCall, sendNicheWhatsApp, verifyReminderTemplate, whatsappCredential } from './nicheProviders';

export async function acceptNicheInbound(tenantId: string, message: ParsedWhatsAppMessage) {
  const config = await getAutomationConfig(tenantId); if (!config) return false;
  const credential = await whatsappCredential(tenantId);
  if (message.phoneNumberId !== credential.phoneNumberId) throw new Error('WhatsApp account does not belong to this workspace');
  const phone = normalizePhone(message.fromPhone);
  const timestamp = Date.parse(message.timestamp);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300_000) throw new Error('Invalid message timestamp');
  const payload = { text: message.text, phone, messageId: message.metaMessageId, receivedAt: new Date(timestamp).toISOString(), channel: 'whatsapp' };
  await prisma.nicheDispatch.upsert({ where: { tenantId_key: { tenantId, key: `inbound:${message.metaMessageId}` } }, create: { tenantId, key: `inbound:${message.metaMessageId}`, type: 'inbound', scope: customerHash(phone), encryptedPayload: sealAutomation(payload, tenantId) }, update: {} });
  return true;
}
export async function recordNicheDelivery(tenantId: string, providerId: string, status: string) {
  let changed = 0;
  if (['delivered', 'read'].includes(status)) changed = (await prisma.nicheDispatch.updateMany({ where: { tenantId, providerId, status: { in: ['accepted', 'unknown'] } }, data: { status: 'delivered' } })).count;
  if (status === 'failed') changed = (await prisma.nicheDispatch.updateMany({ where: { tenantId, providerId, status: 'accepted' }, data: { status: 'failed' } })).count;
  // A very fast Meta receipt can arrive before the send worker has saved the
  // returned message ID. Buffer it briefly for setup-test replies so its proof
  // cannot be lost in that small race window.
  if (!changed && ['delivered', 'read', 'failed'].includes(status)) {
    const activeSetupReply = await prisma.nicheDispatch.findFirst({ where: { tenantId, type: 'whatsapp_setup_test_reply', status: 'processing' }, select: { id: true } });
    if (activeSetupReply) await prisma.nicheDispatch.upsert({
      where: { tenantId_key: { tenantId, key: `whatsapp-setup-receipt:${providerId}` } },
      create: { tenantId, key: `whatsapp-setup-receipt:${providerId}`, type: 'provider_delivery_receipt', status: ['delivered', 'read'].includes(status) ? 'delivered' : 'failed', dueAt: new Date(Date.now() + 60_000), encryptedPayload: sealAutomation({ providerId }, tenantId) },
      update: { status: ['delivered', 'read'].includes(status) ? 'delivered' : 'failed', dueAt: new Date(Date.now() + 60_000) },
    });
  }
}
export async function scheduleNicheReminders(now = new Date()) {
  const settings = await prisma.nicheAutomation.findMany({ take: 500 });
  for (const setting of settings) {
    const config = await getAutomationConfig(setting.tenantId); if (!config?.remindersEnabled) continue;
    const appointments = await prisma.scheduledAppointment.findMany({ where: { tenantId: setting.tenantId, kind: config.kind, status: 'confirmed', reminderConsent: true, startTime: { gt: now, lte: new Date(now.getTime() + config.reminderHours * 3600_000) } }, take: 200 });
    for (const appointment of appointments) await enqueueNicheDispatch(setting.tenantId, `reminder:${appointment.id}:${appointment.startTime.toISOString()}`, 'reminder', { appointmentId: appointment.id }, new Date(appointment.startTime.getTime() - config.reminderHours * 3600_000));
  }
}
const replyPayload = z.object({ phone: z.string(), text: z.string(), receivedAt: z.string(), controlReply: z.boolean().optional(), humanReply: z.boolean().optional() });
export async function runNicheDispatch(id: string) {
  const candidate = await prisma.nicheDispatch.findUnique({ where: { id } }); if (!candidate) return;
  const claimed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dispatch:${candidate.tenantId}:${candidate.scope}`}))`;
    if (candidate.type === 'inbound' && await tx.nicheDispatch.findFirst({ where: { tenantId: candidate.tenantId, scope: candidate.scope, type: 'inbound', status: 'processing' } })) return false;
    if (candidate.type === 'inbound') {
      const first = await tx.nicheDispatch.findFirst({ where: { tenantId: candidate.tenantId, scope: candidate.scope, type: 'inbound', status: 'pending' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (first?.id !== candidate.id) return false;
    }
    const changed = await tx.nicheDispatch.updateMany({ where: { id, status: 'pending', dueAt: { lte: new Date() } }, data: { status: 'processing', attempts: { increment: 1 } } }); return changed.count === 1;
  });
  if (!claimed) return;
  let finalStatus = 'succeeded'; let providerId: string | undefined;
  try {
    const config = await getAutomationConfig(candidate.tenantId);
    if (candidate.type === 'whatsapp_setup_test_reply') {
      const payload = z.object({ phone: z.string(), receivedAt: z.string() }).parse(openAutomation(candidate.encryptedPayload, candidate.tenantId));
      if (Date.parse(payload.receivedAt) < Date.now() - 23 * 3600_000) finalStatus = 'skipped';
      else {
        providerId = await sendNicheWhatsApp(candidate.tenantId, payload.phone, { text: 'AI Workforce WhatsApp test reply: your business number received the test message and sent this response. Automatic replies are still off until you enable them.' });
        finalStatus = 'accepted';
      }
    }
    else if (!config) finalStatus = 'skipped';
    else if (candidate.type === 'inbound') {
      const turn = openAutomation<Parameters<typeof processNicheTurn>[1]>(candidate.encryptedPayload, candidate.tenantId);
      // Old inbound events must never open a new 24-hour customer-service window.
      if (Date.parse(turn.receivedAt) < Date.now() - 23 * 3600_000) finalStatus = 'skipped'; else await processNicheTurn(candidate.tenantId, turn);
    } else if (candidate.type === 'whatsapp_reply') {
      const payload = replyPayload.parse(openAutomation(candidate.encryptedPayload, candidate.tenantId));
      const session = await prisma.nicheSession.findUnique({ where: { tenantId_channel_customerHash: { tenantId: candidate.tenantId, channel: 'whatsapp', customerHash: customerHash(payload.phone) } } });
      if ((!payload.humanReply && !payload.controlReply && (!await hasSubscription(candidate.tenantId) || !await hasActiveChannelAgent(candidate.tenantId, config.kind))) || (!config.whatsappEnabled && !payload.humanReply) || (session?.paused && !payload.controlReply && !payload.humanReply) || (session?.optedOut && !payload.controlReply) || Date.parse(payload.receivedAt) < Date.now() - 23 * 3600_000) finalStatus = 'skipped';
      else { providerId = await sendNicheWhatsApp(candidate.tenantId, payload.phone, { text: payload.text }); finalStatus = 'accepted'; }
    } else if (candidate.type === 'voice_call') {
      const payload = z.object({ phone: z.string(), consentAt: z.string() }).parse(openAutomation(candidate.encryptedPayload, candidate.tenantId));
      const stopped = await prisma.nicheSession.findFirst({ where: { tenantId: candidate.tenantId, customerHash: customerHash(payload.phone), paused: true } });
      if (!config.voiceEnabled || stopped || !await hasSubscription(candidate.tenantId) || !await hasActiveChannelAgent(candidate.tenantId, config.kind) || Date.parse(payload.consentAt) < Date.now() - 10 * 60_000) finalStatus = 'skipped';
      else { providerId = await sendNicheVoiceCall(candidate.tenantId, payload.phone, candidate.id); finalStatus = 'accepted'; }
    } else if (candidate.type === 'reminder') {
      const { appointmentId } = z.object({ appointmentId: z.string().uuid() }).parse(openAutomation(candidate.encryptedPayload, candidate.tenantId));
      // Serialize against cancellation: check and send before releasing the booking lock.
      const result = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${candidate.tenantId}))`;
        const booking = await tx.scheduledAppointment.findFirst({ where: { id: appointmentId, tenantId: candidate.tenantId, status: 'confirmed', reminderConsent: true, startTime: { gt: new Date() } } });
        if (!config.remindersEnabled || !booking || !await hasSubscription(candidate.tenantId) || !await hasActiveChannelAgent(candidate.tenantId, config.kind)) return null;
        const contact = decryptAppointmentContact(booking.encryptedContact);
        if (await tx.nicheSession.findFirst({ where: { tenantId: candidate.tenantId, customerHash: customerHash(contact.phone), optedOut: true } })) return null;
        await verifyReminderTemplate(candidate.tenantId, config);
        const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: booking.timezone }).format(booking.startTime) + ` (${booking.timezone})`;
        return sendNicheWhatsApp(candidate.tenantId, contact.phone, { template: config.templateName, language: config.templateLanguage, dateTime });
      }, { timeout: 40_000, maxWait: 60_000 });
      providerId = result || undefined; finalStatus = result ? 'accepted' : 'skipped';
    } else finalStatus = 'skipped';
  } catch (error) {
    if (candidate.type === 'inbound' && candidate.attempts < 2) { await prisma.nicheDispatch.update({ where: { id }, data: { status: 'pending', dueAt: new Date(Date.now() + 30_000) } }); return; }
    finalStatus = candidate.type === 'inbound' ? 'failed' : error instanceof DispatchError && !error.uncertain ? 'failed' : 'unknown';
    logger.warn('Niche automation job requires review', { dispatchId: id, tenantId: candidate.tenantId, type: candidate.type, status: finalStatus });
  }
  await prisma.nicheDispatch.update({ where: { id }, data: { status: finalStatus, providerId } });
  if (providerId) {
    const earlyReceipt = await prisma.nicheDispatch.findUnique({ where: { tenantId_key: { tenantId: candidate.tenantId, key: `whatsapp-setup-receipt:${providerId}` } }, select: { status: true } });
    if (earlyReceipt) {
      await prisma.nicheDispatch.updateMany({ where: { id, providerId, status: 'accepted' }, data: { status: earlyReceipt.status === 'delivered' ? 'delivered' : 'failed' } });
      await prisma.nicheDispatch.deleteMany({ where: { tenantId: candidate.tenantId, key: `whatsapp-setup-receipt:${providerId}` } });
    }
  }
}
let timer: NodeJS.Timeout | undefined; let running: Promise<void> | null = null;
export async function tickNicheAutomation(options?: { limit: number; deadline: number }) {
  const expired = new Date(Date.now() - 5 * 60_000);
  await prisma.nicheDispatch.deleteMany({ where: { type: 'provider_delivery_receipt', dueAt: { lt: new Date() } } });
  await prisma.nicheDispatch.updateMany({ where: { status: 'processing', type: 'inbound', updatedAt: { lt: expired } }, data: { status: 'pending' } });
  await prisma.nicheDispatch.updateMany({ where: { status: 'processing', type: { not: 'inbound' }, updatedAt: { lt: expired } }, data: { status: 'unknown' } });
  await scheduleNicheReminders();
  const jobs = await prisma.nicheDispatch.findMany({ where: { status: 'pending', dueAt: { lte: new Date() } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: options?.limit ?? 20 });
  for (const job of jobs) { if (options && Date.now() >= options.deadline) break; await runNicheDispatch(job.id); }
}
export function startNicheAutomation() { if (timer) return; timer = setInterval(() => { if (running) return; running = tickNicheAutomation().catch(() => { logger.warn('Niche automation worker could not complete this cycle'); }).finally(() => { running = null; }); }, 5000); timer.unref(); }
export async function stopNicheAutomation() { if (timer) clearInterval(timer); timer = undefined; await running; }
