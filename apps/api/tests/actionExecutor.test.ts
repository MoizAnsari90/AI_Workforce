// These integration tests exercise the local approval flow, never a real provider.
vi.mock('../src/services/shopifyClient', () => ({ ShopifyClient: { forTenant: vi.fn().mockResolvedValue({}) } }));
vi.mock('../src/tools/shopifyTool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/tools/shopifyTool')>();
  return { ...actual, ShopifyTool: { processRefund: vi.fn(async (_tenant, payload) => ({ success: true, ...payload, status: 'processed' })) } };
});
import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { ActionExecutorService } from '../src/services/actionExecutorService';
import { ApprovalService } from '../src/services/approvalService';

describe('ActionExecutor & HITL Approval Flow Tests', () => {
  it('should pause risky actions (e.g. Shopify Refund) and create pending approval request', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Test Tenant Action ${Date.now()}` },
    });

    const agent = await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: 'Support & Operations Agent',
        department: 'support',
      },
    });

    // Execute risky action (Shopify refund)
    const executionResponse = await ActionExecutorService.executeAction({
      tenantId: tenant.id,
      agentId: agent.id,
      actionType: 'shopify_refund',
      payload: { orderId: 'gid://shopify/Order/999', amount: 250, currency: 'USD', parentTransactionId: 'gid://shopify/OrderTransaction/123' },
    });

    expect(executionResponse.status).toBe('PAUSED_FOR_APPROVAL');
    expect(executionResponse.requestId).toBeDefined();

    // Verify approval request in DB
    const approval = await prisma.approvalRequest.findUnique({
      where: { id: executionResponse.requestId! },
    });

    expect(approval).not.toBeNull();
    expect(approval?.status).toBe('pending');
    expect(approval?.actionType).toBe('shopify_refund');
  });

  it('should execute low-risk actions (e.g. stock check or CRM lead creation) directly without pausing', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Test Tenant LowRisk ${Date.now()}` },
    });

    const agent = await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: 'Sales Agent',
        department: 'sales',
      },
    });

    // Execute low-risk action (CRM lead creation)
    const executionResponse = await ActionExecutorService.executeAction({
      tenantId: tenant.id,
      agentId: agent.id,
      actionType: 'crm_lead',
      payload: { name: 'John Doe', email: 'john@example.com' },
    });

    expect(executionResponse.status).toBe('SUCCESS');
    expect(executionResponse.result).toBeDefined();
    expect(executionResponse.result.success).toBe(true);
    expect(executionResponse.result.action).toBe('create_lead');
  });

  it('should execute risky actions successfully once approved by human', async () => {
    const tenant = await prisma.tenant.create({
      data: { name: `Test Tenant ApprovedAction ${Date.now()}` },
    });

    const agent = await prisma.agent.create({
      data: {
        tenantId: tenant.id,
        name: 'Finance Agent',
        department: 'finance',
      },
    });

    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `manager_${Date.now()}@example.com`,
        passwordHash: 'hash123',
      },
    });

    // 1. Trigger risky action -> Paused
    const pausedResponse = await ActionExecutorService.executeAction({
      tenantId: tenant.id,
      agentId: agent.id,
      actionType: 'shopify_refund',
      payload: { orderId: 'gid://shopify/Order/555', amount: 80, currency: 'USD', parentTransactionId: 'gid://shopify/OrderTransaction/123' },
    });

    expect(pausedResponse.status).toBe('PAUSED_FOR_APPROVAL');
    const approvalId = pausedResponse.requestId!;

    // 2. Human approves the request
    await ApprovalService.reviewApprovalRequest({
      approvalId,
      tenantId: tenant.id,
      userId: user.id,
      status: 'approved',
    });

    // 3. Re-execute action with approved approvalId -> Should succeed direct API call
    const successResponse = await ActionExecutorService.executeAction({
      tenantId: tenant.id,
      agentId: agent.id,
      actionType: 'shopify_refund',
      payload: { orderId: 'gid://shopify/Order/555', amount: 80, currency: 'USD', parentTransactionId: 'gid://shopify/OrderTransaction/123' },
      approvalId,
    });

    expect(successResponse.status).toBe('SUCCESS');
    expect(successResponse.result.success).toBe(true);
    expect(successResponse.result.amount).toBe(80);
  });
});
