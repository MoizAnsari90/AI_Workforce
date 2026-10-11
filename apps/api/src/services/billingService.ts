import { prisma } from '../lib/prisma';
import { assertSubscription, billingEnforced } from './subscriptionService';

export const billingService = {
  /**
   * Deducts credits for a specific action.
   * Returns true if successful, false if insufficient credits.
   */
  async consumeCredits(tenantId: string, amount: number, description: string): Promise<boolean> {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Credit consumption must be a positive integer');
    // Local development and unconfigured billing retain the usable prototype flow.
    if (!billingEnforced()) return true;
    await assertSubscription(tenantId);
    return await prisma.$transaction(async (tx) => {
      const changed = await tx.tenantCredits.updateMany({
        where: { tenantId, availableCredits: { gte: amount } },
        data: { availableCredits: { decrement: amount } },
      });
      if (changed.count !== 1) return false;

      await tx.creditConsumptionLog.create({
        data: {
          tenantId,
          amount,
          description,
        },
      });

      return true;
    });
  },

  async getRemainingCredits(tenantId: string): Promise<number> {
    const credits = await prisma.tenantCredits.findUnique({
      where: { tenantId },
      select: { availableCredits: true },
    });
    return credits?.availableCredits ?? 0;
  },
};
