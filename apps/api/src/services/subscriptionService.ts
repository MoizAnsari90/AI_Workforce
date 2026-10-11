import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, ConflictError, ServiceUnavailableError, UnauthorizedError } from '../errors/AppError';

const planSchema = z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/), name: z.string().min(1).max(80), priceId: z.string().regex(/^price_[A-Za-z0-9]+$/), monthlyCredits: z.number().int().positive(), maxAgents: z.number().int().positive() }).strict();
export function billingPlans() {
  const plans = z.array(planSchema).max(10).parse(JSON.parse(process.env.BILLING_PLANS_JSON || '[]'));
  if (new Set(plans.map(p => p.id)).size !== plans.length || new Set(plans.map(p => p.priceId)).size !== plans.length) throw new ServiceUnavailableError('Billing plans must have unique IDs and prices.');
  return plans;
}
export function billingMode(): 'disabled' | 'test' | 'live' {
  return z.enum(['disabled', 'test', 'live']).parse(process.env.BILLING_MODE || 'disabled');
}
export function billingEnforced() { return process.env.BILLING_ENFORCEMENT === 'true'; }
function stripeKey() {
  const mode = billingMode(), key = process.env.STRIPE_SECRET_KEY || '';
  if (mode === 'disabled' || !(mode === 'live' ? /^sk_live_/ : /^sk_test_/).test(key)) throw new ServiceUnavailableError('Billing is not configured for this environment.');
  return key;
}
function webOrigin() {
  const url = new URL(process.env.WEB_APP_URL || 'http://localhost:3000');
  const secure = url.protocol === 'https:' || (billingMode() !== 'live' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ServiceUnavailableError('Set a valid WEB_APP_URL before enabling billing.');
  return url.origin;
}
export async function stripeRequest(path: string, body?: Record<string, string>, key?: string): Promise<unknown> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${stripeKey()}`, 'Stripe-Version': '2025-02-24.acacia', ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body ? { body: new URLSearchParams(body) } : {}) });
  if (!response.ok) throw new ServiceUnavailableError('Payment provider could not complete the request. Retry or contact support.');
  return response.json();
}
const providerId = z.string().regex(/^[a-z]+_[A-Za-z0-9]+$/);
const reference = z.union([providerId, z.object({ id: providerId })]).transform(value => typeof value === 'string' ? value : value.id);
const checkout = z.object({ id: providerId, url: z.string().url().nullable(), status: z.string(), expires_at: z.number().int(), subscription: reference.nullable().optional() });
const subscription = z.object({ id: providerId, customer: reference, livemode: z.boolean(), status: z.string(), current_period_end: z.number().int(), cancel_at_period_end: z.boolean(), metadata: z.record(z.string(), z.string()), items: z.object({ data: z.array(z.object({ quantity: z.number().int().nullable(), price: z.object({ id: providerId }) })).length(1) }), latest_invoice: z.object({ id: providerId, paid: z.boolean(), billing_reason: z.string().nullable(), period_end: z.number().int() }).nullable() });

export function subscriptionEntitled(account: { status: string; periodEnd: Date | null; planId: string | null; livemode: boolean } | null, now = new Date()) {
  return !!account && account.status === 'active' && !!account.planId && !!account.periodEnd && account.periodEnd > now && account.livemode === (billingMode() === 'live');
}
export async function assertSubscription(tenantId: string) {
  if (!billingEnforced()) return;
  if (billingMode() === 'disabled' || !subscriptionEntitled(await prisma.billingAccount.findUnique({ where: { tenantId } }))) throw new AppError('An active paid subscription is required. Open Billing to manage your plan.', 402, 'SUBSCRIPTION_REQUIRED');
}
export async function assertAgentCapacity(tenantId: string, tx: Pick<import('@prisma/client').Prisma.TransactionClient, 'billingAccount' | 'agent'>) {
  if (!billingEnforced()) return;
  const account = await tx.billingAccount.findUnique({ where: { tenantId }, select: { status: true, periodEnd: true, planId: true, livemode: true } });
  if (!account || !subscriptionEntitled(account)) throw new AppError('An active paid subscription is required. Open Billing before adding agents.', 402, 'SUBSCRIPTION_REQUIRED');
  const plan = billingPlans().find(item => item.id === account.planId);
  const count = await tx.agent.count({ where: { tenantId } });
  if (!plan || count >= plan.maxAgents) throw new ConflictError(`Your current plan allows up to ${plan?.maxAgents || 0} agents. Manage your plan to add another.`);
}
export async function hasSubscription(tenantId: string) {
  if (!billingEnforced()) return true;
  return billingMode() !== 'disabled' && subscriptionEntitled(await prisma.billingAccount.findUnique({ where: { tenantId } }));
}
export async function subscriptionStatus(tenantId: string) {
  const mode = billingMode();
  if (mode === 'disabled') return { mode, enforced: billingEnforced(), status: 'not_configured', entitled: false, plans: [] };
  const account = await prisma.billingAccount.findUnique({ where: { tenantId } });
  const plans = await Promise.all(billingPlans().map(async plan => {
    const price = z.object({ id: providerId, active: z.boolean(), livemode: z.boolean(), currency: z.string(), unit_amount: z.number().int().nonnegative().nullable(), recurring: z.object({ interval: z.literal('month'), interval_count: z.literal(1) }).nullable(), type: z.literal('recurring') }).parse(await stripeRequest(`prices/${plan.priceId}`));
    if (!price.active || !price.recurring || price.unit_amount === null || price.livemode !== (mode === 'live')) throw new ServiceUnavailableError('Configure active monthly flat-rate prices for this environment.');
    return { id: plan.id, name: plan.name, monthlyCredits: plan.monthlyCredits, maxAgents: plan.maxAgents, amount: price.unit_amount, currency: price.currency };
  }));
  const credits = await prisma.tenantCredits.findUnique({ where: { tenantId }, select: { availableCredits: true } });
  return { mode, enforced: billingEnforced(), status: account?.status || 'inactive', planId: account?.planId, periodEnd: account?.periodEnd, cancelAtPeriodEnd: account?.cancelAtPeriodEnd || false, entitled: subscriptionEntitled(account), availableCredits: credits?.availableCredits || 0, canManage: !!account, hasSubscription: !!account?.subscriptionId && !['canceled', 'incomplete_expired'].includes(account.status), plans };
}
export async function startSubscriptionCheckout(tenantId: string, planId: string) {
  const plan = billingPlans().find(item => item.id === planId);
  if (!plan) throw new ConflictError('Choose an available plan.');
  // Validate provider price/currency/mode before creating a payable checkout.
  await subscriptionStatus(tenantId);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${tenantId}`}))`;
    let account = await tx.billingAccount.findUnique({ where: { tenantId } });
    if (account && account.livemode !== (billingMode() === 'live')) throw new ConflictError('A test billing account cannot be reused for live payments. Use a separate production database.');
    if (!account) {
      const customer = z.object({ id: providerId }).parse(await stripeRequest('customers', { 'metadata[tenantId]': tenantId }, `customer:${billingMode()}:${tenantId}`));
      account = await tx.billingAccount.create({ data: { tenantId, customerId: customer.id, livemode: billingMode() === 'live' } });
    }
    if (account.subscriptionId) {
      const current = z.object({ status: z.string() }).parse(await stripeRequest(`subscriptions/${account.subscriptionId}`));
      if (!['canceled', 'incomplete_expired'].includes(current.status)) throw new ConflictError('A subscription already exists. Use Manage subscription to update or cancel it.');
    }
    if (account.checkoutId && account.checkoutExpiresAt && account.checkoutExpiresAt > new Date()) {
      const existing = checkout.extend({ line_items: z.object({ data: z.array(z.object({ price: z.object({ id: providerId }) })) }).optional() }).parse(await stripeRequest(`checkout/sessions/${account.checkoutId}?expand[]=line_items`));
      if (existing.status === 'open') {
        if (existing.line_items?.data.length === 1 && existing.line_items.data[0].price.id === plan.priceId && existing.url && new URL(existing.url).protocol === 'https:' && new URL(existing.url).hostname === 'checkout.stripe.com') return { url: existing.url };
        // A different plan must not silently reuse the previous plan's checkout.
        await stripeRequest(`checkout/sessions/${account.checkoutId}/expire`, {});
      }
      if (existing.status === 'complete') throw new ConflictError('Payment confirmation is processing. Refresh Billing before starting another checkout.');
    }
    const origin = webOrigin();
    const session = checkout.parse(await stripeRequest('checkout/sessions', { mode: 'subscription', customer: account.customerId, client_reference_id: tenantId, 'metadata[tenantId]': tenantId, 'subscription_data[metadata][tenantId]': tenantId, 'line_items[0][price]': plan.priceId, 'line_items[0][quantity]': '1', success_url: `${origin}/dashboard/billing?checkout=returned`, cancel_url: `${origin}/dashboard/billing?checkout=cancelled` }, `checkout:${tenantId}:${account.checkoutId || 'initial'}:${plan.id}`));
    if (!session.url || new URL(session.url).hostname !== 'checkout.stripe.com') throw new ServiceUnavailableError('The payment provider did not return a valid checkout URL.');
    await tx.billingAccount.update({ where: { tenantId }, data: { checkoutId: session.id, checkoutUrl: session.url, checkoutExpiresAt: new Date(session.expires_at * 1000), subscriptionId: null, status: 'checkout_pending' } });
    return { url: session.url };
  }, { timeout: 60000, maxWait: 10000 });
}
export async function subscriptionPortal(tenantId: string) {
  const account = await prisma.billingAccount.findUnique({ where: { tenantId } });
  if (!account || account.livemode !== (billingMode() === 'live')) throw new ConflictError('No billing account exists in this environment.');
  const result = z.object({ url: z.string().url() }).parse(await stripeRequest('billing_portal/sessions', { customer: account.customerId, return_url: `${webOrigin()}/dashboard/billing` }));
  if (new URL(result.url).hostname !== 'billing.stripe.com') throw new ServiceUnavailableError('Invalid billing portal URL.');
  return result;
}

export function verifyBillingEvent(raw: Buffer, header: string | undefined, now = Date.now()) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !secret.startsWith('whsec_') || billingMode() === 'disabled') throw new ServiceUnavailableError('Billing webhook is not configured.');
  if (!Buffer.isBuffer(raw) || !header) throw new UnauthorizedError('Invalid payment signature.');
  const fields = header.split(',').map(field => field.trim().split('='));
  const timestamps = fields.filter(([key]) => key === 't');
  const timestamp = timestamps[0]?.[1];
  if (timestamps.length !== 1 || !/^\d+$/.test(timestamp || '') || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new UnauthorizedError('Invalid payment signature.');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  if (!fields.some(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/i.test(value || '') && crypto.timingSafeEqual(expected, Buffer.from(value, 'hex')))) throw new UnauthorizedError('Invalid payment signature.');
  const event = z.object({ id: providerId, type: z.string(), livemode: z.boolean(), data: z.object({ object: z.object({ customer: reference.optional() }).passthrough() }) }).parse(JSON.parse(raw.toString('utf8')));
  if (event.livemode !== (billingMode() === 'live')) throw new UnauthorizedError('Payment environment mismatch.');
  return event;
}
export async function processBillingEvent(event: ReturnType<typeof verifyBillingEvent>) {
  if (!['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'].includes(event.type)) return { ignored: true };
  const customerId = event.data.object.customer;
  if (!customerId) return { ignored: true };
  const owner = await prisma.billingAccount.findUnique({ where: { customerId } });
  if (!owner) return { ignored: true };
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${owner.tenantId}`}))`;
    if (await tx.billingEvent.findUnique({ where: { id: event.id } })) return { duplicate: true };
    const account = await tx.billingAccount.findUniqueOrThrow({ where: { tenantId: owner.tenantId } });
    let subscriptionId = account.subscriptionId;
    if (!subscriptionId && account.checkoutId) subscriptionId = checkout.parse(await stripeRequest(`checkout/sessions/${account.checkoutId}`)).subscription || null;
    // A subscription-created event can arrive before Checkout completes. The
    // checkout completion/invoice event will retry synchronization afterwards.
    if (!subscriptionId) return { pendingCheckout: true };
    // Retrieve fresh state inside the workspace lock: delayed events cannot roll
    // a cancelled/past-due subscription back to an old paid snapshot.
    const current = subscription.parse(await stripeRequest(`subscriptions/${subscriptionId}?expand[]=latest_invoice`));
    if (current.customer !== account.customerId || current.metadata.tenantId !== account.tenantId || current.livemode !== account.livemode || current.livemode !== event.livemode) throw new ConflictError('Subscription ownership could not be verified.');
    const plan = billingPlans().find(item => item.priceId === current.items.data[0].price.id);
    const validPlan = plan && current.items.data[0].quantity === 1 ? plan : null;
    const invoice = current.latest_invoice;
    const paid = current.status === 'active' && invoice?.paid === true && !!validPlan;
    const periodEnd = new Date(current.current_period_end * 1000);
    const status = paid ? 'active' : current.status === 'active' ? 'payment_unverified' : current.status;
    const grant = paid && periodEnd > new Date() && invoice.id !== account.lastInvoiceId && ['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason || '');
    let tierId: string | undefined;
    if (validPlan) {
      const tier = await tx.subscriptionTier.upsert({ where: { name: `billing:${validPlan.id}` }, create: { name: `billing:${validPlan.id}`, maxAgents: validPlan.maxAgents, maxToolCallsPerMonth: validPlan.monthlyCredits }, update: { maxAgents: validPlan.maxAgents, maxToolCallsPerMonth: validPlan.monthlyCredits } });
      tierId = tier.id;
      if (grant) await tx.tenantCredits.upsert({ where: { tenantId: owner.tenantId }, create: { tenantId: owner.tenantId, tierId, availableCredits: validPlan.monthlyCredits }, update: { tierId, availableCredits: validPlan.monthlyCredits, lastRefillAt: new Date() } });
    }
    await tx.billingAccount.update({ where: { tenantId: owner.tenantId }, data: { subscriptionId, status, planId: validPlan?.id || null, periodEnd, cancelAtPeriodEnd: current.cancel_at_period_end, ...(grant ? { lastInvoiceId: invoice!.id } : {}) } });
    await tx.tenant.update({ where: { id: owner.tenantId }, data: { stripeCustomerId: customerId, stripeSubscriptionStatus: status, subscriptionTierId: tierId || null } });
    await tx.billingEvent.create({ data: { id: event.id, tenantId: owner.tenantId, type: event.type } });
    return { processed: true };
  }, { timeout: 45000, maxWait: 10000 });
}
