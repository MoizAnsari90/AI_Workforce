import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { emitToTenant } from '../lib/socket';
import { recordAuditLog } from './auditService';
import { ShopifyTool } from '../tools/shopifyTool';
import { QuickBooksTool } from '../tools/quickBooksTool';
import { CrmTool } from '../tools/crmTool';

export interface ExecuteActionParams {
  tenantId: string;
  agentId: string;
  actionType: string; // e.g., 'shopify_refund', 'shopify_stock_check', 'qbo_invoice', 'crm_lead', 'social_publish'
  payload: Record<string, any>;
  approvalId?: string; // If resuming after approval
}

export class ActionExecutorService {
  /**
   * Evaluates action risk and determines if HITL approval is required.
   */
  static isActionRisky(actionType: string, payload: Record<string, any>): boolean {
    if (actionType === 'shopify_refund') return true;
    if (actionType === 'purchase_order' && (payload.amount ?? 0) > 1000) return true;
    if (actionType === 'qbo_invoice' && (payload.amount ?? 0) > 5000) return true;
    if (actionType === 'social_publish' || actionType === 'external_email_send') return true;
    return false;
  }

  static async executeAction(params: ExecuteActionParams) {
    const { tenantId, agentId, actionType, payload, approvalId } = params;

    // 1. Check if this is an execution following an approval
    if (approvalId) {
      const approval = await prisma.approvalRequest.findFirst({
        where: { id: approvalId, tenantId },
      });
      if (!approval) {
        throw new Error('Approval request not found');
      }
      if (approval.status !== 'approved') {
        throw new Error(`Cannot execute action because approval request is ${approval.status}`);
      }
    } else {
      // 2. Evaluate risk and whether approval is needed
      const risky = ActionExecutorService.isActionRisky(actionType, payload);
      if (risky) {
        // Create approval request
        const approval = await prisma.approvalRequest.create({
          data: {
            tenantId,
            requestedByAgentId: agentId,
            actionType,
            actionPayload: payload,
            status: 'pending',
          },
        });

        // Emit real-time notification to Dashboard via Socket.io
        emitToTenant(tenantId, 'approval:created', {
          approvalId: approval.id,
          agentId,
          actionType,
          payload,
          createdAt: approval.createdAt,
        });

        await recordAuditLog({
          tenantId,
          actorType: 'agent',
          actorId: agentId,
          operation: 'pause_action_for_approval',
          entityType: 'approval_request',
          entityId: approval.id,
          newValue: { actionType, payload, status: 'pending' },
        });

        logger.info('Action paused for HITL approval', { tenantId, agentId, actionType, approvalId: approval.id });

        return {
          status: 'PAUSED_FOR_APPROVAL',
          requestId: approval.id,
          message: 'Action requires human approval before executing external API call.',
        };
      }
    }

    // 3. Execute Direct Action Tool
    let result: any;
    try {
      if (actionType === 'shopify_refund') {
        result = await ShopifyTool.processRefund(tenantId, payload);
      } else if (actionType === 'shopify_stock_check') {
        result = await ShopifyTool.checkStock(tenantId, payload);
      } else if (actionType === 'shopify_cancel') {
        result = await ShopifyTool.cancelOrder(tenantId, payload);
      } else if (actionType === 'qbo_invoice') {
        result = await QuickBooksTool.createInvoice(tenantId, payload);
      } else if (actionType === 'qbo_expense') {
        result = await QuickBooksTool.postExpense(tenantId, payload);
      } else if (actionType === 'crm_lead') {
        result = await CrmTool.createLead(tenantId, payload);
      } else if (actionType === 'crm_pipeline') {
        result = await CrmTool.updatePipelineStatus(tenantId, payload);
      } else {
        // Default general direct action
        result = { success: true, actionType, payload, executedAt: new Date().toISOString() };
      }

      await recordAuditLog({
        tenantId,
        actorType: 'agent',
        actorId: agentId,
        operation: 'execute_direct_action',
        entityType: 'action_execution',
        entityId: agentId,
        newValue: { actionType, payload, result },
      });

      logger.info('Direct action executed successfully', { tenantId, agentId, actionType });

      return {
        status: 'SUCCESS',
        result,
      };
    } catch (error) {
      logger.error('Direct action execution failed', { tenantId, agentId, actionType, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}
