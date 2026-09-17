import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { recordAuditLog } from '../src/services/auditService';

describe('Audit Logging Foundation', () => {
  it('recordAuditLog should persist an immutable audit record to the database', async () => {
    // 1. Create a dummy tenant
    const tenant = await prisma.tenant.create({
      data: {
        name: `Audit Test Tenant ${Date.now()}`,
      },
    });

    // 2. Record sensitive operation
    const auditRecord = await recordAuditLog({
      tenantId: tenant.id,
      actorType: 'user',
      actorId: 'usr_test_123',
      operation: 'update_system_prompt',
      entityType: 'agent',
      entityId: 'agt_test_456',
      oldValue: { prompt: 'Old prompt' },
      newValue: { prompt: 'New approved system prompt' },
    });

    expect(auditRecord).toHaveProperty('id');
    expect(auditRecord.tenantId).toBe(tenant.id);
    expect(auditRecord.operation).toBe('update_system_prompt');
    expect(auditRecord.entityType).toBe('agent');
    expect(auditRecord.entityId).toBe('agt_test_456');

    // 3. Verify in database
    const fetched = await prisma.auditLog.findUnique({
      where: { id: auditRecord.id },
    });

    expect(fetched).not.toBeNull();
    expect(fetched?.tenantId).toBe(tenant.id);
    expect(JSON.parse(fetched!.newValue!)).toEqual({ prompt: 'New approved system prompt' });
  });
});
