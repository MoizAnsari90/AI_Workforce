import crypto from 'node:crypto';
import { prisma } from '../lib/prisma';
import { IntegrationService } from './integrationService';
import { openAutomation, sealAutomation } from './nicheAutomationStore';
import type { ParsedWhatsAppMessage } from './whatsappService';
import { TooManyRequestsError } from '../errors/AppError';

const TEST_WINDOW_MS = 10 * 60_000;
const normalizeHash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export async function startWhatsAppSetupTest(tenantId: string, userId: string) {
  const credential = await IntegrationService.getCredential(tenantId, 'whatsapp');
  if (typeof credential?.phoneNumberId !== 'string' || typeof credential.accessToken !== 'string') {
    throw new Error('Connect WhatsApp through Meta before starting the delivery test.');
  }
  const registration = credential.cloudRegistration as { status?: string } | undefined;
  if (!['registered', 'owner_confirmed'].includes(registration?.status || '')) {
    throw new Error('Register the Cloud API number, or confirm that it is already registered, before testing delivery.');
  }
  const recentTests = await prisma.nicheDispatch.count({ where: { tenantId, type: 'whatsapp_setup_test', createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
  if (recentTests >= 5) throw new TooManyRequestsError('Five WhatsApp setup tests have already been started this hour. Check the latest test status before trying again.');

  const code = crypto.randomBytes(6).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + TEST_WINDOW_MS);
  await prisma.nicheDispatch.updateMany({
    where: { tenantId, type: 'whatsapp_setup_test', status: 'awaiting_inbound' },
    data: { status: 'expired' },
  });
  const test = await prisma.nicheDispatch.create({ data: {
    tenantId,
    key: `whatsapp-setup-test:${crypto.randomUUID()}`,
    type: 'whatsapp_setup_test',
    status: 'awaiting_inbound',
    dueAt: expiresAt,
    encryptedPayload: sealAutomation({ codeHash: normalizeHash(code), phoneNumberId: credential.phoneNumberId }, tenantId),
  } });
  await prisma.auditLog.create({ data: {
    tenantId, actorId: userId, actorType: 'user', operation: 'whatsapp_delivery_test_started',
    entityType: 'integration', entityId: test.id,
  } });
  return { id: test.id, code: `AIWF ${code}`, phoneNumber: credential.displayPhoneNumber ?? null, expiresAt: expiresAt.toISOString(), status: 'awaiting_inbound' as const };
}

export async function consumeWhatsAppSetupTest(tenantId: string, message: ParsedWhatsAppMessage): Promise<boolean> {
  const match = /^AIWF\s+([A-F0-9]{12})$/i.exec(message.text.trim());
  if (!match || !message.phoneNumberId) return false;
  const candidateTests = await prisma.nicheDispatch.findMany({
    where: { tenantId, type: 'whatsapp_setup_test', status: { in: ['awaiting_inbound', 'inbound_received', 'expired'] }, createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { createdAt: 'desc' }, take: 20,
  });
  const hash = normalizeHash(match[1].toUpperCase());
  for (const test of candidateTests) {
    const stored = openAutomation<{ codeHash: string; phoneNumberId: string }>(test.encryptedPayload, tenantId);
    const left = Buffer.from(stored.codeHash); const right = Buffer.from(hash);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right) || stored.phoneNumberId !== message.phoneNumberId) continue;
    if (test.status === 'expired') return true;
    if (test.status === 'inbound_received') return true;
    const claimed = await prisma.$transaction(async tx => {
      const updated = await tx.nicheDispatch.updateMany({
        where: { id: test.id, tenantId, status: 'awaiting_inbound', dueAt: { gt: new Date() } },
        data: { status: 'inbound_received' },
      });
      if (updated.count !== 1) return false;
      await tx.nicheDispatch.create({ data: {
        tenantId, key: `whatsapp-setup-test-reply:${test.id}`, type: 'whatsapp_setup_test_reply',
        scope: crypto.createHash('sha256').update(message.fromPhone).digest('hex'),
        encryptedPayload: sealAutomation({ phone: message.fromPhone, receivedAt: message.timestamp }, tenantId),
      } });
      return true;
    });
    // If another webhook delivery claimed the same one-time challenge first,
    // consume this duplicate instead of handing the test phrase to the AI inbox.
    return claimed || test.status === 'awaiting_inbound';
  }
  return false;
}

export async function getWhatsAppSetupTestStatus(tenantId: string) {
  const latest = await prisma.nicheDispatch.findFirst({
    where: { tenantId, type: 'whatsapp_setup_test' }, orderBy: { createdAt: 'desc' },
  });
  if (!latest) return { status: 'not_started', inboundReceived: false, replyStatus: null, checkedAt: new Date().toISOString() };
  let status = latest.status;
  if (status === 'awaiting_inbound' && latest.dueAt <= new Date()) {
    await prisma.nicheDispatch.updateMany({ where: { id: latest.id, status: 'awaiting_inbound' }, data: { status: 'expired' } });
    status = 'expired';
  }
  const reply = await prisma.nicheDispatch.findUnique({ where: { tenantId_key: { tenantId, key: `whatsapp-setup-test-reply:${latest.id}` } }, select: { status: true, providerId: true, updatedAt: true } });
  const deliveredAt = status === 'inbound_received' && reply?.status === 'delivered' ? reply.updatedAt : null;
  return {
    id: latest.id,
    status: deliveredAt ? 'passed' : status,
    inboundReceived: ['inbound_received', 'passed'].includes(deliveredAt ? 'passed' : status),
    replyStatus: reply?.status ?? null,
    providerMessageId: reply?.providerId ?? null,
    startedAt: latest.createdAt.toISOString(),
    expiresAt: latest.dueAt.toISOString(),
    deliveredAt: deliveredAt?.toISOString() ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export async function hasRecentWhatsAppDeliveryProof(tenantId: string, maxAgeMs = 30 * 86_400_000) {
  const credential = await IntegrationService.getCredential(tenantId, 'whatsapp');
  if (typeof credential?.phoneNumberId !== 'string') return false;
  const since = new Date(Date.now() - maxAgeMs);
  const tests = await prisma.nicheDispatch.findMany({
    where: { tenantId, type: 'whatsapp_setup_test', status: 'inbound_received', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, encryptedPayload: true, createdAt: true },
  });
  for (const test of tests) {
    const payload = openAutomation<{ phoneNumberId: string }>(test.encryptedPayload, tenantId);
    if (payload.phoneNumberId !== credential.phoneNumberId) continue;
    const reply = await prisma.nicheDispatch.findUnique({
      where: { tenantId_key: { tenantId, key: `whatsapp-setup-test-reply:${test.id}` } },
      select: { status: true },
    });
    if (reply?.status === 'delivered') return true;
  }
  return false;
}
