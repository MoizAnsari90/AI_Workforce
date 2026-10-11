import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  rows: new Map<string, any>(), send: vi.fn(), credential: vi.fn(),
  findConversation: vi.fn(), updateConversation: vi.fn(), findCursor: vi.fn(), createMessage: vi.fn(),
  transactionFails: false,
}));
vi.mock('../src/lib/prisma', () => {
  const db = {
    conversation: { findFirst: mock.findConversation, update: mock.updateConversation },
    message: { findFirst: mock.findCursor, create: mock.createMessage },
    idempotencyLog: {
      findUnique: vi.fn(async ({ where }: any) => mock.rows.get(JSON.stringify(where.tenantId_idempotencyKey)) || null),
      create: vi.fn(async ({ data }: any) => {
        const key = JSON.stringify({ tenantId: data.tenantId, idempotencyKey: data.idempotencyKey });
        if (mock.rows.has(key)) throw Object.assign(new Error('Unique claim'), { code: 'P2002' });
        const row = { ...data, providerRef: null }; mock.rows.set(key, row); return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = mock.rows.get(JSON.stringify(where.tenantId_idempotencyKey));
        Object.assign(row, data); return row;
      }),
    },
    $transaction: async (fn: any) => { if (mock.transactionFails) throw new Error('Commit unavailable'); return fn(db); },
  };
  return { prisma: db };
});
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getWhatsAppCredential: mock.credential } }));
vi.mock('../src/services/whatsappService', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/services/whatsappService')>();
  return { ...actual, whatsappService: { ...actual.whatsappService, sendMessage: mock.send } };
});
import { sendSupportReply } from '../src/services/supportReplyService';
import { conversationService } from '../src/services/conversationService';
import { WhatsAppDeliveryUncertainError, WhatsAppMessageRejectedError } from '../src/services/whatsappService';

const input = { tenantId: 'tenant-a', conversationId: 'conversation-a', userId: 'staff-a', requestId: 'request-a', message: 'Hello customer' };
beforeEach(() => {
  vi.clearAllMocks(); mock.rows.clear(); mock.transactionFails = false;
  mock.findConversation.mockResolvedValue({ id: input.conversationId, customerPhone: '+15550000001' });
  mock.updateConversation.mockResolvedValue({}); mock.createMessage.mockResolvedValue({});
  mock.credential.mockResolvedValue({ accessToken: 'test', phoneNumberId: 'test-number' });
  mock.send.mockResolvedValue({ messageId: 'wamid.accepted' });
  mock.findCursor.mockResolvedValue(null);
});

