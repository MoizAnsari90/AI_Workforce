import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';
import { recordAuditLog } from './auditService';

interface MarketingRules {
  brandVoice?: string | null;
  approvedClaims: string[];
  prohibitedClaims: string[];
  targetAudience?: string | null;
  businessPolicies: Record<string, unknown>;
}

interface ContentValidation {
  passed: boolean;
  violations: string[];
  unapprovedClaims: string[];
  brandVoiceApplied: boolean;
}

function toStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function validateContent(content: string, claims: string[], rules: MarketingRules): ContentValidation {
  const normalizedContent = content.toLowerCase();
  const violations = rules.prohibitedClaims
    .filter((claim) => normalizedContent.includes(claim.toLowerCase()))
    .map((claim) => `Prohibited claim: ${claim}`);
  const approved = new Set(rules.approvedClaims.map((claim) => claim.toLowerCase()));
  const unapprovedClaims = claims.filter((claim) => !approved.has(claim.toLowerCase()));

  return {
    passed: violations.length === 0 && unapprovedClaims.length === 0,
    violations,
    unapprovedClaims,
    brandVoiceApplied: Boolean(rules.brandVoice),
  };
}

async function getMarketingRules(tenantId: string): Promise<MarketingRules> {
  const profile = await prisma.marketingProfile.findUnique({ where: { tenantId } });
  if (!profile) {
    return { brandVoice: null, approvedClaims: [], prohibitedClaims: [], targetAudience: null, businessPolicies: {} };
  }
  return {
    brandVoice: profile.brandVoice,
    approvedClaims: toStringArray(profile.approvedClaims),
    prohibitedClaims: toStringArray(profile.prohibitedClaims),
    targetAudience: profile.targetAudience,
    businessPolicies: toObject(profile.businessPolicies),
  };
}

