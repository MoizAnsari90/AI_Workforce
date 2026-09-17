import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

let tenantId = '';
let otherTenantId = '';
let authToken = '';
let otherAuthToken = '';
let productId = '';
let locationId = '';
let recommendationId = '';
let approvalId = '';

async function register(prefix: string) {
  const response = await request(app).post('/api/v1/auth/register').send({
    tenantName: `${prefix} ${Date.now()}`,
    email: `${prefix}-${Date.now()}@test.com`,
    password: 'Password123!',
  });
  return { tenantId: response.body.data.tenant.id, token: response.body.data.token };
}

beforeAll(async () => {
  const first = await register('operations');
  const second = await register('operations-other');
  tenantId = first.tenantId;
  authToken = first.token;
  otherTenantId = second.tenantId;
  otherAuthToken = second.token;

  await request(app)
    .put(`/api/v1/tenants/${tenantId}/operations/policy`)
    .set('Authorization', `Bearer ${authToken}`)
    .send({ highValuePurchaseThreshold: 10000 });

  await prisma.agent.create({
    data: { tenantId, department: 'operations', name: 'Operations Agent' },
  });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe('Phase 05 Operations & Inventory AI Employee', () => {
  it('creates tenant-scoped catalog and location data', async () => {
    const location = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/locations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Main warehouse' });
    expect(location.status).toBe(201);
    locationId = location.body.data.id;

    const supplier = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/suppliers`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Verified Supply Co' });
    expect(supplier.status).toBe(201);

    const product = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/products`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ sku: 'SKU-001', name: 'Widget', unitCost: 1000, reorderPoint: 10, reorderQuantity: 20, supplierId: supplier.body.data.id });
    expect(product.status).toBe(201);
    productId = product.body.data.id;
  });

  it('records consistent stock movements and rejects negative stock', async () => {
    const adjustment = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/inventory/adjust`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ productId, locationId, quantityDelta: 5, reason: 'Initial count' });
    expect(adjustment.status).toBe(201);
    expect(adjustment.body.data.updated.quantity).toBe(5);
    expect(adjustment.body.data.movement.quantityDelta).toBe(5);

    const invalid = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/inventory/adjust`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ productId, locationId, quantityDelta: -6, reason: 'Invalid removal' });
    expect(invalid.status).toBe(409);

    const inventory = await request(app)
      .get(`/api/v1/tenants/${tenantId}/operations/inventory`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(inventory.body.data[0].quantity).toBe(5);
  });

  it('detects low stock and creates an approval-gated reorder', async () => {
    const alerts = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/stock-alerts/detect`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(alerts.status).toBe(200);
    expect(alerts.body.data).toHaveLength(1);

    const recommendation = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/reorder-recommendations`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ productId, locationId });
    expect(recommendation.status).toBe(201);
    expect(recommendation.body.data.recommendation.status).toBe('pending_approval');
    recommendationId = recommendation.body.data.recommendation.id;

    const approvals = await request(app)
      .get(`/api/v1/tenants/${tenantId}/operations/approval-requests`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(approvals.body.data).toHaveLength(1);
    approvalId = approvals.body.data[0].id;

    const review = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/approval-requests/${approvalId}/review`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ decision: 'approved' });
    expect(review.status).toBe(200);

    const orders = await request(app)
      .get(`/api/v1/tenants/${tenantId}/operations/purchase-orders`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(orders.body.data[0].status).toBe('approved');
    expect(orders.body.data[0].items[0].productId).toBe(productId);

    const storedRecommendation = await prisma.reorderRecommendation.findUnique({ where: { id: recommendationId } });
    expect(storedRecommendation?.status).toBe('approved');
  });

  it('records demand signals and enforces tenant isolation', async () => {
    const signal = await request(app)
      .post(`/api/v1/tenants/${tenantId}/operations/demand-signals`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ productId, locationId, periodStart: new Date(Date.now() - 86400000).toISOString(), periodEnd: new Date().toISOString() });
    expect(signal.status).toBe(201);
    expect(signal.body.data.unitsMoved).toBe(0);

    const crossTenant = await request(app)
      .get(`/api/v1/tenants/${tenantId}/operations/inventory`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error.code).toBe('TENANT_MISMATCH');
  });
});
