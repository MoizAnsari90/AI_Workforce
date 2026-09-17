import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

export interface CreateAuditLogParams {
  tenantId: string;
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  operation: string;
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export async function recordAuditLog(params: CreateAuditLogParams) {
  try {
    const auditLog = await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        actorType: params.actorType,
        actorId: params.actorId,
        operation: params.operation,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue: params.oldValue ? JSON.stringify(params.oldValue) : null,
        newValue: params.newValue ? JSON.stringify(params.newValue) : null,
      },
    });

    logger.info('Audit log recorded', {
      tenantId: params.tenantId,
      operation: params.operation,
      entityType: params.entityType,
      entityId: params.entityId,
    });

    return auditLog;
  } catch (error) {
    logger.error('Failed to write audit log record', {
      error: error instanceof Error ? error.message : String(error),
      params,
    });
    // Audit log failures should not silently fail, rethrow or log explicitly
    throw error;
  }
}
