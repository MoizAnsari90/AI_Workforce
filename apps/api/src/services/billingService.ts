import { prisma } from '../lib/prisma';

export const billingService = {
  /**
   * Deducts credits for a specific action.
   * Returns true if successful, false if insufficient credits.
   */
  async consumeCredits(tenantId: string, amount: number, description: string): Promise<boolean> {
    return await prisma.$transaction(async (tx) => {
      const credits = await tx.tenantCredits.findUnique({
        where: { tenantId },
      });

      if (!credits || credits.availableCredits < amount) {
        return false;
      }

      await tx.tenantCredits.update({
        where: { tenantId },
        data: { availableCredits: { decrement: amount } },
      });

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
