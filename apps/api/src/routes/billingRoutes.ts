import { Router, raw } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { subscriptionStatus, startSubscriptionCheckout, subscriptionPortal, verifyBillingEvent, processBillingEvent } from '../services/subscriptionService';

export const billingWebhookRouter = Router();
billingWebhookRouter.post('/api/v1/billing/webhook', raw({ type: 'application/json', limit: '1mb' }), async (req, res, next) => {
  try { res.json({ success: true, data: await processBillingEvent(verifyBillingEvent(req.body, req.get('stripe-signature'))) }); } catch (error) { next(error); }
});
export const billingRouter = Router();
const base = '/tenants/:tenantId/billing';
billingRouter.use(base, authenticate, enforceTenantIsolation, requireRole('admin'));
billingRouter.get(base, async (req, res, next) => { try { res.json({ success: true, data: await subscriptionStatus(req.tenantId!) }); } catch (error) { next(error); } });
billingRouter.post(`${base}/checkout`, async (req, res, next) => {
  try { const { planId } = z.object({ planId: z.string().min(1).max(40) }).strict().parse(req.body); res.json({ success: true, data: await startSubscriptionCheckout(req.tenantId!, planId) }); } catch (error) { next(error); }
});
billingRouter.post(`${base}/portal`, async (req, res, next) => { try { res.json({ success: true, data: await subscriptionPortal(req.tenantId!) }); } catch (error) { next(error); } });
