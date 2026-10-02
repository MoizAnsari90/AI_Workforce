import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { faqService } from './faqService';
import { ragService } from './ragService';
import { llmService } from './llmService';
import { whatsappService, ParsedWhatsAppMessage } from './whatsappService';
import { conversationService } from './conversationService';
import { recordAuditLog } from './auditService';
import { emitToTenant } from '../lib/socket';
import { answerWorkforceStockQuestion } from './workforceStockService';

export interface SupportAgentProcessResult {
  conversationId: string;
  messageStored: boolean;
  aiActive: boolean;
  responseSource: 'faq' | 'rag' | 'llm' | 'fallback' | 'shopify' | 'woocommerce' | 'clarification' | 'human_inbox' | 'skipped';
  escalated: boolean;
  sentMessageId?: string;
}

export const supportAgentService = {
  /**
   * Convenience wrapper for script testing
   */
  async processMessage(params: {
    tenantId: string;
    userMessage: string;
    fromPhone?: string;
    customerName?: string;
  }): Promise<SupportAgentProcessResult> {
    const message: ParsedWhatsAppMessage = {
      metaMessageId: 'wamid.test.' + Date.now(),
      fromPhone: params.fromPhone || '923001234567',
      customerName: params.customerName || 'Test User',
      text: params.userMessage,
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    return this.processInboundMessage(params.tenantId, message);
  },

  /**
   * Main entry point called by the BullMQ worker for every inbound WhatsApp message.
   * Orchestrates: conversation upsert → message store → FAQ → RAG → LLM → send → audit.
   */
  async processInboundMessage(
    tenantId: string,
    message: ParsedWhatsAppMessage,
  ): Promise<SupportAgentProcessResult> {
    // 1. Fetch business config for this tenant (tone/instructions, WhatsApp credentials)
    const business = await prisma.business.findFirst({
      where: { tenantId },
    });

    // 2. Get or create conversation
    const conversation = await conversationService.getOrCreate(
      tenantId,
      message.fromPhone,
      message.customerName,
    );

    // 3. Store inbound message
    await conversationService.recordInbound(
      tenantId,
      conversation.id,
      message.text,
      message.metaMessageId,
    );

    // 4. Audit: message received
    await recordAuditLog({
      tenantId,
      actorType: 'system',
      actorId: 'support-agent',
      operation: 'message_received',
      entityType: 'conversation',
      entityId: conversation.id,
      newValue: {
        fromPhone: message.fromPhone,
        metaMessageId: message.metaMessageId,
        textPreview: message.text.substring(0, 80),
      },
    });

    // 5. Emit real-time event so live dashboard shows incoming message
    emitToTenant(tenantId, 'message:new', {
      conversationId: conversation.id,
      direction: 'inbound',
      senderType: 'customer',
      textContent: message.text,
      customerPhone: message.fromPhone,
    });

    // 6. If AI is inactive (human takeover), route to human inbox only
    if (!conversation.aiActive) {
      logger.info('AI inactive for conversation, routing to human inbox', {
        tenantId,
        conversationId: conversation.id,
        customerPhone: message.fromPhone,
      });

      emitToTenant(tenantId, 'conversation:human_inbox', {
        conversationId: conversation.id,
        customerPhone: message.fromPhone,
        customerName: conversation.customerName,
        message: message.text,
      });

      return {
        conversationId: conversation.id,
        messageStored: true,
        aiActive: false,
        responseSource: 'human_inbox',
        escalated: false,
      };
    }

    // 7. Build conversation history for LLM context (last 10 messages)
    const conversationHistory = conversation.messages.slice(-10).map((m) => ({
      senderType: m.senderType,
      textContent: m.textContent,
    }));

    // 8. Use verified live commerce data for SKU stock questions on WhatsApp.
    const stockAnswer = await answerWorkforceStockQuestion(tenantId, message.text);

    // 9. For other questions, continue through FAQ, RAG and the support model.
    let result: { responseText: string; source: SupportAgentProcessResult['responseSource']; confidence: number; shouldEscalate: boolean; escalationReason?: string };
    if (stockAnswer) {
      result = { responseText: stockAnswer.answer, source: stockAnswer.source as SupportAgentProcessResult['responseSource'], confidence: 1, shouldEscalate: false };
    } else {
      const faqMatch = await faqService.matchFAQ(tenantId, message.text);
      const ragChunks = !faqMatch || faqMatch.similarityScore < 0.95
        ? await ragService.retrieveChunks(tenantId, message.text, 3)
        : [];
      result = await llmService.generateSupportResponse({
        tenantId,
        userMessage: message.text,
        conversationHistory,
        faqMatch,
        ragChunks,
        brandVoiceGuide: business?.brandVoiceGuide ?? undefined,
      });
    }

    // 11. If escalation triggered, pause AI and notify human inbox
    if (result.shouldEscalate) {
      await conversationService.pauseAI(tenantId, conversation.id);

      emitToTenant(tenantId, 'conversation:escalated', {
        conversationId: conversation.id,
        customerPhone: message.fromPhone,
        customerName: conversation.customerName,
        reason: result.escalationReason,
      });

      await recordAuditLog({
        tenantId,
        actorType: 'agent',
        actorId: 'support-agent',
        operation: 'ai_escalated',
        entityType: 'conversation',
        entityId: conversation.id,
        newValue: {
          escalationReason: result.escalationReason,
          responseSource: result.source,
        },
      });
    }

    // 12. Send response via WhatsApp
    const { IntegrationService } = await import('./integrationService');
    const { accessToken, phoneNumberId } = await IntegrationService.getWhatsAppCredential(tenantId);

    const { messageId: sentMessageId } = await whatsappService.sendMessage(
      tenantId,
      message.fromPhone,
      result.responseText,
      accessToken,
      phoneNumberId,
    );

    // 13. Store outbound message
    await conversationService.recordOutbound(
      tenantId,
      conversation.id,
      result.responseText,
      'ai',
      sentMessageId,
    );

    // 14. Emit outbound event
    emitToTenant(tenantId, 'message:new', {
      conversationId: conversation.id,
      direction: 'outbound',
      senderType: 'ai',
      textContent: result.responseText,
    });

    // 15. Audit: response sent
    await recordAuditLog({
      tenantId,
      actorType: 'agent',
      actorId: 'support-agent',
      operation: 'ai_response_sent',
      entityType: 'conversation',
      entityId: conversation.id,
      newValue: {
        source: result.source,
        confidence: result.confidence,
        escalated: result.shouldEscalate,
        sentMessageId,
      },
    });

    logger.info('Support agent processed inbound message', {
      tenantId,
      conversationId: conversation.id,
      responseSource: result.source,
      confidence: result.confidence,
      escalated: result.shouldEscalate,
    });

    return {
      conversationId: conversation.id,
      messageStored: true,
      aiActive: !result.shouldEscalate,
      responseSource: result.source,
      escalated: result.shouldEscalate,
      sentMessageId,
    };
  },
};
