import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { harnessService } from '../src/services/harnessService';

let tenantId = '';
let otherTenantId = '';
let authToken = '';
let otherAuthToken = '';
let financeAgentId = '';
let verifiedInvocationId = '';

async function register(prefix: string) {
  const response = await request(app).post('/api/v1/auth/register').send({
    tenantName: `${prefix} ${Date.now()}`,
    email: `${prefix}-${Date.now()}@test.com`,
    password: 'Password123!',
  });
  return { tenantId: response.body.data.tenant.id, token: response.body.data.token };
}

const parameterSchema = {
  type: 'object',
  required: ['message'],
  properties: { message: { type: 'string' } },
  additionalProperties: false,
};
const verificationSchema = {
  type: 'object',
  required: ['ok'],
  properties: { ok: { type: 'boolean' } },
  additionalProperties: false,
};

beforeAll(async () => {
  const first = await register('harness');
  const second = await register('harness-other');
  tenantId = first.tenantId;
  authToken = first.token;
  otherTenantId = second.tenantId;
  otherAuthToken = second.token;
  const agent = await prisma.agent.create({ data: { tenantId, department: 'finance', name: 'Harness Agent' } });
  financeAgentId = agent.id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe('Phase 08 Harness, Verification & Trust', () => {
  it('validates tool input and independent output evidence', async () => {
    const tool = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/tools`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'verified_message', description: 'Test verified tool', parameterSchema, verificationSchema, requiredPermissions: ['tasks:execute'] });
    expect(tool.status).toBe(201);

    const invalidInput = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'verified_message', idempotencyKey: 'invalid-input', payload: {} });
    expect(invalidInput.status).toBe(400);

    const invocation = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'verified_message', idempotencyKey: 'verified-1', payload: { message: 'hello' } });
    expect(invocation.status).toBe(201);
    expect(invocation.body.data.status).toBe('awaiting_verification');
    verifiedInvocationId = invocation.body.data.id;

    const duplicate = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'verified_message', idempotencyKey: 'verified-1', payload: { message: 'different payload' } });
    expect(duplicate.status).toBe(201);
    expect(duplicate.body.data.id).toBe(verifiedInvocationId);

    const invalidOutput = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations/${verifiedInvocationId}/verify`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ok: 'yes' });
    expect(invalidOutput.status).toBe(400);

    const blockedRetry = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations/${verifiedInvocationId}/verify`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ok: true });
    expect(blockedRetry.status).toBe(409);
  });

  it('requires approval for high-risk tools and blocks missing permissions', async () => {
    const restricted = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/tools`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'restricted_tool', description: 'Restricted', parameterSchema, verificationSchema, requiredPermissions: ['security:root'], riskLevel: 'high' });
    expect(restricted.status).toBe(201);

    const forbidden = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'restricted_tool', idempotencyKey: 'forbidden-1', payload: { message: 'no' }, agentId: financeAgentId });
    expect(forbidden.status).toBe(403);

    const approvedTool = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/tools`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'approval_tool', description: 'Approval required', parameterSchema, verificationSchema, requiredPermissions: ['tasks:execute'], riskLevel: 'high' });
    expect(approvedTool.status).toBe(201);

    const invocation = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'approval_tool', idempotencyKey: 'approval-1', payload: { message: 'needs review' }, agentId: financeAgentId });
    expect(invocation.body.data.status).toBe('awaiting_approval');

    const approvals = await request(app)
      .get(`/api/v1/tenants/${tenantId}/harness/approval-requests`)
      .set('Authorization', `Bearer ${authToken}`);
    const approval = approvals.body.data[0];
    const review = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/approval-requests/${approval.id}/review`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ decision: 'approved' });
    expect(review.status).toBe(200);

    const verified = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations/${invocation.body.data.id}/verify`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ ok: true });
    expect(verified.body.data.status).toBe('succeeded');
  });

  it('enforces tenant-scoped tool registry and agent allowlists', async () => {
    const tenantTool = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/tools`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'tenant_scoped_tool', description: 'Scoped tool', parameterSchema, verificationSchema, requiredPermissions: ['tasks:execute'] });
    expect(tenantTool.status).toBe(201);

    const unapprovedTool = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/tools`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'unapproved_agent_tool', description: 'Not in allowlist', parameterSchema, verificationSchema, requiredPermissions: ['tasks:execute'] });
    expect(unapprovedTool.status).toBe(201);

    const agentVersion = await prisma.agentVersion.create({
      data: {
        agentId: financeAgentId,
        systemPrompt: 'Agent with allowlist',
        temperature: 0.1,
        toolAllowlist: ['tenant_scoped_tool'],
      },
    });
    await prisma.agent.update({ where: { id: financeAgentId }, data: { currentVersionId: agentVersion.id } });

    const allowed = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'tenant_scoped_tool', idempotencyKey: 'tenant-allowed-1', payload: { message: 'allowed' }, actorType: 'agent', agentId: financeAgentId });
    expect(allowed.status).toBe(201);

    const blockedByAllowlist = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'unapproved_agent_tool', idempotencyKey: 'tenant-denied-allowlist', payload: { message: 'blocked' }, actorType: 'agent', agentId: financeAgentId });
    expect(blockedByAllowlist.status).toBe(403);

    await expect(
      harnessService.invokeTool(tenantId, {
        toolName: 'tenant_scoped_tool',
        idempotencyKey: 'tenant-denied-permission',
        payload: { message: 'secret' },
        actorId: financeAgentId,
        actorPermissions: ['agents:read'],
        agentId: financeAgentId,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      harnessService.invokeTool(otherTenantId, {
        toolName: 'tenant_scoped_tool',
        idempotencyKey: 'cross-tenant-tool',
        payload: { message: 'intrude' },
        actorId: 'other-user',
        actorPermissions: ['tasks:execute'],
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const privilegeEscalationTool = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/tools`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'privilege_tool', description: 'Escalation test', parameterSchema, verificationSchema, requiredPermissions: ['security:root'], riskLevel: 'low' });
    expect(privilegeEscalationTool.status).toBe(201);

    await expect(
      harnessService.invokeTool(tenantId, {
        toolName: 'privilege_tool',
        idempotencyKey: 'privilege-1',
        payload: { message: 'root' },
        actorId: 'viewer-user',
        actorPermissions: ['tasks:execute'],
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('enforces rate limits and agent iteration breakers', async () => {
    const policy = await request(app)
      .put(`/api/v1/tenants/${tenantId}/harness/policy`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ maxInvocationsPerWindow: 1, rateWindowSeconds: 60, maxAgentRunIterations: 2 });
    expect(policy.status).toBe(200);

    const rateLimited = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'verified_message', idempotencyKey: 'rate-1', payload: { message: 'rate' } });
    expect(rateLimited.status).toBe(429);

    const run = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/runs`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ agentId: financeAgentId });
    expect(run.status).toBe(201);
    await request(app).post(`/api/v1/tenants/${tenantId}/harness/runs/${run.body.data.id}/iterations`).set('Authorization', `Bearer ${authToken}`).send({ action: 'one' });
    await request(app).post(`/api/v1/tenants/${tenantId}/harness/runs/${run.body.data.id}/iterations`).set('Authorization', `Bearer ${authToken}`).send({ action: 'two' });
    const blocked = await request(app).post(`/api/v1/tenants/${tenantId}/harness/runs/${run.body.data.id}/iterations`).set('Authorization', `Bearer ${authToken}`).send({ action: 'three' });
    expect(blocked.status).toBe(409);
  });

  it('deduplicates idempotent invocations and isolates tenants', async () => {
    const first = await request(app)
      .post(`/api/v1/tenants/${tenantId}/harness/invocations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ toolName: 'verified_message', idempotencyKey: 'rate-1', payload: { message: 'rate' } });
    expect(first.status).toBe(429);

    const crossTenant = await request(app)
      .get(`/api/v1/tenants/${tenantId}/harness/tools`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error.code).toBe('TENANT_MISMATCH');
  });
});
