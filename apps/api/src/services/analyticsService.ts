import { prisma } from '../lib/prisma';

export const analyticsService = {
  /**
   * Aggregates ROI metrics for a tenant.
   */
  async getROIMetrics(tenantId: string) {
    // 1. Calculate Human Hours Saved
    // Assume 1 automated task saves 0.5 hours of manual work (configurable)
    const automatedTasks = await prisma.task.count({
      where: {
        tenantId,
        status: 'completed',
        agentId: { not: null },
      },
    });
    const hoursSaved = automatedTasks * 0.5;

    // 2. Resolution Rate vs Escalation
    const totalMessages = await prisma.message.count({ where: { tenantId } });
    const escalatedMessages = await prisma.auditLog.count({
      where: { tenantId, operation: 'ai_escalated' },
    });
    
    const resolutionRate = totalMessages > 0 
      ? ((totalMessages - escalatedMessages) / totalMessages) * 100 
      : 100;

    // 3. Estimated Cost Saved (e.g., $20/hour cost)
    const totalCostSaved = hoursSaved * 20;

    return {
      hoursSaved,
      resolutionRate: resolutionRate.toFixed(2),
      totalCostSaved,
    };
  },
};
