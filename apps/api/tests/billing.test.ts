import { describe, it, expect, vi, beforeEach } from 'vitest';
import { billingService } from '../src/services/billingService';
import { prisma } from '../src/lib/prisma';
const subscriptionMock = vi.hoisted(() => ({ enforce: vi.fn(() => true), assert: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/subscriptionService', () => ({ billingEnforced: subscriptionMock.enforce, assertSubscription: subscriptionMock.assert }));

// Mock Prisma
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn((callback) => callback(prismaMock)),
    tenantCredits: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    creditConsumptionLog: {
      create: vi.fn(),
    },
  },
}));

const prismaMock = {
  tenantCredits: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  creditConsumptionLog: {
    create: vi.fn(),
  },
};

describe('BillingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptionMock.enforce.mockReturnValue(true);
    subscriptionMock.assert.mockResolvedValue(undefined);
  });

  it('should deduct credits when sufficient', async () => {
    prismaMock.tenantCredits.updateMany.mockResolvedValue({ count: 1 });

    prismaMock.creditConsumptionLog.create.mockResolvedValue({});

    const success = await billingService.consumeCredits('tenant-1', 10, 'Test Action');

    expect(success).toBe(true);
    expect(prismaMock.tenantCredits.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1', availableCredits: { gte: 10 } },
      data: { availableCredits: { decrement: 10 } }
    }));
  });

  it('should fail when insufficient credits', async () => {
    prismaMock.tenantCredits.updateMany.mockResolvedValue({ count: 0 });

    const success = await billingService.consumeCredits('tenant-1', 10, 'Test Action');

    expect(success).toBe(false);
    expect(prismaMock.creditConsumptionLog.create).not.toHaveBeenCalled();
  });

  it('does not meter local requests while billing enforcement is disabled', async () => {
    subscriptionMock.enforce.mockReturnValue(false);
    await expect(billingService.consumeCredits('tenant-1', 1, 'assistant_question')).resolves.toBe(true);
    expect(prismaMock.tenantCredits.updateMany).not.toHaveBeenCalled();
  });
});
