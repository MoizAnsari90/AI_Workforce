import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { recordAuditLog } from './auditService';
import { NotFoundError } from '../errors/AppError';

// ---------------------------------------------------------------------------
// Allowed lead lifecycle transitions
// ---------------------------------------------------------------------------
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  new: ['contacted', 'disqualified'],
  contacted: ['qualified', 'lost', 'disqualified'],
  qualified: ['proposal', 'lost', 'disqualified'],
  proposal: ['won', 'lost', 'disqualified'],
  won: [],
  lost: ['new'], // Allow re-opening
  disqualified: ['new'],
};

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'disqualified';

export interface CreateLeadParams {
  tenantId: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  source?: string;
  notes?: string;
  estimatedValue?: number;
  currency?: string;
  assignedUserId?: string;
  qualificationData?: Record<string, unknown>;
}

export interface UpdateLeadParams {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  notes?: string;
  estimatedValue?: number;
  currency?: string;
  assignedUserId?: string;
  qualificationData?: Record<string, unknown>;
}

export interface QualificationCriterion {
  key: string;
  label: string;
  weight: number; // 0–100, must sum to 100 across all criteria
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------
export function computeLeadScore(
  qualificationData: Record<string, unknown>,
  criteria: QualificationCriterion[],
): number {
  if (criteria.length === 0) return 0;

  let score = 0;
  for (const criterion of criteria) {
    const value = qualificationData[criterion.key];
    // Truthy non-empty values contribute the criterion weight
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      score += criterion.weight;
    }
  }

