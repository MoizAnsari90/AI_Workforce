import { Request, Response, NextFunction } from 'express';
import { assertSubscription, billingEnforced } from '../services/subscriptionService';

// Billing, setup, reads, staff handoff, cancellation and pause remain available.
export async function guardPaidRequest(req: Request, _res: Response, next: NextFunction) {
  try {
    if (billingEnforced() && req.tenantId && !['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method)) {
      const path = req.originalUrl.split('?')[0];
      const safetyAction = /\/(cancel|pause|stop|disconnect|reply)$/.test(path);
      const setupOrBilling = /\/(billing|auth|onboarding-status|business-profile|business-setup|shopify|woocommerce|calendar|whatsapp\/onboarding)(\/|$)/.test(path);
      // The toggle route checks subscription only when resuming; pausing must stay available.
      const agentToggle = /\/tenants\/[^/]+\/agents\/[^/]+\/toggle$/.test(path);
      const disabling = req.body?.isActive === false || req.body?.active === false || req.body?.enabled === false || req.body?.activate === false || (req.body?.whatsappEnabled === false && req.body?.voiceEnabled === false && req.body?.remindersEnabled === false);
      if (!safetyAction && !setupOrBilling && !disabling && !agentToggle) await assertSubscription(req.tenantId);
    }
    next();
  } catch (error) { next(error); }
}
