import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { whatsappService } from '../src/services/whatsappService';
import { queueService } from '../src/services/queueService';
import { supportAgentService } from '../src/services/supportAgentService';
import { conversationService } from '../src/services/conversationService';

// ---------------------------------------------------------------------------
// Phase 2 — Support AI Employee: AI/Human Handoff Tests
// ---------------------------------------------------------------------------

let tenantId = '';
let authToken = '';
let conversationId = '';

const customerPhone = '+15550000001';

beforeAll(async () => {
  // Register a tenant for these tests
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      tenantName: `Support Agent Test ${Date.now()}`,
      email: `support-${Date.now()}@test.com`,
      password: 'Password123!',
    });

  tenantId = res.body.data.tenant.id;
  authToken = res.body.data.token;

  // Seed an FAQ
  await prisma.fAQ.create({
    data: {
      tenantId,
      question: 'What are your opening hours?',
      answer: 'We are open Monday to Friday, 9am to 6pm.',
      isActive: true,
    },
  });

  // Clear mock sent messages
  whatsappService.clearMockSentMessages();
});

afterAll(async () => {
  // Clean up test data
  await prisma.conversation.deleteMany({ where: { tenantId } });
  await prisma.fAQ.deleteMany({ where: { tenantId } });
  await prisma.auditLog.deleteMany({ where: { tenantId } });
});

describe('Webhook Verification', () => {
  it('verifies Meta webhook challenge correctly', async () => {
    const res = await request(app)
      .get(`/api/v1/webhook/${tenantId}/whatsapp`)
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test_verify_token',
        'hub.challenge': 'challenge_abc123',
      });

    expect(res.status).toBe(200);
    expect(res.text).toBe('challenge_abc123');
  });

  it('rejects webhook verification with wrong token', async () => {
    const res = await request(app)
      .get(`/api/v1/webhook/${tenantId}/whatsapp`)
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': 'challenge_xyz',
      });

    expect(res.status).toBe(403);
  });

  it('rejects inbound webhook payloads with invalid Meta signature', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'phone_123' },
                contacts: [{ wa_id: '+15550000011', profile: { name: 'Hostile Actor' } }],
                messages: [
                  {
                    id: 'wamid.bad.signature',
                    from: '+15550000011',
                    type: 'text',
                    text: { body: 'This should not be accepted' },
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post(`/api/v1/webhook/${tenantId}/whatsapp`)
      .set('x-hub-signature-256', 'sha256=not_a_real_signature')
      .send(payload);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/signature|webhook/i);
  });
});

describe('Webhook Fast Acknowledgement', () => {
  it('responds 200 immediately to inbound webhook payload', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: 'phone_123' },
                contacts: [{ wa_id: customerPhone, profile: { name: 'Test Customer' } }],
                messages: [
                  {
                    id: `wamid.test.${Date.now()}`,
                    from: customerPhone,
                    type: 'text',
                    text: { body: 'What are your opening hours?' },
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await request(app)
      .post(`/api/v1/webhook/${tenantId}/whatsapp`)
      .send(payload);

    // Fast ack — no waiting for processing
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
  });
});

describe('Support Agent Message Processing', () => {
  it('processes FAQ match and sends a response', async () => {
    whatsappService.clearMockSentMessages();

    const message = {
      metaMessageId: `wamid.faq.${Date.now()}`,
      fromPhone: customerPhone,
      customerName: 'FAQ Test Customer',
      text: 'What are your opening hours?',
      timestamp: new Date().toISOString(),
    };

    const result = await supportAgentService.processInboundMessage(tenantId, message);

    // Store conversationId for later tests
    conversationId = result.conversationId;

    expect(result.messageStored).toBe(true);
    expect(result.aiActive).toBe(true);
    expect(result.responseSource).toBe('faq');
    expect(result.escalated).toBe(false);
    expect(result.sentMessageId).toBeDefined();

    // Verify mock WhatsApp message was dispatched
    const sent = whatsappService.getSentMessages(tenantId);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const lastSent = sent[sent.length - 1];
    expect(lastSent.toPhone).toBe(customerPhone);
    expect(lastSent.text).toContain('Monday to Friday');
  });

  it('stores inbound and outbound messages in the conversation', async () => {
    const conversation = await conversationService.findByIdForTenant(tenantId, conversationId);

    expect(conversation).not.toBeNull();
    expect(conversation!.messages.length).toBeGreaterThanOrEqual(2);

    const inbound = conversation!.messages.find((m) => m.direction === 'inbound');
    const outbound = conversation!.messages.find((m) => m.direction === 'outbound');

    expect(inbound).toBeDefined();
    expect(inbound!.senderType).toBe('customer');
    expect(outbound).toBeDefined();
    expect(outbound!.senderType).toBe('ai');
  });

  it('escalates risky messages and pauses AI automatically', async () => {
    const escalationPhone = '+15550000002';
    whatsappService.clearMockSentMessages();

    const message = {
      metaMessageId: `wamid.escalate.${Date.now()}`,
      fromPhone: escalationPhone,
      customerName: 'Risky Customer',
      text: 'I want a refund immediately',
      timestamp: new Date().toISOString(),
    };

    const result = await supportAgentService.processInboundMessage(tenantId, message);

    expect(result.escalated).toBe(true);
    expect(result.aiActive).toBe(false);
    expect(result.responseSource).toBe('fallback');

    // Confirm conversation's aiActive is now false in DB
    const conversation = await conversationService.findByIdForTenant(tenantId, result.conversationId);
    expect(conversation!.aiActive).toBe(false);
  });

  it('routes subsequent messages to human inbox when AI is inactive', async () => {
    // Get the escalated conversation
    const conversations = await conversationService.listForTenant(tenantId, false);
    const humanConv = conversations.find((c) => c.customerPhone === '+15550000002');
    expect(humanConv).toBeDefined();

    // Send another message to the paused conversation
    const message = {
      metaMessageId: `wamid.human.${Date.now()}`,
      fromPhone: '+15550000002',
      text: 'Is anyone there?',
      timestamp: new Date().toISOString(),
    };

    const result = await supportAgentService.processInboundMessage(tenantId, message);

    expect(result.responseSource).toBe('human_inbox');
    expect(result.aiActive).toBe(false);
  });
});