  return Math.min(Math.round(score), 100);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const leadService = {
  /**
   * Create a new lead. Score is computed if qualification data + policy criteria exist.
   */
  async create(params: CreateLeadParams) {
    const lead = await prisma.lead.create({
      data: {
        tenantId: params.tenantId,
        firstName: params.firstName,
        lastName: params.lastName ?? null,
        email: params.email ?? null,
        phone: params.phone ?? null,
        company: params.company ?? null,
        jobTitle: params.jobTitle ?? null,
        source: params.source ?? 'manual',
        notes: params.notes ?? null,
        estimatedValue: params.estimatedValue != null
          ? new Prisma.Decimal(params.estimatedValue)
          : null,
        currency: params.currency ?? 'USD',
        assignedUserId: params.assignedUserId ?? null,
        qualificationData: (params.qualificationData as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        status: 'new',
        score: 0,
      },
    });

    logger.info('Lead created', {
      tenantId: params.tenantId,
      leadId: lead.id,
      firstName: lead.firstName,
    });

    await recordAuditLog({
      tenantId: params.tenantId,
      actorType: 'user',
      actorId: params.assignedUserId ?? 'sales-agent',
      operation: 'create_lead',
      entityType: 'lead',
      entityId: lead.id,
      newValue: { status: lead.status, source: lead.source },
    });

    return lead;
  },

  /**
   * Update mutable lead fields. Re-scores if qualificationData changes.
   */
  async update(tenantId: string, leadId: string, params: UpdateLeadParams) {
    const existing = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
    });
    if (!existing) return null;

    // Re-compute score if qualification data was provided
    let newScore = existing.score;
    if (params.qualificationData !== undefined) {
      const policy = await prisma.salesPolicy.findUnique({ where: { tenantId } });
      if (policy) {
        const criteria = policy.qualificationCriteria as unknown as QualificationCriterion[];
        newScore = computeLeadScore(params.qualificationData, criteria);
      }
    }

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...(params.firstName !== undefined ? { firstName: params.firstName } : {}),
        ...(params.lastName !== undefined ? { lastName: params.lastName } : {}),
        ...(params.email !== undefined ? { email: params.email } : {}),
        ...(params.phone !== undefined ? { phone: params.phone } : {}),
        ...(params.company !== undefined ? { company: params.company } : {}),
        ...(params.jobTitle !== undefined ? { jobTitle: params.jobTitle } : {}),
        ...(params.notes !== undefined ? { notes: params.notes } : {}),
        ...(params.estimatedValue !== undefined
          ? { estimatedValue: new Prisma.Decimal(params.estimatedValue) }
          : {}),
        ...(params.currency !== undefined ? { currency: params.currency } : {}),
        ...(params.assignedUserId !== undefined
          ? { assignedUserId: params.assignedUserId }
          : {}),
        ...(params.qualificationData !== undefined
          ? { qualificationData: params.qualificationData as Prisma.InputJsonValue, score: newScore }
          : {}),
      },
    });

    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: 'sales-agent',
      operation: 'update_lead',
      entityType: 'lead',
      entityId: leadId,
      oldValue: existing,
      newValue: updated,
    });

    return updated;
  },

  /**
   * Transition a lead to a new status, enforcing the allowed lifecycle graph.
   * Returns null if the lead is not found; throws if the transition is not allowed.
   */
  async transition(
    tenantId: string,
    leadId: string,
    newStatus: LeadStatus,
    performedBy: string,
    note?: string,
  ) {
    const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) return null;

    const allowed = ALLOWED_TRANSITIONS[lead.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${lead.status} → ${newStatus}. Allowed: [${allowed.join(', ')}]`,
      );
    }

    const [updated] = await Promise.all([
      prisma.lead.update({
        where: { id: leadId },
        data: {
          status: newStatus,
          ...(newStatus === 'contacted' ? { lastContactedAt: new Date() } : {}),
        },
      }),
      prisma.salesActivity.create({
        data: {
          tenantId,
          leadId,
          activityType: 'status_change',
          summary: note ?? `Status changed from ${lead.status} to ${newStatus}`,
          payload: { from: lead.status, to: newStatus },
          performedBy,
        },
      }),
    ]);

    logger.info('Lead status transitioned', {
      tenantId,
      leadId,
      from: lead.status,
      to: newStatus,
      performedBy,
    });

    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: performedBy,
      operation: 'transition_lead',
      entityType: 'lead',
      entityId: leadId,
      oldValue: { status: lead.status },
      newValue: { status: newStatus },
    });

    return updated;
  },

  /**
   * Re-score a lead against the tenant's configured qualification criteria.
   */
  async rescore(tenantId: string, leadId: string, performedBy: string) {
    const [lead, policy] = await Promise.all([
      prisma.lead.findFirst({ where: { id: leadId, tenantId } }),
      prisma.salesPolicy.findUnique({ where: { tenantId } }),
    ]);

    if (!lead) return null;

    const criteria = (policy?.qualificationCriteria ?? []) as unknown as QualificationCriterion[];
    const qualData = (lead.qualificationData ?? {}) as Record<string, unknown>;
    const newScore = computeLeadScore(qualData, criteria);

    const [updated] = await Promise.all([
      prisma.lead.update({ where: { id: leadId }, data: { score: newScore } }),
      prisma.salesActivity.create({
        data: {
          tenantId,
          leadId,
          activityType: 'score_update',
          summary: `Score updated to ${newScore}`,
          payload: { oldScore: lead.score, newScore },
          performedBy,
        },
      }),
    ]);

    await recordAuditLog({
      tenantId,
      actorType: 'user',
      actorId: performedBy,
      operation: 'rescore_lead',
      entityType: 'lead',
      entityId: leadId,
      oldValue: { score: lead.score },
      newValue: { score: newScore },
    });

    return updated;
  },

  /**
   * Log a CRM activity against a lead.
   */
  async logActivity(params: {
    tenantId: string;
    leadId: string;
    activityType: string;
    summary: string;
    payload?: Record<string, unknown>;
    performedBy: string;
  }) {
    const lead = await prisma.lead.findFirst({
      where: { id: params.leadId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundError('Lead not found');

    const activity = await prisma.salesActivity.create({
      data: {
        tenantId: params.tenantId,
        leadId: params.leadId,
        activityType: params.activityType,
        summary: params.summary,
        payload: (params.payload as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        performedBy: params.performedBy,
      },
    });

    await recordAuditLog({
      tenantId: params.tenantId,
      actorType: 'user',
      actorId: params.performedBy,
      operation: 'log_lead_activity',
      entityType: 'sales_activity',
      entityId: activity.id,
      newValue: { activityType: params.activityType, summary: params.summary },
    });

    return activity;
  },

  /**
   * Fetch a single lead with its activities (tenant-isolated).
   */
  async findByIdForTenant(tenantId: string, leadId: string) {
    return prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        activities: { orderBy: { createdAt: 'asc' } },
      },
    });
  },

  /**
   * List leads for a tenant with optional status filter.
   */
  async listForTenant(tenantId: string, status?: string) {
    return prisma.lead.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });
  },

  /**
   * Pipeline view — count of leads per status for the tenant.
   */
  async pipelineSummary(tenantId: string) {
    const counts = await prisma.lead.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { id: true },
      _sum: { score: true },
    });

    return counts.map((c) => ({
      status: c.status,
      count: c._count.id,
      totalScore: c._sum.score ?? 0,
    }));
  },
};
