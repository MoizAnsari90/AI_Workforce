import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';
import { recordAuditLog } from './auditService';
import { leadService, QualificationCriterion } from './leadService';
import { whatsappService } from './whatsappService';

const defaultQualificationCriteria: QualificationCriterion[] = [
  { key: 'budgetConfirmed', label: 'Budget confirmed', weight: 25 },
  { key: 'decisionMaker', label: 'Decision maker identified', weight: 25 },
  { key: 'needIdentified', label: 'Need identified', weight: 25 },
  { key: 'timelineConfirmed', label: 'Timeline confirmed', weight: 25 },
];

function validateCriteria(criteria: QualificationCriterion[]) {
  const total = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (
    criteria.some(
      (criterion) =>
        criterion.key.trim() === '' || criterion.weight < 0 || criterion.weight > 100,
    ) || total !== 100
  ) {
    throw new ValidationError(
      'Qualification criteria must have non-empty keys and weights totaling 100',
    );
  }
}

export const salesService = {
  async getPolicy(tenantId: string) {
    return prisma.salesPolicy.upsert({
      where: { tenantId },
      update: {},
      create: {
        tenantId,
        qualificationCriteria: defaultQualificationCriteria as unknown as Prisma.InputJsonValue,
      },
    });
  },

  async updatePolicy(
    tenantId: string,
    input: {
      maxDiscountPct?: number;
      highValueDealThreshold?: number;
      requireApprovalAbove?: number;
      qualificationCriteria?: QualificationCriterion[];
    },
    performedBy: string,
  ) {
    if (input.maxDiscountPct != null && input.maxDiscountPct < 0) {
      throw new ValidationError('Discount cap cannot be negative');
    }
    if (input.qualificationCriteria) validateCriteria(input.qualificationCriteria);
    const previous = await this.getPolicy(tenantId);
    const policy = await prisma.salesPolicy.update({
      where: { tenantId },
      data: {
        ...(input.maxDiscountPct != null ? { maxDiscountPct: input.maxDiscountPct } : {}),
        ...(input.highValueDealThreshold != null
          ? { highValueDealThreshold: input.highValueDealThreshold }
          : {}),
        ...(input.requireApprovalAbove != null
          ? { requireApprovalAbove: input.requireApprovalAbove }
          : {}),
        ...(input.qualificationCriteria
          ? {
              qualificationCriteria:
                input.qualificationCriteria as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: performedBy,
      operation: 'update_sales_policy',
      entityType: 'sales_policy',
      entityId: policy.id,
      oldValue: previous,
      newValue: policy,
    });
    return policy;
  },

  async createFollowUp(
    tenantId: string,
    leadId: string,
    input: { title: string; description?: string; scheduledAt: Date; assignedAgentId?: string },
  ) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundError('Lead not found');
    if (input.scheduledAt.getTime() <= Date.now()) {
      throw new ValidationError('Follow-up must be scheduled in the future');
    }
    if (input.assignedAgentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: input.assignedAgentId, tenantId },
      });
      if (!agent) throw new NotFoundError('Sales agent not found');
    }
    const task = await prisma.task.create({
      data: {
        tenantId,
        leadId,
        agentId: input.assignedAgentId,
        title: input.title,
        description: input.description,
        status: 'scheduled',
        scheduledAt: input.scheduledAt,
      },
    });
    await leadService.logActivity({
      tenantId,
      leadId,
      activityType: 'follow_up_scheduled',
      summary: input.title,
      payload: { taskId: task.id, scheduledAt: input.scheduledAt.toISOString() },
      performedBy: 'sales-agent',
    });
    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: 'sales-agent',
      operation: 'create_follow_up',
      entityType: 'task',
      entityId: task.id,
      newValue: { title: input.title, scheduledAt: input.scheduledAt },
    });
    return task;
  },

  async listFollowUps(tenantId: string, leadId?: string) {
    return prisma.task.findMany({
      where: {
        tenantId,
        ...(leadId ? { leadId } : {}),
        status: { in: ['scheduled', 'pending'] },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  },

  async sendWhatsAppOutreach(tenantId: string, leadId: string, text: string, performedBy: string) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundError('Lead not found');
    if (!lead.phone) throw new ValidationError('Lead has no phone number for WhatsApp outreach');
    const result = await whatsappService.sendMessage(tenantId, lead.phone, text);
    await leadService.logActivity({
      tenantId,
      leadId,
      activityType: 'whatsapp',
      summary: 'WhatsApp sales outreach sent',
      payload: { messageId: result.messageId, text },
      performedBy,
    });
    await leadService.transition(tenantId, leadId, 'contacted', performedBy, 'WhatsApp outreach sent');
    return result;
  },

  async requestApproval(
    tenantId: string,
    leadId: string,
    input: {
      actionType: 'discount' | 'close_deal' | 'proposal';
      discountPct?: number;
      dealValue?: number;
      agentId: string;
      payload?: Record<string, unknown>;
    },
    requestedBy: string,
  ) {
    const [lead, policy, agent] = await Promise.all([
      prisma.lead.findFirst({ where: { id: leadId, tenantId } }),
      this.getPolicy(tenantId),
      prisma.agent.findFirst({
        where: { id: input.agentId, tenantId, department: 'sales' },
      }),
    ]);
    if (!lead) throw new NotFoundError('Lead not found');
    if (!agent) throw new NotFoundError('Sales agent not found');
    const needsApproval =
      input.actionType === 'discount'
        ? (input.discountPct ?? 0) >= Number(policy.maxDiscountPct)
        : input.actionType === 'close_deal'
          ? (input.dealValue ?? Number(lead.estimatedValue ?? 0)) >=
            Number(policy.requireApprovalAbove)
          : true;
    if (!needsApproval) {
      throw new ConflictError('This action is within the configured sales policy');
    }
    const approval = await prisma.approvalRequest.create({
      data: {
        tenantId,
        requestedByAgentId: agent.id,
        actionType: input.actionType,
        actionPayload: {
          leadId,
          discountPct: input.discountPct,
          dealValue: input.dealValue,
          ...input.payload,
        } as Prisma.InputJsonValue,
      },
    });
    await leadService.logActivity({
      tenantId,
      leadId,
      activityType: 'approval_requested',
      summary: `Approval requested for ${input.actionType}`,
      payload: { approvalId: approval.id },
      performedBy: requestedBy,
    });
    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: requestedBy,
      operation: 'request_sales_approval',
      entityType: 'approval_request',
      entityId: approval.id,
      newValue: { actionType: input.actionType, leadId },
    });
    return approval;
  },

  async reviewApproval(
    tenantId: string,
    approvalId: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    rejectionReason?: string,
  ) {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: approvalId, tenantId },
    });
    if (!approval) throw new NotFoundError('Approval request not found');
    if (approval.status !== 'pending') {
      throw new ConflictError('Approval request has already been reviewed');
    }
    const updated = await prisma.approvalRequest.update({
      where: { id: approvalId },
      data: {
        status: decision,
        reviewedByUserId: reviewerId,
        rejectionReason: decision === 'rejected' ? rejectionReason : null,
      },
    });
    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: reviewerId,
      operation: `sales_approval_${decision}`,
      entityType: 'approval_request',
      entityId: approvalId,
      oldValue: { status: approval.status },
      newValue: { status: decision },
    });
    return updated;
  },

  async addMemory(
    tenantId: string,
    leadId: string,
    memoryType: string,
    content: string,
    createdBy: string,
    metadata?: Record<string, unknown>,
  ) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundError('Lead not found');
    return prisma.salesMemory.create({
      data: {
        tenantId,
        leadId,
        memoryType,
        content,
        createdBy,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  },

  async listMemory(tenantId: string, leadId: string) {
    return prisma.salesMemory.findMany({ where: { tenantId, leadId }, orderBy: { createdAt: 'asc' } });
  },
};
