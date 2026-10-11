import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { AppError, NotFoundError } from '../errors/AppError';
import { IntegrationService } from './integrationService';
import { whatsappService, WhatsAppMessageRejectedError } from './whatsappService';

const uncertain = () => new AppError('Reply acceptance is not confirmed. Check Meta activity before sending another reply. Retrying this request will not send it again.', 409, 'REPLY_UNCERTAIN');

/** Claim once before calling Meta. Pending/unknown claims are never resent. */
export async function sendSupportReply(input: {
  tenantId: string; conversationId: string; userId: string; requestId: string; message: string;
}) {
  const { tenantId, conversationId, userId, requestId, message } = input;
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
  if (!conversation) throw new NotFoundError('Conversation not found');
  // Payload is hashed separately so the same request ID cannot send changed text.
  const idempotencyKey = `support_reply:${requestId}`;
  const where = { tenantId_idempotencyKey: { tenantId, idempotencyKey } };
  const requestHash = createHash('sha256').update(JSON.stringify({ conversationId, message })).digest('hex');
  const replay = (existing: { requestHash: string; status: string; providerRef: string | null }) => {
    if (existing.requestHash !== requestHash) throw new AppError('This reply request belongs to different text or another conversation.', 409, 'REPLY_REQUEST_MISMATCH');
    if (existing.status === 'succeeded' && existing.providerRef) return { conversationId, sentMessageId: existing.providerRef, status: 'accepted' as const, replayed: true };
    if (existing.status === 'rejected') throw new WhatsAppMessageRejectedError();
    throw uncertain();
  };
  const existing = await prisma.idempotencyLog.findUnique({ where });
  if (existing) return replay(existing);
  const { accessToken, phoneNumberId } = await IntegrationService.getWhatsAppCredential(tenantId);
  try {
    await prisma.idempotencyLog.create({ data: { tenantId, idempotencyKey, requestHash, actionType: 'support_reply', targetResource: conversationId, status: 'pending' } });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const claimed = await prisma.idempotencyLog.findUnique({ where });
    if (claimed) return replay(claimed);
    throw uncertain();
  }
  let providerRef: string | undefined;
  try {
    // Enforced server-side for every caller, not just the dashboard.
    await prisma.conversation.update({ where: { id: conversationId, tenantId }, data: { aiActive: false, assignedAgentId: userId } });
    const result = await whatsappService.sendMessage(tenantId, conversation.customerPhone, message, accessToken, phoneNumberId);
    providerRef = result.messageId;
    await prisma.$transaction(async tx => {
      await tx.message.create({ data: { tenantId, conversationId, direction: 'outbound', senderType: 'human', textContent: message, metaMessageId: result.messageId } });
      await tx.conversation.update({ where: { id: conversationId, tenantId }, data: { lastMessageAt: new Date() } });
      await tx.idempotencyLog.update({ where, data: { status: 'succeeded', providerRef: result.messageId, completedAt: new Date() } });
    });
    return { conversationId, sentMessageId: result.messageId, status: 'accepted' as const, replayed: false };
  } catch (error) {
    const rejected = error instanceof WhatsAppMessageRejectedError;
    // Even a DB failure after Meta accepts must not trigger a duplicate send.
    await prisma.idempotencyLog.update({ where, data: { status: rejected ? 'rejected' : 'unknown', providerRef, completedAt: new Date() } }).catch(() => undefined);
    if (rejected) throw error;
    throw uncertain();
  }
}
