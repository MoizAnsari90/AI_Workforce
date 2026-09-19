import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';

export interface VoiceWebhookPayload {
  provider: 'VAPI' | 'RETELL';
  callId: string;
  callerPhone?: string;
  status: string; // 'initiated' | 'active' | 'completed' | 'failed'
  transcript?: Array<{ speaker: 'agent' | 'user'; text: string; timestamp?: string }>;
  metadata?: Record<string, unknown>;
}

export class VoiceService {
  static async handleWebhook(tenantId: string, payload: VoiceWebhookPayload) {
    logger.info('Received voice agent webhook event', { tenantId, provider: payload.provider, callId: payload.callId, status: payload.status });

    // 1. Verify tenant exists
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // 2. Upsert VoiceSession record
    const voiceSession = await prisma.voiceSession.upsert({
      where: { callId: payload.callId },
      update: {
        status: payload.status,
        transcript: payload.transcript ? (payload.transcript as any) : undefined,
        metadata: payload.metadata ? (payload.metadata as any) : undefined,
      },
      create: {
        tenantId,
        provider: payload.provider,
        callId: payload.callId,
        status: payload.status,
        transcript: payload.transcript ? (payload.transcript as any) : [],
        metadata: payload.metadata ? (payload.metadata as any) : {},
      },
    });

    // 3. Record audit log
    await recordAuditLog({
      tenantId,
      actorType: 'system',
      actorId: `voice_agent_${payload.provider.toLowerCase()}`,
      operation: 'voice_session_update',
      entityType: 'voice_session',
      entityId: voiceSession.id,
      newValue: { callId: payload.callId, status: payload.status },
    });

    // 4. If call completed, check intent and route if necessary
    let automatedResponse = null;
    if (payload.status === 'completed' && payload.transcript) {
      automatedResponse = VoiceService.analyzeIntentAndRoute(payload.transcript);
    }

    return {
      success: true,
      sessionId: voiceSession.id,
      callId: payload.callId,
      status: voiceSession.status,
      routingDecision: automatedResponse,
    };
  }

  private static analyzeIntentAndRoute(transcript: Array<{ speaker: string; text: string }>) {
    const fullText = transcript.map(t => t.text).join(' ').toLowerCase();
    if (fullText.includes('refund') || fullText.includes('cancel')) {
      return { intent: 'REFUND_REQUEST', suggestedAction: 'shopify_refund' };
    }
    if (fullText.includes('book') || fullText.includes('schedule') || fullText.includes('tour')) {
      return { intent: 'APPOINTMENT_BOOKING', suggestedAction: 'crm_pipeline' };
    }
    return { intent: 'GENERAL_INQUIRY', suggestedAction: 'support_faq' };
  }
}
