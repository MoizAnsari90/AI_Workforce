import { prisma } from '../lib/prisma';

export const analyticsService = {
  /**
   * Aggregates ROI metrics for a tenant.
   */
  async getROIMetrics(tenantId: string) {
    // 1. Calculate Human Hours Saved
    // Assume 1 automated task saves 0.5 hours of manual work (configurable)
    const [automatedTasks, inboundCustomerMessages, aiOutboundReplies] = await Promise.all([
      prisma.task.count({ where: { tenantId, status: 'completed', agentId: { not: null } } }),
      prisma.message.count({ where: { tenantId, direction: 'inbound', senderType: 'customer' } }),
      prisma.message.count({ where: { tenantId, direction: 'outbound', senderType: 'ai' } }),
    ]);

    return {
      automatedTasks,
      inboundCustomerMessages,
      aiOutboundReplies,
      aiRepliesPer100Inbound: inboundCustomerMessages === 0
        ? null
        : Math.round(aiOutboundReplies / inboundCustomerMessages * 100),
      hoursSaved: null,
      totalCostSaved: null,
    };
  },
};