export const marketingService = {
  async getProfile(tenantId: string) {
    return prisma.marketingProfile.upsert({
      where: { tenantId },
      update: {},
      create: {
        tenantId,
        approvedClaims: [],
        prohibitedClaims: [],
        businessPolicies: {},
      },
    });
  },

  async updateProfile(tenantId: string, input: {
    brandVoice?: string;
    approvedClaims?: string[];
    prohibitedClaims?: string[];
    targetAudience?: string;
    businessPolicies?: Record<string, unknown>;
  }, performedBy: string) {
    const previous = await this.getProfile(tenantId);
    const profile = await prisma.marketingProfile.update({
      where: { tenantId },
      data: {
        ...(input.brandVoice !== undefined ? { brandVoice: input.brandVoice } : {}),
        ...(input.approvedClaims !== undefined ? { approvedClaims: input.approvedClaims as Prisma.InputJsonValue } : {}),
        ...(input.prohibitedClaims !== undefined ? { prohibitedClaims: input.prohibitedClaims as Prisma.InputJsonValue } : {}),
        ...(input.targetAudience !== undefined ? { targetAudience: input.targetAudience } : {}),
        ...(input.businessPolicies !== undefined ? { businessPolicies: input.businessPolicies as Prisma.InputJsonValue } : {}),
      },
    });
    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: performedBy,
      operation: 'update_marketing_profile',
      entityType: 'marketing_profile',
      entityId: profile.id,
      oldValue: previous,
      newValue: profile,
    });
    return profile;
  },

  async createCampaign(tenantId: string, input: {
    name: string;
    objective: string;
    startAt?: Date;
    endAt?: Date;
  }, createdBy: string) {
    const profile = await this.getProfile(tenantId);
    const campaign = await prisma.campaign.create({
      data: {
        tenantId,
        marketingProfileId: profile.id,
        name: input.name,
        objective: input.objective,
        startAt: input.startAt,
        endAt: input.endAt,
        createdBy,
      },
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_campaign', entityType: 'campaign', entityId: campaign.id, newValue: campaign });
    return campaign;
  },

  async listCampaigns(tenantId: string) {
    return prisma.campaign.findMany({ where: { tenantId }, include: { drafts: true, metrics: true }, orderBy: { createdAt: 'desc' } });
  },

  async createDraft(tenantId: string, input: {
    campaignId?: string;
    title: string;
    content: string;
    contentType: string;
    channel: string;
    scheduledAt?: Date;
    claims: string[];
  }, createdBy: string) {
    if (input.campaignId) {
      const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, tenantId } });
      if (!campaign) throw new NotFoundError('Campaign not found');
    }
    const rules = await getMarketingRules(tenantId);
    const validation = validateContent(input.content, input.claims, rules);
    const draft = await prisma.contentDraft.create({
      data: {
        tenantId,
        campaignId: input.campaignId,
        title: input.title,
        content: input.content,
        contentType: input.contentType,
        channel: input.channel,
        scheduledAt: input.scheduledAt,
        status: validation.passed ? 'draft' : 'blocked',
        validationData: { ...validation, claims: input.claims } as Prisma.InputJsonValue,
        createdBy,
      },
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_content_draft', entityType: 'content_draft', entityId: draft.id, newValue: { status: draft.status, validation } });
    return draft;
  },

  async listDrafts(tenantId: string, status?: string) {
    return prisma.contentDraft.findMany({ where: { tenantId, ...(status ? { status } : {}) }, orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }] });
  },

  async requestPublish(tenantId: string, draftId: string, agentId: string, requestedBy: string) {
    const draft = await prisma.contentDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!draft) throw new NotFoundError('Content draft not found');
    const validation = toObject(draft.validationData);
    if (draft.status === 'blocked' || validation.passed !== true) {
      throw new ValidationError('Content draft has not passed configured brand-safety checks');
    }
    const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId, department: 'marketing', isActive: true } });
    if (!agent) throw new NotFoundError('Active marketing agent not found');
    const approval = await prisma.approvalRequest.create({
      data: {
        tenantId,
        requestedByAgentId: agent.id,
        actionType: 'marketing_publish',
        actionPayload: { contentDraftId: draft.id, channel: draft.channel } as Prisma.InputJsonValue,
      },
    });
    await prisma.contentDraft.update({ where: { id: draft.id }, data: { status: 'awaiting_approval' } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: requestedBy, operation: 'request_marketing_publish', entityType: 'content_draft', entityId: draft.id, newValue: { approvalId: approval.id } });
    return approval;
  },

  async reviewPublish(tenantId: string, approvalId: string, reviewerId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
    const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalId, tenantId, actionType: 'marketing_publish' } });
    if (!approval) throw new NotFoundError('Marketing approval request not found');
    if (approval.status !== 'pending') throw new ConflictError('Approval request has already been reviewed');
    const payload = toObject(approval.actionPayload);
    const draftId = typeof payload.contentDraftId === 'string' ? payload.contentDraftId : null;
    if (!draftId) throw new ValidationError('Marketing approval payload is invalid');
    const draft = await prisma.contentDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!draft) throw new NotFoundError('Content draft not found');
    const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: decision, reviewedByUserId: reviewerId, rejectionReason: decision === 'rejected' ? rejectionReason : null } });
    await prisma.contentDraft.update({ where: { id: draftId }, data: { status: decision === 'approved' ? 'approved' : 'rejected', ...(decision === 'approved' ? { approvedAt: new Date() } : {}) } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: reviewerId, operation: `marketing_publish_${decision}`, entityType: 'content_draft', entityId: draftId, oldValue: { status: draft.status }, newValue: { status: decision } });
    return updated;
  },

  async publish(tenantId: string, draftId: string, publishedBy: string) {
    const draft = await prisma.contentDraft.findFirst({ where: { id: draftId, tenantId } });
    if (!draft) throw new NotFoundError('Content draft not found');
    if (draft.status !== 'approved') throw new ConflictError('Content must be approved before publishing');
    const published = await prisma.contentDraft.update({ where: { id: draftId }, data: { status: 'published', publishedAt: new Date() } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: publishedBy, operation: 'publish_marketing_content', entityType: 'content_draft', entityId: draftId, oldValue: { status: draft.status }, newValue: { status: published.status, channel: published.channel } });
    return published;
  },

  async recordMetric(tenantId: string, input: { campaignId: string; contentDraftId?: string; metricName: string; metricValue: number }, recordedBy: string) {
    const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, tenantId } });
    if (!campaign) throw new NotFoundError('Campaign not found');
    if (input.contentDraftId) {
      const draft = await prisma.contentDraft.findFirst({ where: { id: input.contentDraftId, tenantId, campaignId: input.campaignId } });
      if (!draft) throw new NotFoundError('Content draft not found for campaign');
    }
    const metric = await prisma.campaignMetric.create({ data: { tenantId, campaignId: input.campaignId, contentDraftId: input.contentDraftId, metricName: input.metricName, metricValue: input.metricValue } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: recordedBy, operation: 'record_campaign_metric', entityType: 'campaign_metric', entityId: metric.id, newValue: metric });
    return metric;
  },

  async createTask(tenantId: string, input: { campaignId?: string; title: string; description?: string; scheduledAt?: Date }, createdBy: string) {
    if (input.campaignId) {
      const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, tenantId } });
      if (!campaign) throw new NotFoundError('Campaign not found');
    }
    const task = await prisma.task.create({ data: { tenantId, campaignId: input.campaignId, title: input.title, description: input.description, scheduledAt: input.scheduledAt, status: 'pending' } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_marketing_task', entityType: 'task', entityId: task.id, newValue: task });
    return task;
  },

  async attributeLead(tenantId: string, leadId: string, campaignId: string, attributionSource: string, updatedBy: string) {
    const [lead, campaign] = await Promise.all([
      prisma.lead.findFirst({ where: { id: leadId, tenantId } }),
      prisma.campaign.findFirst({ where: { id: campaignId, tenantId } }),
    ]);
    if (!lead) throw new NotFoundError('Lead not found');
    if (!campaign) throw new NotFoundError('Campaign not found');
    const updated = await prisma.lead.update({ where: { id: leadId }, data: { campaignId, attributionSource } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: updatedBy, operation: 'attribute_lead_to_campaign', entityType: 'lead', entityId: leadId, oldValue: { campaignId: lead.campaignId }, newValue: { campaignId, attributionSource } });
    return updated;
  },
};