describe('Staff reply reliability', () => {
  it('replays provider acceptance without sending or storing a second message', async () => {
    expect(await sendSupportReply(input)).toMatchObject({ status: 'accepted', replayed: false });
    expect(await sendSupportReply(input)).toMatchObject({ sentMessageId: 'wamid.accepted', replayed: true });
    expect(mock.send).toHaveBeenCalledTimes(1); expect(mock.createMessage).toHaveBeenCalledTimes(1);
    expect(mock.updateConversation).toHaveBeenCalledWith(expect.objectContaining({ where: { id: input.conversationId, tenantId: input.tenantId }, data: { aiActive: false, assignedAgentId: input.userId } }));
  });
  it('concurrent requests make only one provider call', async () => {
    const results = await Promise.allSettled([sendSupportReply(input), sendSupportReply(input)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(mock.send).toHaveBeenCalledTimes(1); expect(mock.createMessage).toHaveBeenCalledTimes(1);
  });
  it('blocks a reused request ID with changed text or conversation', async () => {
    await sendSupportReply(input);
    await expect(sendSupportReply({ ...input, message: 'Different reply' })).rejects.toMatchObject({ code: 'REPLY_REQUEST_MISMATCH' });
    await expect(sendSupportReply({ ...input, conversationId: 'another-conversation' })).rejects.toMatchObject({ code: 'REPLY_REQUEST_MISMATCH' });
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it('keeps the same request ID isolated between workspaces', async () => {
    await sendSupportReply(input); await sendSupportReply({ ...input, tenantId: 'tenant-b' });
    expect(mock.send).toHaveBeenCalledTimes(2);
  });
  it('rejects foreign or missing conversations before contacting a provider', async () => {
    mock.findConversation.mockResolvedValue(null);
    await expect(sendSupportReply(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mock.send).not.toHaveBeenCalled(); expect(mock.rows.size).toBe(0);
  });
  it('does not resend after an uncertain network/provider result', async () => {
    mock.send.mockRejectedValueOnce(new WhatsAppDeliveryUncertainError());
    await expect(sendSupportReply(input)).rejects.toMatchObject({ code: 'REPLY_UNCERTAIN' });
    await expect(sendSupportReply(input)).rejects.toMatchObject({ code: 'REPLY_UNCERTAIN' });
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it('does not resend if persistence fails after provider acceptance', async () => {
    mock.transactionFails = true;
    await expect(sendSupportReply(input)).rejects.toMatchObject({ code: 'REPLY_UNCERTAIN' });
    mock.transactionFails = false;
    await expect(sendSupportReply(input)).rejects.toMatchObject({ code: 'REPLY_UNCERTAIN' });
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect([...mock.rows.values()][0]).toMatchObject({ status: 'unknown', providerRef: 'wamid.accepted' });
  });
  it('distinguishes an explicit provider rejection from an unknown send', async () => {
    mock.send.mockRejectedValueOnce(new WhatsAppMessageRejectedError());
    await expect(sendSupportReply(input)).rejects.toMatchObject({ code: 'REPLY_REJECTED' });
    await expect(sendSupportReply(input)).rejects.toMatchObject({ code: 'REPLY_REJECTED' });
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it('allows the same request after fixing credentials when nothing was sent', async () => {
    mock.credential.mockRejectedValueOnce(new Error('No connection'));
    await expect(sendSupportReply(input)).rejects.toThrow('No connection');
    expect(mock.rows.size).toBe(0);
    await sendSupportReply(input); expect(mock.send).toHaveBeenCalledTimes(1);
  });
});

describe('Conversation history', () => {
  it('shows the most recent 50 in chronological order and exposes older history', async () => {
    mock.findConversation.mockResolvedValue({ id: 'conversation-a', messages: Array.from({ length: 51 }, (_, i) => ({ id: String(100 - i) })) });
    const result = await conversationService.findByIdForTenant('tenant-a', 'conversation-a');
    expect(result?.messages.map(message => message.id)).toEqual(Array.from({ length: 50 }, (_, i) => String(51 + i)));
    expect(result?.olderMessagesCursor).toBe('51');
    expect(mock.findConversation).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'conversation-a', tenantId: 'tenant-a' }, include: { messages: { where: { tenantId: 'tenant-a' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51 } } }));
  });
  it('rejects a cursor from another tenant or conversation', async () => {
    await expect(conversationService.findByIdForTenant('tenant-a', 'conversation-a', 'foreign-message')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mock.findCursor).toHaveBeenCalledWith({ where: { id: 'foreign-message', tenantId: 'tenant-a', conversationId: 'conversation-a' } });
    expect(mock.findConversation).not.toHaveBeenCalled();
  });
  it('pages older messages using timestamp and ID without overlapping the boundary', async () => {
    const createdAt = new Date('2026-10-07T12:00:00Z');
    mock.findCursor.mockResolvedValue({ id: 'boundary', createdAt });
    mock.findConversation.mockResolvedValue({ messages: [{ id: 'older' }] });
    const result = await conversationService.findByIdForTenant('tenant-a', 'conversation-a', 'boundary');
    expect(result?.olderMessagesCursor).toBeNull();
    expect(mock.findConversation.mock.calls[0][0].include.messages.where.OR).toEqual([{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: 'boundary' } }]);
  });
});
