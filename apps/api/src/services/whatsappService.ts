import crypto from 'node:crypto';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface ParsedWhatsAppMessage {
  metaMessageId: string;
  fromPhone: string;
  customerName?: string;
  text: string;
  phoneNumberId?: string;
  timestamp: string;
}

export interface SentMessageRecord {
  tenantId: string;
  toPhone: string;
  text: string;
  messageId: string;
  sentAt: Date;
}

// In-memory record of sent messages (used for verification and test assertions)
const mockSentMessages: SentMessageRecord[] = [];

export const whatsappService = {
  /**
   * Verify Meta webhook challenge (GET request)
   */
  verifyWebhook(mode?: string, token?: string, challenge?: string): string | null {
    if (mode === 'subscribe' && token === env.META_VERIFY_TOKEN && challenge) {
      logger.info('Meta webhook verified successfully');
      return challenge;
    }
    logger.warn('Meta webhook verification failed: token mismatch or missing challenge', {
      mode,
    });
    return null;
  },

  verifySignature(rawBody: Buffer | string | undefined, signatureHeader?: string): boolean {
    if (!rawBody) {
      return env.NODE_ENV === 'test';
    }

    if (!signatureHeader) {
      return env.NODE_ENV === 'test';
    }

    const secret = env.META_APP_SECRET;
    if (!secret) {
      logger.error('META_APP_SECRET is not configured');
      return false;
    }
    const bodyBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const expectedSignature = `sha256=${crypto.createHmac('sha256', secret).update(bodyBuffer).digest('hex')}`;
    const providedSignature = Buffer.from(signatureHeader);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (providedSignature.length !== expectedBuffer.length) return false;

    const isValid = crypto.timingSafeEqual(providedSignature, expectedBuffer);
    return isValid;
  },

  /**
   * Parse incoming webhook payload from Meta Cloud API
   */
  parseWebhookPayload(payload: any): ParsedWhatsAppMessage[] {
    const messages: ParsedWhatsAppMessage[] = [];

    if (!payload || !payload.entry || !Array.isArray(payload.entry)) {
      return messages;
    }

    for (const entry of payload.entry) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        const contacts = value.contacts || [];
        const contactMap = new Map<string, string>();
        for (const c of contacts) {
          if (c.wa_id && c.profile?.name) {
            contactMap.set(c.wa_id, c.profile.name);
          }
        }

        for (const msg of value.messages || []) {
          if (msg.type === 'text' && msg.text?.body) {
            messages.push({
              metaMessageId: msg.id,
              fromPhone: msg.from,
              customerName: contactMap.get(msg.from) || undefined,
              text: msg.text.body,
              phoneNumberId,
              timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
            });
          }
        }
      }
    }

    return messages;
  },

  /**
   * Send WhatsApp message via Meta Cloud API or mock client
   */
  async sendMessage(
    tenantId: string,
    toPhone: string,
    text: string,
    accessToken?: string,
    phoneNumberId?: string,
  ): Promise<{ success: boolean; messageId: string }> {
    const mockMessageId = `wamid.mock.${Date.now()}.${Math.random().toString(36).substring(7)}`;

    // Resolve account credentials by tenant. Platform-wide credentials must not
    // be used to send one tenant's message from another tenant's number.
    let resolvedToken = accessToken;
    let resolvedPhoneNumberId = phoneNumberId;
    if ((!resolvedToken || !resolvedPhoneNumberId) && env.NODE_ENV !== 'test') {
      const { IntegrationService } = await import('./integrationService');
      const tenantCredential = await IntegrationService.getWhatsAppCredential(tenantId);
      resolvedToken ||= tenantCredential.accessToken;
      resolvedPhoneNumberId ||= tenantCredential.phoneNumberId;
    }
    if (env.NODE_ENV !== 'production') {
      resolvedToken ||= env.META_ACCESS_TOKEN;
      resolvedPhoneNumberId ||= env.META_PHONE_NUMBER_ID;
    }
    if (env.NODE_ENV === 'production' && (!resolvedToken || !resolvedPhoneNumberId)) {
      throw new Error('This workspace has no connected WhatsApp Business number');
    }

    // If live credentials exist, send to Meta Cloud API (in dev/prod when credentials are configured, skipping only in automated test suite)
    if (resolvedToken && resolvedPhoneNumberId && env.NODE_ENV !== 'test') {
      try {
        const url = `https://graph.facebook.com/${env.META_GRAPH_API_VERSION || 'v26.0'}/${resolvedPhoneNumberId}/messages`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resolvedToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toPhone,
            type: 'text',
            text: { body: text },
          }),
        });

        const data = await response.json() as { messages?: Array<{ id?: string }>; error?: unknown };
        if (!response.ok) {
          throw new Error(`Meta API error: ${JSON.stringify(data)}`);
        }

        const realMessageId = (data.messages?.[0]?.id) || mockMessageId;
        logger.info('WhatsApp message delivered via Meta Cloud API', {
          tenantId,
          toPhone,
          messageId: realMessageId,
        });

        return { success: true, messageId: realMessageId };
      } catch (error) {
        logger.error('Failed to send message via Meta Cloud API', {
          error: error instanceof Error ? error.message : String(error),
          toPhone,
          tenantId,
        });
        throw error;
      }
    }

    // Default: Mock dispatch (for test/dev environments)
    const record: SentMessageRecord = {
      tenantId,
      toPhone,
      text,
      messageId: mockMessageId,
      sentAt: new Date(),
    };
    mockSentMessages.push(record);

    logger.info('WhatsApp message dispatched (mock/sandbox)', {
      tenantId,
      toPhone,
      messageId: mockMessageId,
      textPreview: text.substring(0, 50),
    });

    return { success: true, messageId: mockMessageId };
  },

  getSentMessages(tenantId?: string): SentMessageRecord[] {
    if (tenantId) {
      return mockSentMessages.filter((m) => m.tenantId === tenantId);
    }
    return [...mockSentMessages];
  },

  clearMockSentMessages() {
    mockSentMessages.length = 0;
  },
};
