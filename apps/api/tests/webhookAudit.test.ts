import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app } from '../src/app';
import request from 'supertest';
import { generateToken, seedTenantRolesAndPermissions } from '../src/services/authService';
import { StandardRoles } from '@ai-employee/shared';

describe('Webhook Config Audit Logging', () => {
  let tenant: any;
  let user: any;
  let authToken: string;

  beforeEach(async () => {
    // 1. Setup tenant and user
    tenant = await prisma.tenant.create({
      data: { name: `Webhook Audit Test Tenant ${Date.now()}` },
    });
    
    // Seed roles and permissions for this new tenant
    await seedTenantRolesAndPermissions(tenant.id);

    user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `test-${Date.now()}@example.com`,
        passwordHash: 'dummy',
      }
    });

    // Assign admin role to user
    const adminRole = await prisma.role.findFirst({ where: { tenantId: tenant.id, name: StandardRoles.ADMIN } });
    if (adminRole) {
        await prisma.userRole.create({
            data: { userId: user.id, roleId: adminRole.id }
        });
    }
    
    // 2. Generate valid JWT (with permissions)
    authToken = generateToken({
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      role: StandardRoles.ADMIN,
    });
  });

  it('should create an audit log when business config is created', async () => {
    // Given: No existing business
    // When: PUT config
    const response = await request(app)
      .put(`/api/v1/tenants/${tenant.id}/support-config`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'My New Business',
        industry: 'Tech',
      });

    expect(response.status).toBe(200);

    // Then: Audit log exists
    const auditLogs = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, operation: 'support_config_created' },
    });

    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].entityType).toBe('business');
    expect(JSON.parse(auditLogs[0].newValue!).name).toBe('My New Business');
  });

  it('should create an audit log when business config is updated', async () => {
    // Given: Existing business
    const business = await prisma.business.create({
      data: { tenantId: tenant.id, name: 'Old Name' }
    });

    // When: PUT config
    const response = await request(app)
      .put(`/api/v1/tenants/${tenant.id}/support-config`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'New Name',
      });

    expect(response.status).toBe(200);

    // Then: Audit log exists
    const auditLogs = await prisma.auditLog.findMany({
      where: { tenantId: tenant.id, operation: 'support_config_updated' },
    });

    expect(auditLogs.length).toBe(1);
    expect(JSON.parse(auditLogs[0].oldValue!).name).toBe('Old Name');
    expect(JSON.parse(auditLogs[0].newValue!).name).toBe('New Name');
  });
});
