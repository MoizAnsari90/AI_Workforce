import { describe, it, expect, vi, beforeEach } from 'vitest';
import { billingService } from '../src/services/billingService';
import { prisma } from '../src/lib/prisma';

// Mock Prisma
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn((callback) => callback(prismaMock)),
    tenantCredits: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    creditConsumptionLog: {
      create: vi.fn(),
    },
  },
}));

const prismaMock = {
  tenantCredits: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  creditConsumptionLog: {
    create: vi.fn(),
  },
};

describe('BillingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should deduct credits when sufficient', async () => {
    prismaMock.tenantCredits.findUnique.mockResolvedValue({ availableCredits: 50 });
    prismaMock.tenantCredits.update.mockResolvedValue({});
    prismaMock.creditConsumptionLog.create.mockResolvedValue({});

    const success = await billingService.consumeCredits('tenant-1', 10, 'Test Action');

    expect(success).toBe(true);
    expect(prismaMock.tenantCredits.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-1' },
      data: { availableCredits: { decrement: 10 } }
    }));
  });

  it('should fail when insufficient credits', async () => {
    prismaMock.tenantCredits.findUnique.mockResolvedValue({ availableCredits: 5 });

    const success = await billingService.consumeCredits('tenant-1', 10, 'Test Action');

    expect(success).toBe(false);
    expect(prismaMock.tenantCredits.update).not.toHaveBeenCalled();
  });
});
