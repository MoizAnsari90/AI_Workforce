import { describe, it, expect } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ApprovalService } from '../src/services/approvalService';
import { IntegrationService } from '../src/services/integrationService';

describe('ApprovalService and IntegrationService Tests', () => {
  it('should create, fetch, and review approval requests with tenant isolation', async () => {
    // 1. Create tenant, agent, and user
    const tenant = await prisma.tenant.create({
      data: { name: `Test Tenant Approval ${Date.now()}` },
    });

    const agent = await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: 'Support Agent',
        department: 'support',
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `admin_${Date.now()}@example.com`,
        passwordHash: 'hash123',
      },
    });

    // 2. Create approval request
    const approval = await ApprovalService.createApprovalRequest({
      tenantId: tenant.id,
      requestedByAgentId: agent.id,
      actionType: 'shopify_refund',
      actionPayload: { orderId: 'ord_123', amount: 150 },
    });

    expect(approval).toHaveProperty('id');
    expect(approval.status).toBe('pending');
    expect(approval.tenantId).toBe(tenant.id);

    // 3. Fetch pending requests
    const pending = await ApprovalService.getPendingRequests(tenant.id);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].id).toBe(approval.id);

    // 4. Review (Approve) request
    const approved = await ApprovalService.reviewApprovalRequest({
      approvalId: approval.id,
      tenantId: tenant.id,
      userId: user.id,
      status: 'approved',
    });

    expect(approved.status).toBe('approved');
    expect(approved.reviewedByUserId).toBe(user.id);

    // 5. Verify pending list is now empty
    const pendingAfter = await ApprovalService.getPendingRequests(tenant.id);
    expect(pendingAfter.find(p => p.id === approval.id)).toBeUndefined();
  });

  it('should securely store, retrieve, and delete external integration credentials', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Test Tenant Integration ${Date.now()}` },
    });

    const provider = 'shopify';
    const config = { accessToken: 'shpat_secret_token_123', shop: 'mystore.myshopify.com' };

    // 1. Store credential
    const stored = await IntegrationService.storeCredential({
      tenantId: tenant.id,
      provider,
      config,
      userId: undefined,
    });

    expect(stored).toHaveProperty('id');
    expect(stored.provider).toBe(provider);

    // 2. Retrieve and decrypt credential
    const decryptedConfig = await IntegrationService.getCredential(tenant.id, provider);
    expect(decryptedConfig).toEqual(config);

    // 3. Delete credential
    const deleted = await IntegrationService.deleteCredential(tenant.id, provider);
    expect(deleted).toBe(true);

    // 4. Verify retrieval returns null after deletion
    const afterDelete = await IntegrationService.getCredential(tenant.id, provider);
    expect(afterDelete).toBeNull();
  });
});
