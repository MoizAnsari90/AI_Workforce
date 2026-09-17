import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

let tenantId = '';
let otherTenantId = '';
let authToken = '';
let otherAuthToken = '';

async function register(prefix: string) {
  const response = await request(app).post('/api/v1/auth/register').send({
    tenantName: `${prefix} ${Date.now()}`,
    email: `${prefix}-${Date.now()}@test.com`,
    password: 'Password123!',
  });
  return { tenantId: response.body.data.tenant.id, token: response.body.data.token };
}

beforeAll(async () => {
  const first = await register('autonomy');
  const second = await register('autonomy-other');
  tenantId = first.tenantId;
  authToken = first.token;
  otherTenantId = second.tenantId;
  otherAuthToken = second.token;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe('Phase 09 Autonomous Operations', () => {
  it('runs persisted scheduled jobs idempotently and exposes dashboard state', async () => {
    const job = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/jobs`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Morning custom check', jobType: 'custom', intervalSeconds: 3600, nextRunAt: new Date(Date.now() - 1000).toISOString() });
    expect(job.status).toBe(201);

    const tick = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/tick`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(tick.status).toBe(200);
    expect(tick.body.data).toHaveLength(1);
    expect(tick.body.data[0].status).toBe('completed');

    const secondTick = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/tick`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(secondTick.body.data).toHaveLength(0);

    const dashboard = await request(app)
      .get(`/api/v1/tenants/${tenantId}/autonomy/dashboard`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.jobs).toHaveLength(1);
    expect(dashboard.body.data.jobs[0].runs).toHaveLength(1);
  });

  it('deduplicates event triggers and resumes failed jobs safely', async () => {
    const eventJob = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/jobs`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Order completed handler', jobType: 'custom', triggerType: 'event', eventType: 'order.completed', maxRetries: 2 });
    expect(eventJob.status).toBe(201);

    const event = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ eventKey: 'order-event-1', eventType: 'order.completed', payload: { orderId: 'order-1' } });
    expect(event.status).toBe(201);
    expect(event.body.data.duplicate).toBe(false);
    expect(event.body.data.runs).toHaveLength(1);

    const duplicate = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/events`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ eventKey: 'order-event-1', eventType: 'order.completed' });
    expect(duplicate.body.data.duplicate).toBe(true);
    expect(duplicate.body.data.runs).toHaveLength(0);

    const failing = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/jobs`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Retryable check', jobType: 'custom', intervalSeconds: 3600, maxRetries: 2 });
    const failedRun = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/jobs/${failing.body.data.id}/run`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(failedRun.status).toBe(201);

    const run = await prisma.autonomousJobRun.findFirst({ where: { jobId: failing.body.data.id } });
    expect(run).not.toBeNull();
    const retryableJob = await prisma.autonomousJob.update({ where: { id: failing.body.data.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await prisma.autonomousJobRun.deleteMany({ where: { jobId: retryableJob.id } });
    const retriable = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/jobs/${failing.body.data.id}/run`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ failOnce: true });
    expect(retriable.body.data.status).toBe('failed');
    const retried = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/runs/${retriable.body.data.id}/retry`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(retried.body.data.status).toBe('completed');
  });

  it('records heartbeats and enforces tenant isolation', async () => {
    const heartbeat = await request(app)
      .post(`/api/v1/tenants/${tenantId}/autonomy/heartbeats/api`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'healthy', metadata: { version: 'test' } });
    expect(heartbeat.status).toBe(200);

    const crossTenant = await request(app)
      .get(`/api/v1/tenants/${tenantId}/autonomy/dashboard`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error.code).toBe('TENANT_MISMATCH');
  });
});
