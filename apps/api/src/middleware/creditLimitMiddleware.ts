import { Request, Response, NextFunction } from 'express';
import { billingService } from '../services/billingService';
import { logger } from '../utils/logger';

/**
 * Middleware to check if tenant has sufficient credits before proceeding.
 * 'amount' is required per-route based on the action's complexity/cost.
 */
export const creditLimitMiddleware = (amount: number, description: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const tenantId = req.tenantId; // Assume tenantId is populated by authMiddleware

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const success = await billingService.consumeCredits(tenantId, amount, description);

    if (!success) {
      logger.warn('Insufficient credits for tenant', { tenantId, amount, description });
      return res.status(402).json({ 
        error: 'Insufficient credits',
        message: 'Your tenant has exhausted available credits. Please upgrade your plan or top up.'
      });
    }

    next();
  };
};
