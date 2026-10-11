import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { TemplateService } from '../src/services/templateService';

describe('Voice Webhooks and Template Deployment Tests', () => {
  it('rejects the old unauthenticated voice webhook without persisting a forged call', async () => {
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

    expect(res.status).toBe(410);

    // Verify session in DB
    const session = await prisma.voiceSession.findUnique({
      where: { callId },
    });
    expect(session).toBeNull();
    await prisma.tenant.delete({ where: { id: tenant.id } });
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

    const onboarding = await request(app)
      .get(`/api/v1/tenants/${tenantId}/onboarding-status`)
      .set('Authorization', `Bearer ${token}`);
    expect(onboarding.status).toBe(200);
    expect(onboarding.body.data.needsOnboarding).toBe(true);

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
      .send({ templateId: ecommerceTemplate!.id, activate: false });

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
    expect(workflow?.status).toBe('paused');
    expect(await prisma.agent.findUnique({ where: { id: res.body.data.agentId } })).toMatchObject({ tenantId, isActive: false });
    const completedOnboarding = await request(app)
      .get(`/api/v1/tenants/${tenantId}/onboarding-status`)
      .set('Authorization', `Bearer ${token}`);
    expect(completedOnboarding.body.data.needsOnboarding).toBe(true);
    expect(completedOnboarding.body.data.nextStep).toBe('business_profile');
  });
});
