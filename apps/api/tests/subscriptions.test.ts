import crypto from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { tx } = vi.hoisted(() => ({ tx: {
  $executeRaw: vi.fn(), billingAccount: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  billingEvent: { findUnique: vi.fn(), create: vi.fn() }, subscriptionTier: { upsert: vi.fn() },
  tenantCredits: { upsert: vi.fn() }, tenant: { update: vi.fn() }, agent: { count: vi.fn() },
} }));
vi.mock('../src/lib/prisma', () => ({ prisma: { ...tx, $transaction: vi.fn(async (fn: any) => fn(tx)) } }));
import { billingPlans, processBillingEvent, verifyBillingEvent, subscriptionEntitled, assertSubscription, assertAgentCapacity } from '../src/services/subscriptionService';
import { guardPaidRequest } from '../src/middleware/subscriptionMiddleware';
const original = { ...process.env };
const account = { tenantId: 'tenant-a', customerId: 'cus_a', subscriptionId: 'sub_a', checkoutId: 'cs_a', status: 'active', planId: 'starter', periodEnd: new Date(Date.now() + 86400000), lastInvoiceId: null, livemode: false };
const current = { id: 'sub_a', customer: 'cus_a', livemode: false, status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 86400, cancel_at_period_end: false, metadata: { tenantId: 'tenant-a' }, items: { data: [{ quantity: 1, price: { id: 'price_starter' } }] }, latest_invoice: { id: 'in_a', paid: true, billing_reason: 'subscription_cycle', period_end: Math.floor(Date.now() / 1000) + 86400 } };
const event = { id: 'evt_a', type: 'invoice.paid', livemode: false, data: { object: { customer: 'cus_a' } } };
function signed(value = event, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = Buffer.from(JSON.stringify(value));
  const signature = crypto.createHmac('sha256', 'whsec_test').update(`${timestamp}.`).update(raw).digest('hex');
  return { raw, header: `t=${timestamp},v1=${signature}` };
}
beforeEach(() => {
  vi.resetAllMocks();
  process.env.BILLING_MODE = 'test'; process.env.BILLING_ENFORCEMENT = 'true'; process.env.STRIPE_SECRET_KEY = 'sk_test_fixture'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  process.env.BILLING_PLANS_JSON = JSON.stringify([{ id: 'starter', name: 'Starter', priceId: 'price_starter', maxAgents: 2, monthlyCredits: 100 }]);
  tx.billingAccount.findUnique.mockResolvedValue(account); tx.billingAccount.findUniqueOrThrow.mockResolvedValue(account);
  tx.agent.count.mockResolvedValue(0);
  tx.billingEvent.findUnique.mockResolvedValue(null); tx.subscriptionTier.upsert.mockResolvedValue({ id: 'tier-a' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(current))));
});
afterEach(() => { process.env = { ...original }; vi.unstubAllGlobals(); });
it('accepts a valid raw-body signature and rejects modified bodies', () => {
  const { raw, header } = signed(); expect(verifyBillingEvent(raw, header).id).toBe('evt_a');
  expect(() => verifyBillingEvent(Buffer.from(raw.toString() + ' '), header)).toThrow('signature');
});
it.each([-301, 301])('rejects expired or future signatures (%s seconds)', offset => {
  const { raw, header } = signed(event, Math.floor(Date.now() / 1000) + offset);
  expect(() => verifyBillingEvent(raw, header)).toThrow('signature');
});
it('rejects duplicate timestamps and permits signature-key rotation', () => {
  const { raw, header } = signed(); expect(() => verifyBillingEvent(raw, `${header},t=1`)).toThrow();
  expect(verifyBillingEvent(raw, `${header},v1=${'0'.repeat(64)}`).id).toBe('evt_a');
});
it('rejects live events in test mode', () => {
  const { raw, header } = signed({ ...event, livemode: true }); expect(() => verifyBillingEvent(raw, header)).toThrow('environment');
});
it.each(['past_due', 'canceled', 'unpaid', 'incomplete', 'trialing', 'payment_unverified'])('does not grant paid access for %s', status => {
  expect(subscriptionEntitled({ ...account, status })).toBe(false);
});
it('ends access at period expiry and keeps paid access until scheduled cancellation', () => {
  expect(subscriptionEntitled({ ...account, periodEnd: new Date(0) })).toBe(false);
  expect(subscriptionEntitled(account)).toBe(true);
  expect(subscriptionEntitled({ ...account, livemode: true })).toBe(false);
});
it('enforces subscriptions without blocking unconfigured development by default', async () => {
  tx.billingAccount.findUnique.mockResolvedValue(null); await expect(assertSubscription('tenant-a')).rejects.toMatchObject({ statusCode: 402 });
  process.env.BILLING_ENFORCEMENT = 'false'; await expect(assertSubscription('tenant-a')).resolves.toBeUndefined();
});
it('atomically records a paid event and grants credits only once per invoice', async () => {
  await processBillingEvent(event);
  expect(tx.tenantCredits.upsert).toHaveBeenCalledOnce(); expect(tx.billingEvent.create).toHaveBeenCalledWith({ data: { id: 'evt_a', tenantId: 'tenant-a', type: 'invoice.paid' } });
  tx.billingAccount.findUniqueOrThrow.mockResolvedValue({ ...account, lastInvoiceId: 'in_a' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(current))));
  await processBillingEvent({ ...event, id: 'evt_b' }); expect(tx.tenantCredits.upsert).toHaveBeenCalledOnce();
});
it('deduplicates retries before provider calls', async () => {
  tx.billingEvent.findUnique.mockResolvedValue({ id: 'evt_a' }); expect(await processBillingEvent(event)).toEqual({ duplicate: true }); expect(fetch).not.toHaveBeenCalled();
});
it('uses fresh cancelled state for a delayed paid event', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...current, status: 'canceled' }))));
  await processBillingEvent(event);
  expect(tx.billingAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'canceled' }) }));
  expect(tx.tenantCredits.upsert).not.toHaveBeenCalled();
});
it('rejects cross-workspace subscription metadata', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...current, metadata: { tenantId: 'tenant-b' } }))));
  await expect(processBillingEvent(event)).rejects.toThrow('ownership'); expect(tx.billingEvent.create).not.toHaveBeenCalled();
});
it('rejects an unknown price without granting entitlements or credits', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...current, items: { data: [{ quantity: 1, price: { id: 'price_other' } }] } }))));
  await processBillingEvent(event); expect(tx.tenantCredits.upsert).not.toHaveBeenCalled();
  expect(tx.billingAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'payment_unverified', planId: null }) }));
});
it('does not acknowledge failed provider reads as processed events', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('provider secret', { status: 500 })));
  await expect(processBillingEvent(event)).rejects.toThrow('Payment provider'); expect(tx.billingEvent.create).not.toHaveBeenCalled();
});
it('rejects duplicate server-configured plan identifiers', () => {
  const plan = JSON.parse(process.env.BILLING_PLANS_JSON!)[0]; process.env.BILLING_PLANS_JSON = JSON.stringify([plan, plan]); expect(() => billingPlans()).toThrow('unique');
});
it.each(['/api/v1/tenants/tenant-a/billing/portal', '/api/v1/tenants/tenant-a/appointments/id/cancel', '/api/v1/tenants/tenant-a/sessions/id/pause'])('keeps billing and safety controls accessible: %s', async originalUrl => {
  tx.billingAccount.findUnique.mockResolvedValue(null); const next = vi.fn();
  await guardPaidRequest({ tenantId: 'tenant-a', method: 'POST', originalUrl, body: {} } as any, {} as any, next);
  expect(next).toHaveBeenCalledWith();
});
it('blocks a paid action for an unsubscribed workspace', async () => {
  tx.billingAccount.findUnique.mockResolvedValue(null); const next = vi.fn();
  await guardPaidRequest({ tenantId: 'tenant-a', method: 'POST', originalUrl: '/api/v1/tenants/tenant-a/workforce/ask', body: {} } as any, {} as any, next);
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 402 }));
});
it('enforces configured max-agent entitlements atomically', async () => {
  await expect(assertAgentCapacity('tenant-a', tx as any)).resolves.toBeUndefined();
  tx.agent.count.mockResolvedValue(2);
  await expect(assertAgentCapacity('tenant-a', tx as any)).rejects.toThrow('allows up to 2 agents');
  tx.billingAccount.findUnique.mockResolvedValue(null);
  await expect(assertAgentCapacity('tenant-a', tx as any)).rejects.toMatchObject({ statusCode: 402 });
});
