import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

let tenantId = '';
let otherTenantId = '';
let authToken = '';
let otherAuthToken = '';
let leadId = '';
let agentId = '';

async function register(prefix: string) {
  const response = await request(app).post('/api/v1/auth/register').send({
    tenantName: `${prefix} ${Date.now()}`,
    email: `${prefix}-${Date.now()}@test.com`,
    password: 'Password123!',
  });
  return { tenantId: response.body.data.tenant.id, token: response.body.data.token };
}

beforeAll(async () => {
  const first = await register('sales');
  const second = await register('sales-other');
  tenantId = first.tenantId;
  authToken = first.token;
  otherTenantId = second.tenantId;
  otherAuthToken = second.token;

  const agent = await prisma.agent.create({
    data: { tenantId, department: 'sales', name: 'Sales Agent' },
  });
  agentId = agent.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe('Phase 03 Sales CRM', () => {
  it('creates, scores, and transitions a lead', async () => {
    const created = await request(app)
      .post(`/api/v1/tenants/${tenantId}/leads`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        firstName: 'Ada',
        email: 'ada@example.com',
        company: 'Analytical Engines',
        qualificationData: {
          budgetConfirmed: true,
          decisionMaker: true,
          needIdentified: true,
          timelineConfirmed: false,
        },
      });

    expect(created.status).toBe(201);
    expect(created.body.data.score).toBe(0);
    leadId = created.body.data.id;

    const policy = await request(app)
      .get(`/api/v1/tenants/${tenantId}/sales/policy`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(policy.status).toBe(200);

    const rescored = await request(app)
      .post(`/api/v1/tenants/${tenantId}/leads/${leadId}/rescore`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(rescored.status).toBe(200);
    expect(rescored.body.data.score).toBe(75);

    const transitioned = await request(app)
      .post(`/api/v1/tenants/${tenantId}/leads/${leadId}/transition`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'contacted' });
    expect(transitioned.status).toBe(200);
    expect(transitioned.body.data.status).toBe('contacted');

    const activities = await request(app)
      .get(`/api/v1/tenants/${tenantId}/leads/${leadId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(activities.body.data.activities.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects cross-tenant access', async () => {
    const response = await request(app)
      .get(`/api/v1/tenants/${tenantId}/leads`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('schedules a future follow-up and records it on the lead', async () => {
    const response = await request(app)
      .post(`/api/v1/tenants/${tenantId}/leads/${leadId}/follow-ups`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Send proposal', scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    expect(response.status).toBe(201);
    expect(response.body.data.leadId).toBe(leadId);

    const followUps = await request(app)
      .get(`/api/v1/tenants/${tenantId}/follow-ups`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(followUps.body.data).toHaveLength(1);
  });

  it('requires and reviews approval for a high-value close', async () => {
    const requested = await request(app)
      .post(`/api/v1/tenants/${tenantId}/leads/${leadId}/approval-requests`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ actionType: 'close_deal', dealValue: 25000, agentId });
    expect(requested.status).toBe(201);

    const reviewed = await request(app)
      .post(`/api/v1/tenants/${tenantId}/approval-requests/${requested.body.data.id}/review`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ decision: 'approved' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.status).toBe('approved');
  });
});
