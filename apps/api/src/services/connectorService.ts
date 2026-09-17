import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

export const connectorService = {
  /**
   * Retrieves active integration configuration for a provider.
   */
  async getIntegration(tenantId: string, provider: string) {
    return await prisma.integrationConfig.findUnique({
      where: {
        tenantId_provider: {
          tenantId,
          provider,
        },
      },
    });
  },

  /**
   * Upserts integration configuration (safely stores credentials).
   */
  async upsertIntegration(tenantId: string, provider: string, config: any) {
    return await prisma.integrationConfig.upsert({
      where: {
        tenantId_provider: {
          tenantId,
          provider,
        },
      },
      update: { config, isActive: true },
      create: { tenantId, provider, config, isActive: true },
    });
  },

  /**
   * Logs incoming webhook event.
   */
  async logWebhook(integrationId: string, eventType: string, payload: any) {
    return await prisma.connectorWebhook.create({
      data: {
        integrationId,
        eventType,
        payload,
      },
    });
  },
};
