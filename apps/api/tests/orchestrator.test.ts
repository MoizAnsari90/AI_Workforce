import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

let tenantId = '';
let otherTenantId = '';
let authToken = '';
let otherAuthToken = '';
let firstAgentId = '';
let secondAgentId = '';
let workflowId = '';
let executionId = '';

async function register(prefix: string) {
  const response = await request(app).post('/api/v1/auth/register').send({
    tenantName: `${prefix} ${Date.now()}`,
    email: `${prefix}-${Date.now()}@test.com`,
    password: 'Password123!',
  });
  return { tenantId: response.body.data.tenant.id, token: response.body.data.token };
}

beforeAll(async () => {
  const first = await register('orchestrator');
  const second = await register('orchestrator-other');
  tenantId = first.tenantId;
  authToken = first.token;
  otherTenantId = second.tenantId;
  otherAuthToken = second.token;

  const agents = await prisma.agent.createManyAndReturn({
    data: [
      { tenantId, department: 'marketing', name: 'Marketing Agent' },
      { tenantId, department: 'sales', name: 'Sales Agent' },
    ],
  });
  firstAgentId = agents[0].id;
  secondAgentId = agents[1].id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe('Phase 07 Workforce Orchestrator & Agent Graph', () => {
  it('creates and runs a multi-agent graph with explicit context and approval resume', async () => {
    const workflow = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflows`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'Campaign to sales handoff',
        nodes: [
          { key: 'marketing', type: 'agent_task', agentId: firstAgentId, config: { inputKeys: ['campaignId'], outputKey: 'marketingResult' } },
          { key: 'approval', type: 'approval', agentId: secondAgentId },
          { key: 'sales', type: 'agent_task', agentId: secondAgentId, config: { inputKeys: ['leadId', 'marketingResult'] } },
        ],
        edges: [{ from: 'marketing', to: 'approval' }, { from: 'approval', to: 'sales' }],
      });
    expect(workflow.status).toBe(201);
    workflowId = workflow.body.data.id;

    const started = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflows/${workflowId}/executions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ context: { campaignId: 'campaign-1', leadId: 'lead-1', secret: 'must-not-be-forwarded' }, idempotencyKey: 'run-1' });
    expect(started.status).toBe(201);
    executionId = started.body.data.id;

    const duplicate = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflows/${workflowId}/executions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ context: { campaignId: 'different' }, idempotencyKey: 'run-1' });
    expect(duplicate.body.data.id).toBe(executionId);

    const firstAdvance = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${executionId}/advance`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(firstAdvance.body.data.status).toBe('running');

    const approvalAdvance = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${executionId}/advance`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(approvalAdvance.body.data.status).toBe('paused');

    const approvals = await request(app)
      .get(`/api/v1/tenants/${tenantId}/workflow-approvals`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(approvals.body.data).toHaveLength(1);

    const reviewed = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-approvals/${approvals.body.data[0].id}/review`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ decision: 'approved' });
    expect(reviewed.status).toBe(200);

    const completed = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${executionId}/advance`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(completed.body.data.status).toBe('completed');

    const trace = await request(app)
      .get(`/api/v1/tenants/${tenantId}/workflow-executions/${executionId}/trace`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(trace.body.data.nodeExecutions).toHaveLength(3);
    expect(trace.body.data.nodeExecutions[0].inputContext).toEqual({ campaignId: 'campaign-1' });
    expect(trace.body.data.nodeExecutions[0].outputContext.result.text).toContain('campaignId');
  });

  it('retries failed nodes within the configured limit', async () => {
    const workflow = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflows`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Retryable workflow', maxRetries: 2, nodes: [{ key: 'unstable', type: 'agent_task', agentId: firstAgentId, config: { failUntilAttempt: 1 } }], edges: [] });
    const started = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflows/${workflow.body.data.id}/executions`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ idempotencyKey: 'retry-1', context: {} });
    const failed = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${started.body.data.id}/advance`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(failed.body.data.status).toBe('failed');

    const retried = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${started.body.data.id}/retry`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(retried.body.data.status).toBe('running');
    const completed = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${started.body.data.id}/advance`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(completed.body.data.status).toBe('completed');
  });

  it('deduplicates events and preserves tenant isolation', async () => {
    const first = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${executionId}/events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ eventKey: 'event-1', eventType: 'external_update', payload: { ok: true } });
    expect(first.body.data.duplicate).toBe(false);

    const duplicate = await request(app)
      .post(`/api/v1/tenants/${tenantId}/workflow-executions/${executionId}/events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ eventKey: 'event-1', eventType: 'external_update' });
    expect(duplicate.body.data.duplicate).toBe(true);

    const crossTenant = await request(app)
      .get(`/api/v1/tenants/${tenantId}/workflows`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error.code).toBe('TENANT_MISMATCH');
  });
});
