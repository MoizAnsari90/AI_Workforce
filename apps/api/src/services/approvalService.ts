import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';

export interface CreateApprovalParams {
  tenantId: string;
  requestedByAgentId: string;
  actionType: string;
  actionPayload: unknown;
  associatedTaskId?: string;
  workflowExecutionId?: string;
  toolInvocationId?: string;
}

export interface ReviewApprovalParams {
  approvalId: string;
  tenantId: string;
  userId: string;
  status: 'approved' | 'rejected';
  rejectionReason?: string;
}

export class ApprovalService {
  static async createApprovalRequest(params: CreateApprovalParams) {
    const approval = await prisma.approvalRequest.create({
      data: {
        tenantId: params.tenantId,
        requestedByAgentId: params.requestedByAgentId,
        actionType: params.actionType,
        actionPayload: params.actionPayload as any,
        associatedTaskId: params.associatedTaskId,
        workflowExecutionId: params.workflowExecutionId,
        toolInvocationId: params.toolInvocationId,
        status: 'pending',
      },
    });

    await recordAuditLog({
      tenantId: params.tenantId,
      actorType: 'agent',
      actorId: params.requestedByAgentId,
      operation: 'create_approval_request',
      entityType: 'approval_request',
      entityId: approval.id,
      newValue: { actionType: params.actionType, status: 'pending' },
    });

    logger.info('Approval request created', { approvalId: approval.id, tenantId: params.tenantId, actionType: params.actionType });
    return approval;
  }

  static async getPendingRequests(tenantId: string) {
    return prisma.approvalRequest.findMany({
      where: {
        tenantId,
        status: 'pending',
      },
      include: {
        agent: true,
        toolInvocation: true,
        workflowExecution: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async reviewApprovalRequest(params: ReviewApprovalParams) {
    const existing = await prisma.approvalRequest.findFirst({
      where: {
        id: params.approvalId,
        tenantId: params.tenantId,
      },
    });

    if (!existing) {
      throw new Error('Approval request not found or unauthorized');
    }

    if (existing.status !== 'pending') {
      throw new Error(`Approval request is already ${existing.status}`);
    }

    const claimed = await prisma.approvalRequest.updateMany({
      where: { id: params.approvalId, tenantId: params.tenantId, status: 'pending', updatedAt: existing.updatedAt },
      data: {
        status: params.status,
        reviewedByUserId: params.userId,
        rejectionReason: params.status === 'rejected' ? params.rejectionReason : null,
      },
    });

    if (claimed.count !== 1) throw new Error('Approval request has already been reviewed');
    const updated = await prisma.approvalRequest.findFirst({ where: { id: params.approvalId, tenantId: params.tenantId } });
    if (!updated) throw new Error('Approval request no longer exists');

    await recordAuditLog({
      tenantId: params.tenantId,
      actorType: 'user',
      actorId: params.userId,
      operation: `review_approval_${params.status}`,
      entityType: 'approval_request',
      entityId: updated.id,
      oldValue: { status: existing.status },
      newValue: { status: updated.status, rejectionReason: updated.rejectionReason },
    });

    logger.info(`Approval request ${params.status}`, { approvalId: updated.id, tenantId: params.tenantId, userId: params.userId });
    return updated;
  }
}
