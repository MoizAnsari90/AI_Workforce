import { describe, it, expect, vi } from 'vitest';
import { billingService } from '../src/services/billingService';
import { connectorService } from '../src/services/connectorService';
import { analyticsService } from '../src/services/analyticsService';
import { exportService } from '../src/services/exportService';
import { prisma } from '../src/lib/prisma';

// Mock everything
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    tenantCredits: { findUnique: vi.fn(), update: vi.fn() },
    creditConsumptionLog: { create: vi.fn() },
    integrationConfig: { upsert: vi.fn(), findUnique: vi.fn() },
    connectorWebhook: { create: vi.fn() },
    task: { count: vi.fn() },
    message: { count: vi.fn() },
    auditLog: { count: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn((callback) => callback(prisma)),
  },
}));

describe('Phase 10 Integration Tests', () => {
  it('Billing: should consume credits', async () => {
    (prisma.tenantCredits.findUnique as any).mockResolvedValue({ availableCredits: 100 });
    const success = await billingService.consumeCredits('t1', 10, 'Action');
    expect(success).toBe(true);
  });

  it('Connectors: should upsert integration', async () => {
    (prisma.integrationConfig.upsert as any).mockResolvedValue({ id: 'i1' });
    const res = await connectorService.upsertIntegration('t1', 'whatsapp', { key: 'val' });
    expect(res).toBeDefined();
  });

  it('Analytics: should calculate ROI', async () => {
    (prisma.task.count as any).mockResolvedValue(10);
    (prisma.message.count as any).mockResolvedValue(100);
    (prisma.auditLog.count as any).mockResolvedValue(10);
    const metrics = await analyticsService.getROIMetrics('t1');
    expect(metrics.hoursSaved).toBe(5);
    expect(metrics.resolutionRate).toBe('90.00');
  });

  it('Export: should export audit logs', async () => {
    (prisma.auditLog.findMany as any).mockResolvedValue([{ id: 'log1', operation: 'test' }]);
    const csv = await exportService.exportAuditLogsToCSV('t1');
    expect(csv).toContain('log1');
  });
});
