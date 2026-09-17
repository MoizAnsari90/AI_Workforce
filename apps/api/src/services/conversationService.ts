import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

export interface ConversationWithMessages {
  id: string;
  tenantId: string;
  customerPhone: string;
  customerName: string | null;
  channel: string;
  aiActive: boolean;
  assignedAgentId: string | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    tenantId: string;
    conversationId: string;
    direction: string;
    senderType: string;
    textContent: string;
    metaMessageId: string | null;
    createdAt: Date;
  }>;
}

export const conversationService = {
  /**
   * Find or create a conversation for a given tenant+phone.
   * Updates customerName if provided and different from stored.
   */
  async getOrCreate(
    tenantId: string,
    customerPhone: string,
    customerName?: string,
  ): Promise<ConversationWithMessages> {
    const payload = {
      tenantId,
      customerPhone,
      customerName: customerName ?? null,
      channel: 'whatsapp',
      aiActive: true,
    };

    const conversation = await prisma.conversation.upsert({
      where: { tenantId_customerPhone: { tenantId, customerPhone } },
      update: {
        ...(customerName ? { customerName } : {}),
        updatedAt: new Date(),
      },
      create: payload,
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 20,
        },
      },
    });

    if (!conversation.createdAt) {
      logger.info('New conversation created', {
        tenantId,
        conversationId: conversation.id,
        customerPhone,
      });
    }

    return conversation;
  },

  /**
   * Append an inbound (customer) message to the conversation.
   */
  async recordInbound(
    tenantId: string,
    conversationId: string,
    text: string,
    metaMessageId?: string,
  ) {
    const [message] = await Promise.all([
      prisma.message.create({
        data: {
          tenantId,
          conversationId,
          direction: 'inbound',
          senderType: 'customer',
          textContent: text,
          metaMessageId: metaMessageId ?? null,
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
  },

  /**
   * Append an outbound (AI or human agent) message to the conversation.
   */
  async recordOutbound(
    tenantId: string,
    conversationId: string,
    text: string,
    senderType: 'ai' | 'human',
    metaMessageId?: string,
  ) {
    const [message] = await Promise.all([
      prisma.message.create({
        data: {
          tenantId,
          conversationId,
          direction: 'outbound',
          senderType,
          textContent: text,
          metaMessageId: metaMessageId ?? null,
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
  },

  /**
   * Pause AI for a conversation (human takeover).
   * Returns the updated conversation or null if not owned by tenant.
   */
  async pauseAI(tenantId: string, conversationId: string, assignedAgentId?: string) {
    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!existing) {
      logger.warn('pauseAI rejected — conversation not owned by tenant', {
        tenantId,
        conversationId,
      });
      return null;
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        aiActive: false,
        assignedAgentId: assignedAgentId ?? null,
        updatedAt: new Date(),
      },
    });

    logger.info('AI paused for conversation', {
      tenantId,
      conversationId,
      assignedAgentId,
    });

    return conversation;
  },

  /**
   * Resume AI for a conversation.
   * Returns the updated conversation or null if not owned by tenant.
   */
  async resumeAI(tenantId: string, conversationId: string) {
    const existing = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
    });
    if (!existing) {
      logger.warn('resumeAI rejected — conversation not owned by tenant', {
        tenantId,
        conversationId,
      });
      return null;
    }

    const conversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        aiActive: true,
        assignedAgentId: null,
        updatedAt: new Date(),
      },
    });

    logger.info('AI resumed for conversation', {
      tenantId,
      conversationId,
    });

    return conversation;
  },

  /**
   * Fetch a conversation by ID with tenant isolation enforced.
   */
  async findByIdForTenant(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationWithMessages | null> {
    return prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, take: 50 },
      },
    });
  },

  /**
   * List conversations for a tenant (human inbox).
   */
  async listForTenant(tenantId: string, aiActiveFilter?: boolean) {
    return prisma.conversation.findMany({
      where: {
        tenantId,
        ...(aiActiveFilter !== undefined ? { aiActive: aiActiveFilter } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
    });
  },
};
