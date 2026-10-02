import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

// Keys carry tenant, action, resource and request hash; resources may contain colons.
function details(key: string) {
  const parts = key.split(':');
  if (parts.length < 4) throw new Error('Invalid idempotency key');
  return { tenantId: parts[0], actionType: parts[1], targetResource: parts.slice(2, -1).join(':'), requestHash: parts[parts.length - 1] };
}
export class IdempotencyService {
  static async generateIdempotencyKey(params: { tenantId: string; actionType: string; targetResource: string; requestData: string }) {
    const hash = crypto.createHash('sha256').update(params.requestData).digest('hex');
    const key = `${params.tenantId}:${params.actionType}:${params.targetResource}:${hash}`;
    return { key, idempotencyLog: await this.checkIdempotency(key) };
  }
  static async checkIdempotency(key: string) {
    const { tenantId } = details(key);
    return prisma.idempotencyLog.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: key } } });
  }
  static async createPendingLog(key: string, tenantId: string, actionType: string, targetResource: string) {
    const parsed = details(key);
    if (tenantId !== parsed.tenantId || actionType !== parsed.actionType || targetResource !== parsed.targetResource) throw new Error('Idempotency key does not match request');
    // Unique constraint arbitrates concurrent executions; never upsert a claim.
    return prisma.idempotencyLog.create({ data: { ...parsed, idempotencyKey: key, status: 'pending' } });
  }
  static async logSuccess(key: string, resourceId: string, responseSnapshot?: Prisma.InputJsonValue) {
    const parsed = details(key);
    await prisma.idempotencyLog.upsert({
      where: { tenantId_idempotencyKey: { tenantId: parsed.tenantId, idempotencyKey: key } },
      update: { status: 'succeeded', targetResource: resourceId, responseSnapshot, completedAt: new Date() },
      create: { ...parsed, idempotencyKey: key, targetResource: resourceId, status: 'succeeded', responseSnapshot, completedAt: new Date() },
    });
  }
  static async logFailure(key: string, errorMessage: string) {
    const parsed = details(key);
    await prisma.idempotencyLog.upsert({
      where: { tenantId_idempotencyKey: { tenantId: parsed.tenantId, idempotencyKey: key } },
      update: { status: 'failed', errorMessage, completedAt: new Date() },
      create: { ...parsed, idempotencyKey: key, status: 'failed', errorMessage, completedAt: new Date() },
    });
  }
}