describe('AI Pause / Resume (Human Takeover)', () => {
  it('human can manually pause AI for a conversation', async () => {
    // Ensure conversation has AI active
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiActive: true, assignedAgentId: null },
    });

    const res = await request(app)
      .post(`/api/v1/tenants/${tenantId}/conversations/${conversationId}/pause-ai`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.aiActive).toBe(false);

    // Verify in DB
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv!.aiActive).toBe(false);
  });

  it('human can resume AI for a conversation', async () => {
    const res = await request(app)
      .post(`/api/v1/tenants/${tenantId}/conversations/${conversationId}/resume-ai`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.aiActive).toBe(true);

    // Verify in DB
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    expect(conv!.aiActive).toBe(true);
  });
});

describe('Human Reply', () => {
  it('human agent can send a reply to a conversation', async () => {
    // Pause AI first
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiActive: false },
    });

    whatsappService.clearMockSentMessages();

    const res = await request(app)
      .post(`/api/v1/tenants/${tenantId}/conversations/${conversationId}/reply`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ message: 'Hi there! A human agent is here to help you.' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.conversationId).toBe(conversationId);

    // Verify message was stored as human outbound
    const conversation = await conversationService.findByIdForTenant(tenantId, conversationId);
    const humanMessages = conversation!.messages.filter(
      (m) => m.senderType === 'human' && m.direction === 'outbound',
    );
    expect(humanMessages.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Conversation List — Human Inbox', () => {
  it('returns all conversations for tenant', async () => {
    const res = await request(app)
      .get(`/api/v1/tenants/${tenantId}/conversations`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('filters conversations by aiActive=false (human inbox)', async () => {
    const res = await request(app)
      .get(`/api/v1/tenants/${tenantId}/conversations?aiActive=false`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((c: { aiActive: boolean }) => c.aiActive === false)).toBe(true);
  });

  it('enforces tenant isolation — cannot access other tenant conversations', async () => {
    const otherRes = await request(app)
      .post('/api/v1/auth/register')
      .send({
        tenantName: `Other Tenant ${Date.now()}`,
        email: `other-${Date.now()}@test.com`,
        password: 'Password123!',
      });

    const otherTenantId = otherRes.body.data.tenant.id;

    const res = await request(app)
      .get(`/api/v1/tenants/${otherTenantId}/conversations`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });
});

describe('Support Agent Configuration', () => {
  it('can save and retrieve support agent business config', async () => {
    const putRes = await request(app)
      .put(`/api/v1/tenants/${tenantId}/support-config`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Test Business',
        industry: 'E-commerce',
        brandVoiceGuide: 'Friendly, concise, and professional.',
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);
    expect(putRes.body.data.brandVoiceGuide).toBe('Friendly, concise, and professional.');
    // Tokens should never be in response
    expect(putRes.body.data.supportAccessToken).toBeUndefined();

    const getRes = await request(app)
      .get(`/api/v1/tenants/${tenantId}/support-config`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.brandVoiceGuide).toBe('Friendly, concise, and professional.');
    expect(getRes.body.data.supportAccessToken).toBeUndefined();
  });
});

describe('Audit Trail', () => {
  it('records audit logs for all relevant support agent operations', async () => {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    const operations = logs.map((l) => l.operation);

    // Verify key operations were audited
    expect(operations).toContain('message_received');
    expect(operations).toContain('ai_response_sent');
    expect(operations).toContain('ai_escalated');
  });
});
