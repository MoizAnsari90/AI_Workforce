import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';

describe('Tenant Isolation Verification', () => {
  let tenantAId = '';
  let tokenA = '';
  let tenantBId = '';
  let tokenB = '';

  beforeAll(async () => {
    // Register Tenant A
    const resA = await request(app)
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'Tenant Alpha',
        email: `alpha-${Date.now()}@example.com`,
        password: 'Password123!',
      });
    tenantAId = resA.body.data.tenant.id;
    tokenA = resA.body.data.token;

    // Register Tenant B
    const resB = await request(app)
      .post('/api/v1/auth/register')
      .send({
        tenantName: 'Tenant Beta',
        email: `beta-${Date.now()}@example.com`,
        password: 'Password123!',
      });
    tenantBId = resB.body.data.tenant.id;
    tokenB = resB.body.data.token;
  });

  it('Tenant A can create and read its own tasks', async () => {
    // 1. Create task
    const createRes = await request(app)
      .post(`/api/v1/tenants/${tenantAId}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Alpha Internal Audit Task',
        description: 'Private task for Tenant Alpha only',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.tenantId).toBe(tenantAId);

    // 2. Read tasks
    const readRes = await request(app)
      .get(`/api/v1/tenants/${tenantAId}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(readRes.status).toBe(200);
    expect(readRes.body.success).toBe(true);
    expect(readRes.body.data.length).toBeGreaterThanOrEqual(1);
    expect(readRes.body.data[0].tenantId).toBe(tenantAId);
  });

  it('Tenant A CANNOT read Tenant B data (returns 403 TENANT_MISMATCH)', async () => {
    const res = await request(app)
      .get(`/api/v1/tenants/${tenantBId}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('Tenant A CANNOT write to Tenant B data via path param (returns 403 TENANT_MISMATCH)', async () => {
    const res = await request(app)
      .post(`/api/v1/tenants/${tenantBId}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Malicious Cross-Tenant Task',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('Tenant A CANNOT inject Tenant B id in request body (returns 403 TENANT_MISMATCH)', async () => {
    const res = await request(app)
      .post(`/api/v1/tenants/${tenantAId}/tasks`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Body spoof attempt',
        tenantId: tenantBId,
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('Tenant B reads only its own tasks and cannot see Tenant A tasks', async () => {
    const res = await request(app)
      .get(`/api/v1/tenants/${tenantBId}/tasks`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Tenant B has not created any tasks yet
    expect(res.body.data.length).toBe(0);
  });
});
