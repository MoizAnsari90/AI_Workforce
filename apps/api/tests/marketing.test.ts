import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

let tenantId = '';
let otherTenantId = '';
let authToken = '';
let otherAuthToken = '';
let campaignId = '';
let draftId = '';
let marketingAgentId = '';

async function register(prefix: string) {
  const response = await request(app).post('/api/v1/auth/register').send({
    tenantName: `${prefix} ${Date.now()}`,
    email: `${prefix}-${Date.now()}@test.com`,
    password: 'Password123!',
  });
  return { tenantId: response.body.data.tenant.id, token: response.body.data.token };
}

beforeAll(async () => {
  const first = await register('marketing');
  const second = await register('marketing-other');
  tenantId = first.tenantId;
  authToken = first.token;
  otherTenantId = second.tenantId;
  otherAuthToken = second.token;

  const agent = await prisma.agent.create({
    data: { tenantId, department: 'marketing', name: 'Marketing Agent' },
  });
  marketingAgentId = agent.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe('Phase 04 Marketing AI Employee', () => {
  it('stores tenant brand rules and creates campaigns', async () => {
    const profile = await request(app)
      .put(`/api/v1/tenants/${tenantId}/marketing/profile`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        brandVoice: 'Clear, practical, and optimistic',
        approvedClaims: ['saves teams time'],
        prohibitedClaims: ['guaranteed results'],
        targetAudience: 'Small business operators',
      });
    expect(profile.status).toBe(200);

    const campaign = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/campaigns`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Spring workflow campaign', objective: 'Generate qualified leads' });
    expect(campaign.status).toBe(201);
    campaignId = campaign.body.data.id;
  });

  it('blocks content with prohibited or unapproved claims', async () => {
    const draft = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/content-drafts`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        campaignId,
        title: 'Unsafe draft',
        content: 'Our product delivers guaranteed results.',
        contentType: 'social_post',
        channel: 'linkedin',
        claims: ['guaranteed results'],
      });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('blocked');

    const publishRequest = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/content-drafts/${draft.body.data.id}/publish-request`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ agentId: marketingAgentId });
    expect(publishRequest.status).toBe(400);
  });

  it('requires approval before publishing validated content', async () => {
    const draft = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/content-drafts`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        campaignId,
        title: 'Safe draft',
        content: 'Our workflow saves teams time.',
        contentType: 'social_post',
        channel: 'linkedin',
        claims: ['saves teams time'],
      });
    expect(draft.body.data.status).toBe('draft');
    draftId = draft.body.data.id;

    const beforeApproval = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/content-drafts/${draftId}/publish`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(beforeApproval.status).toBe(409);

    const requested = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/content-drafts/${draftId}/publish-request`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ agentId: marketingAgentId });
    expect(requested.status).toBe(201);

    const reviewed = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/approval-requests/${requested.body.data.id}/review`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ decision: 'approved' });
    expect(reviewed.status).toBe(200);

    const published = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/content-drafts/${draftId}/publish`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('published');
  });

  it('records metrics, attributes leads, and isolates tenants', async () => {
    const metric = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/campaigns/${campaignId}/metrics`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contentDraftId: draftId, metricName: 'clicks', metricValue: 42 });
    expect(metric.status).toBe(201);

    const lead = await request(app)
      .post(`/api/v1/tenants/${tenantId}/leads`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ firstName: 'Morgan', source: 'campaign' });
    expect(lead.status).toBe(201);

    const attribution = await request(app)
      .post(`/api/v1/tenants/${tenantId}/marketing/leads/${lead.body.data.id}/attribution`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ campaignId, attributionSource: 'linkedin' });
    expect(attribution.status).toBe(200);
    expect(attribution.body.data.campaignId).toBe(campaignId);

    const crossTenant = await request(app)
      .get(`/api/v1/tenants/${tenantId}/marketing/campaigns`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error.code).toBe('TENANT_MISMATCH');
  });
});
