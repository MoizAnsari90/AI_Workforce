import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { emitToTenant } from '../lib/socket';
import { recordAuditLog } from './auditService';
import { ShopifyTool, shopifyRefundSchema, shopifyStockSchema, shopifyCancelSchema } from '../tools/shopifyTool';
import { ShopifyClient } from './shopifyClient';
import { QuickBooksTool } from '../tools/quickBooksTool';
import { CrmTool } from '../tools/crmTool';

export interface ExecuteActionParams {
  tenantId: string; agentId: string; actionType: string; payload: Record<string, any>; approvalId?: string;
}
const invoiceSchema = z.object({ customerId: z.string().min(1), amount: z.number().positive(), lineItems: z.array(z.object({ description: z.string(), amount: z.number() })) }).strict();
const expenseSchema = z.object({ vendorId: z.string().min(1), amount: z.number().positive(), category: z.string().min(1) }).strict();
const leadSchema = z.object({ name: z.string().min(1), email: z.string().email(), phone: z.string().optional(), source: z.string().optional() }).strict();
const pipelineSchema = z.object({ leadId: z.string().min(1), stage: z.string().min(1) }).strict();
const schemas: Record<string, z.ZodType> = {
  shopify_refund: shopifyRefundSchema, shopify_stock_check: shopifyStockSchema, shopify_cancel: shopifyCancelSchema,
  qbo_invoice: invoiceSchema, qbo_expense: expenseSchema, crm_lead: leadSchema, crm_pipeline: pipelineSchema,
};

export class ActionExecutorService {
  static isActionRisky(actionType: string, payload: Record<string, any>): boolean {
    if (['shopify_refund', 'shopify_cancel', 'social_publish', 'external_email_send'].includes(actionType)) return true;
    if (actionType === 'purchase_order' && (payload.amount ?? 0) > 1000) return true;
    return actionType === 'qbo_invoice' && (payload.amount ?? 0) > 5000;
  }
  static async executeAction(params: ExecuteActionParams) {
    const { tenantId, agentId, actionType, approvalId } = params;
    if (!schemas[actionType]) throw new Error('Unsupported action type');
    const payload = schemas[actionType].parse(params.payload) as Record<string, any>;
    const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId }, select: { id: true } });
    if (!agent) throw new Error('Agent not found for this tenant');
    // Missing/disabled credentials must never produce a successful simulated action.
    if (actionType.startsWith('shopify_')) await ShopifyClient.forTenant(tenantId, actionType !== 'shopify_stock_check');

    if (approvalId) {
      const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalId, tenantId } });
      if (!approval || approval.status !== 'approved') throw new Error('Approval is missing, not approved, or already used');
      if (approval.requestedByAgentId !== agentId || approval.actionType !== actionType ||
          !isDeepStrictEqual(approval.actionPayload, payload)) throw new Error('Action does not match the approved agent and payload');
      // Atomic claim: only one caller can consume this approval.
      const claimed = await prisma.approvalRequest.updateMany({
        where: { id: approvalId, tenantId, status: 'approved', updatedAt: approval.updatedAt },
        data: { status: 'executing' },
      });
      if (claimed.count !== 1) throw new Error('Approval has already been claimed');
    } else if (this.isActionRisky(actionType, payload)) {
      const approval = await prisma.approvalRequest.create({
        data: { tenantId, requestedByAgentId: agentId, actionType, actionPayload: payload, status: 'pending' },
      });
      emitToTenant(tenantId, 'approval:created', { approvalId: approval.id, agentId, actionType, payload, createdAt: approval.createdAt });
      await recordAuditLog({ tenantId, actorType: 'agent', actorId: agentId, operation: 'pause_action_for_approval',
        entityType: 'approval_request', entityId: approval.id, newValue: { actionType, payload, status: 'pending' } });
      return { status: 'PAUSED_FOR_APPROVAL', requestId: approval.id, message: 'Human approval is required.' };
    }

    try {
      let result: any;
      switch (actionType) {
        case 'shopify_refund': result = await ShopifyTool.processRefund(tenantId, shopifyRefundSchema.parse(payload), approvalId!); break;
        case 'shopify_stock_check': result = await ShopifyTool.checkStock(tenantId, shopifyStockSchema.parse(payload)); break;
        case 'shopify_cancel': result = await ShopifyTool.cancelOrder(tenantId, shopifyCancelSchema.parse(payload)); break;
        case 'qbo_invoice': result = await QuickBooksTool.createInvoice(tenantId, invoiceSchema.parse(payload)); break;
        case 'qbo_expense': result = await QuickBooksTool.postExpense(tenantId, expenseSchema.parse(payload)); break;
        case 'crm_lead': result = await CrmTool.createLead(tenantId, leadSchema.parse(payload)); break;
        case 'crm_pipeline': result = await CrmTool.updatePipelineStatus(tenantId, pipelineSchema.parse(payload)); break;
      }
      if (approvalId) await prisma.approvalRequest.updateMany({
        where: { id: approvalId, tenantId, status: 'executing' },
        data: { status: result.status === 'pending' ? 'provider_pending' : 'executed' },
      });
      await recordAuditLog({ tenantId, actorType: 'agent', actorId: agentId, operation: 'execute_direct_action',
        entityType: 'action_execution', entityId: approvalId || agentId, newValue: { actionType, payload, result } });
      return { status: result.status === 'pending' ? 'PENDING' : 'SUCCESS', result };
    } catch (error) {
      // A timeout or local persistence failure may follow an accepted remote write.
      // Keep the approval consumed; reconciliation is required before a new attempt.
      if (approvalId) await prisma.approvalRequest.updateMany({
        where: { id: approvalId, tenantId, status: 'executing' }, data: { status: 'execution_uncertain' },
      });
      logger.error('Direct action execution failed', { tenantId, agentId, actionType });
      throw error;
    }
  }
}
