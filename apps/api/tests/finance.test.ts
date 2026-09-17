import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/lib/prisma';

let tenantId = '';
let otherTenantId = '';
let authToken = '';
let otherAuthToken = '';
let invoiceId = '';

async function register(prefix: string) {
  const response = await request(app).post('/api/v1/auth/register').send({
    tenantName: `${prefix} ${Date.now()}`,
    email: `${prefix}-${Date.now()}@test.com`,
    password: 'Password123!',
  });
  return { tenantId: response.body.data.tenant.id, token: response.body.data.token };
}

beforeAll(async () => {
  const first = await register('finance');
  const second = await register('finance-other');
  tenantId = first.tenantId;
  authToken = first.token;
  otherTenantId = second.tenantId;
  otherAuthToken = second.token;

  await prisma.agent.create({ data: { tenantId, department: 'finance', name: 'Finance Agent' } });
  await request(app)
    .put(`/api/v1/tenants/${tenantId}/finance/policy`)
    .set('Authorization', `Bearer ${authToken}`)
    .send({ highValueExpenseThreshold: 1000, refundApprovalThreshold: 100 });
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
});

describe('Phase 06 Finance & Accounting AI Employee', () => {
  it('records categorized revenue, expenses, and approval-gated high expenses', async () => {
    const revenue = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/records`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ recordType: 'revenue', amount: 1000, description: 'Customer sale', occurredAt: new Date().toISOString() });
    expect(revenue.status).toBe(201);
    expect(revenue.body.data.status).toBe('confirmed');

    const expense = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/records`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ recordType: 'expense', amount: 200, description: 'Software subscription', occurredAt: new Date().toISOString() });
    expect(expense.status).toBe(201);
    expect(expense.body.data.category).toBe('software');

    const highExpense = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/records`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ recordType: 'expense', amount: 2000, description: 'Payroll commitment', occurredAt: new Date().toISOString() });
    expect(highExpense.status).toBe(201);
    expect(highExpense.body.data.status).toBe('awaiting_approval');

    const approvals = await request(app)
      .get(`/api/v1/tenants/${tenantId}/finance/approval-requests`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(approvals.body.data).toHaveLength(1);

    const review = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/approval-requests/${approvals.body.data[0].id}/review`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ decision: 'approved' });
    expect(review.status).toBe(200);
  });

  it('reconciles candidates and generates mathematically consistent reports', async () => {
    const candidate = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/records`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ recordType: 'expense', amount: 50, description: 'Imported transaction', status: 'candidate', source: 'import', occurredAt: new Date().toISOString() });
    expect(candidate.body.data.status).toBe('candidate');

    const reconciled = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/records/${candidate.body.data.id}/reconcile`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.data.status).toBe('reconciled');

    const report = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/reports`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ periodStart: new Date(Date.now() - 86400000).toISOString(), periodEnd: new Date(Date.now() + 86400000).toISOString() });
    expect(report.status).toBe(201);
    expect(report.body.data.totalRevenue).toBe('1000');
    expect(report.body.data.totalExpenses).toBe('2250');
    expect(report.body.data.netCashFlow).toBe('-1250');
  });

  it('keeps invoices, payment status, and refunds approval-first', async () => {
    const invoice = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/invoices`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoiceNumber: `INV-${Date.now()}`, customerName: 'Customer', items: [{ description: 'Service', quantity: 2, unitPrice: 75 }] });
    expect(invoice.status).toBe(201);
    invoiceId = invoice.body.data.id;

    const invoiceApproval = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/invoices/${invoiceId}/approval-request`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(invoiceApproval.status).toBe(201);

    const payment = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/payments`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoiceId, amount: 150, status: 'recorded' });
    expect(payment.status).toBe(201);
    expect(payment.body.data.status).toBe('recorded');

    const refund = await request(app)
      .post(`/api/v1/tenants/${tenantId}/finance/refund-requests`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ paymentId: payment.body.data.id, amount: 150, reason: 'Customer request' });
    expect(refund.status).toBe(201);
    expect(refund.body.data.actionType).toBe('finance_refund');
  });

  it('enforces tenant isolation for financial records', async () => {
    const response = await request(app)
      .get(`/api/v1/tenants/${tenantId}/finance/records`)
      .set('Authorization', `Bearer ${otherAuthToken}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('TENANT_MISMATCH');
  });
});
