import { prisma } from '../lib/prisma';
import { Parser } from 'json2csv';

export const exportService = {
  /**
   * Generates a CSV audit export for a specific tenant.
   */
  async exportAuditLogsToCSV(tenantId: string, startDate?: Date, endDate?: Date): Promise<string> {
    const logs = await prisma.auditLog.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (logs.length === 0) return 'No logs found';

    const fields = ['id', 'actorType', 'actorId', 'operation', 'entityType', 'entityId', 'createdAt'];
    const json2csvParser = new Parser({ fields });
    return json2csvParser.parse(logs);
  },
};
