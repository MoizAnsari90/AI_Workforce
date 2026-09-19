import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { TemplateService } from '../src/services/templateService';

describe('Voice Webhooks and Template Deployment Tests', () => {
  it('should handle Vapi/Retell voice webhooks and persist voice session', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Test Tenant Voice ${Date.now()}` },
    });

    const callId = `call_${Date.now()}`;
    const payload = {
      provider: 'VAPI',
      callId,
      callerPhone: '+15550199',
      status: 'completed',
      transcript: [
        { speaker: 'user', text: 'I need a refund on order ord_123' },
        { speaker: 'agent', text: 'I have logged your refund request for review.' },
      ],
      metadata: { duration: 45 },
    };

    const res = await request(app)
      .post(`/api/v1/webhook/${tenant.id}/voice`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.callId).toBe(callId);
    expect(res.body.data.routingDecision.intent).toBe('REFUND_REQUEST');

    // Verify session in DB
    const session = await prisma.voiceSession.findUnique({
      where: { callId },
    });
    expect(session).not.toBeNull();
    expect(session?.tenantId).toBe(tenant.id);
    expect(session?.provider).toBe('VAPI');
  });

  it('should seed default niche templates and allow tenant to deploy them', async () => {
    // Register tenant and get auth token
    const regRes = await request(app).post('/api/v1/auth/register').send({
      tenantName: `Template Tenant ${Date.now()}`,
      email: `admin_${Date.now()}@test.com`,
      password: 'Password123!',
    });

    expect(regRes.status).toBe(201);
    const tenantId = regRes.body.data.tenant.id;
    const token = regRes.body.data.token;

    // 1. Seed and List templates
    await TemplateService.seedDefaultTemplates();
    const templates = await TemplateService.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(2);

    const ecommerceTemplate = templates.find(t => t.category === 'ecommerce');
    expect(ecommerceTemplate).toBeDefined();

    // 2. Deploy template via API endpoint
    const res = await request(app)
      .post(`/api/v1/tenants/${tenantId}/templates/deploy`)
      .set('Authorization', `Bearer ${token}`)
      .send({ templateId: ecommerceTemplate!.id });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.workflowId).toBeDefined();
    expect(res.body.data.agentId).toBeDefined();

    // 3. Verify workflow is created in DB for this tenant
    const workflow = await prisma.workflow.findUnique({
      where: { id: res.body.data.workflowId },
    });
    expect(workflow).not.toBeNull();
    expect(workflow?.tenantId).toBe(tenantId);
  });
});
