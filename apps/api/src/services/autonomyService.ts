import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';
import { recordAuditLog } from './auditService';
import { operationsService } from './operationsService';
import { financeService } from './financeService';
import { orchestratorService } from './orchestratorService';
import { logger } from '../utils/logger';

const allowedJobTypes = ['health_digest', 'inventory_alerts', 'finance_summary', 'workflow', 'custom'] as const;
let schedulerTimer: NodeJS.Timeout | null = null;

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

async function policyFor(tenantId: string) {
  return prisma.autonomyPolicy.upsert({ where: { tenantId }, update: {}, create: { tenantId } });
}

async function notify(tenantId: string, type: string, severity: string, title: string, body: string, payload: Record<string, unknown>) {
  const policy = await policyFor(tenantId);
  if (!policy.notificationsEnabled) return null;
  return prisma.autonomyNotification.create({ data: { tenantId, notificationType: type, severity, title, body, payload: json(payload) } });
}

export const autonomyService = {
  async getPolicy(tenantId: string) {
    return policyFor(tenantId);
  },

  async updatePolicy(tenantId: string, input: { maxRunsPerWindow?: number; runWindowSeconds?: number; notificationsEnabled?: boolean }, updatedBy: string) {
    if (Object.entries(input).some(([key, value]) => key !== 'notificationsEnabled' && value != null && (typeof value !== 'number' || !Number.isInteger(value) || value < 1))) throw new ValidationError('Autonomy policy limits must be positive integers');
    const previous = await policyFor(tenantId);
    const policy = await prisma.autonomyPolicy.update({ where: { tenantId }, data: input });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: updatedBy, operation: 'update_autonomy_policy', entityType: 'autonomy_policy', entityId: policy.id, oldValue: previous, newValue: policy });
    return policy;
  },

  async createJob(tenantId: string, input: { name: string; jobType: (typeof allowedJobTypes)[number]; intervalSeconds?: number; nextRunAt?: Date; triggerType?: 'schedule' | 'event'; eventType?: string; workflowId?: string; maxRetries?: number }, createdBy: string) {
    if (input.triggerType === 'event' && !input.eventType) throw new ValidationError('Event jobs require eventType');
    if (input.triggerType !== 'event' && (!input.intervalSeconds || input.intervalSeconds < 1)) throw new ValidationError('Scheduled jobs require a positive intervalSeconds');
    if (input.maxRetries != null && (!Number.isInteger(input.maxRetries) || input.maxRetries < 0 || input.maxRetries > 10)) throw new ValidationError('maxRetries must be between 0 and 10');
    if (input.workflowId) {
      const workflow = await prisma.workflow.findFirst({ where: { id: input.workflowId, tenantId } });
      if (!workflow) throw new NotFoundError('Workflow not found');
    }
    const job = await prisma.autonomousJob.create({ data: { tenantId, name: input.name, jobType: input.jobType, triggerType: input.triggerType ?? 'schedule', eventType: input.eventType, workflowId: input.workflowId, intervalSeconds: input.intervalSeconds, nextRunAt: input.nextRunAt ?? new Date(), maxRetries: input.maxRetries ?? 3 } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_autonomous_job', entityType: 'autonomous_job', entityId: job.id, newValue: job });
    return job;
  },

  async listJobs(tenantId: string) {
    return prisma.autonomousJob.findMany({ where: { tenantId }, include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } }, orderBy: { createdAt: 'desc' } });
  },

  async executeJobRun(tenantId: string, job: { id: string; jobType: string; workflowId: string | null; maxRetries: number }, runId: string, payload: Record<string, unknown>) {
    try {
      let output: Record<string, unknown> = { jobType: job.jobType };
      if (job.jobType === 'health_digest') {
        const [pendingApprovals, failedWorkflows, failedRuns] = await Promise.all([
          prisma.approvalRequest.count({ where: { tenantId, status: 'pending' } }),
          prisma.workflowExecution.count({ where: { tenantId, status: 'failed' } }),
          prisma.autonomousJobRun.count({ where: { tenantId, status: 'failed' } }),
        ]);
        output = { pendingApprovals, failedWorkflows, failedRuns };
        if (pendingApprovals > 0 || failedWorkflows > 0 || failedRuns > 0) await notify(tenantId, 'health_digest', 'warning', 'Workforce exceptions need attention', `${pendingApprovals} approvals, ${failedWorkflows} failed workflows, and ${failedRuns} failed jobs require review.`, output);
      } else if (job.jobType === 'inventory_alerts') {
        const alerts = await operationsService.detectLowStock(tenantId, 'autonomy');
        output = { alertCount: alerts.length, alertIds: alerts.map((alert) => alert.id) };
        if (alerts.length > 0) await notify(tenantId, 'inventory_alerts', 'warning', 'Inventory alerts detected', `${alerts.length} inventory positions are at or below reorder point.`, output);
      } else if (job.jobType === 'finance_summary') {
        const periodEnd = new Date();
        const periodStart = new Date(periodEnd.getTime() - 86400000);
        const report = await financeService.generateReport(tenantId, { periodStart, periodEnd, reportType: 'daily_cash_flow' }, 'autonomy');
        output = { reportId: report.id, totalRevenue: String(report.totalRevenue), totalExpenses: String(report.totalExpenses), netCashFlow: String(report.netCashFlow) };
        await notify(tenantId, 'finance_summary', 'info', 'Daily finance summary ready', `Daily cash flow report generated with net flow ${output.netCashFlow}.`, output);
      } else if (job.jobType === 'workflow') {
        if (!job.workflowId) throw new ValidationError('Workflow job is missing workflowId');
        const execution = await orchestratorService.startExecution(tenantId, job.workflowId, payload, `autonomous:${runId}`, 'autonomy');
        output = { executionId: execution.id, status: execution.status };
      } else {
        if (payload.failOnce === true && payload._attempt === 1) throw new Error('Deterministic autonomous job failure');
        output = { accepted: true, payloadKeys: Object.keys(payload) };
      }
      const completed = await prisma.autonomousJobRun.update({ where: { id: runId }, data: { status: 'completed', outputPayload: json(output), completedAt: new Date() } });
      await recordAuditLog({ tenantId, actorType: 'system', actorId: 'autonomy', operation: 'complete_autonomous_job', entityType: 'autonomous_job_run', entityId: runId, newValue: output });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = await prisma.autonomousJobRun.update({ where: { id: runId }, data: { status: 'failed', errorMessage: message, completedAt: new Date() } });
      await notify(tenantId, 'job_failure', 'error', 'Autonomous job failed', message, { runId, jobId: job.id });
      await recordAuditLog({ tenantId, actorType: 'system', actorId: 'autonomy', operation: 'fail_autonomous_job', entityType: 'autonomous_job_run', entityId: runId, newValue: { error: message } });
      return failed;
    }
  },

  async runJob(tenantId: string, jobId: string, payload: Record<string, unknown> = {}) {
    const job = await prisma.autonomousJob.findFirst({ where: { id: jobId, tenantId } });
    if (!job) throw new NotFoundError('Autonomous job not found');
    const policy = await policyFor(tenantId);
    const since = new Date(Date.now() - policy.runWindowSeconds * 1000);
    const recentRuns = await prisma.autonomousJobRun.count({ where: { tenantId, startedAt: { gte: since } } });
    if (recentRuns >= policy.maxRunsPerWindow) throw new ConflictError('Autonomy run budget exceeded');
    const idempotencyKey = `${job.id}:${job.nextRunAt?.toISOString() ?? new Date().toISOString()}`;
    const existing = await prisma.autonomousJobRun.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
    const run = await prisma.autonomousJobRun.create({ data: { tenantId, jobId: job.id, idempotencyKey, inputPayload: json(payload) } });
    await prisma.autonomousJob.update({ where: { id: job.id }, data: { lastRunAt: new Date(), nextRunAt: job.intervalSeconds ? new Date(Date.now() + job.intervalSeconds * 1000) : null, enabled: job.triggerType === 'event' || job.intervalSeconds != null } });
    return this.executeJobRun(tenantId, job, run.id, { ...payload, _attempt: run.attempt });
  },

  async tick(tenantId?: string) {
    const jobs = await prisma.autonomousJob.findMany({ where: { enabled: true, triggerType: 'schedule', nextRunAt: { lte: new Date() }, ...(tenantId ? { tenantId } : {}) }, orderBy: { nextRunAt: 'asc' } });
    const results = [];
    for (const job of jobs) results.push(await this.runJob(job.tenantId, job.id));
    return results;
  },

  async publishEvent(tenantId: string, input: { eventKey: string; eventType: string; payload?: Record<string, unknown> }) {
    const existing = await prisma.autonomousEvent.findUnique({ where: { tenantId_eventKey: { tenantId, eventKey: input.eventKey } } });
    if (existing) return { event: existing, duplicate: true, runs: [] };
    const event = await prisma.autonomousEvent.create({ data: { tenantId, eventKey: input.eventKey, eventType: input.eventType, payload: json(input.payload ?? {}) } });
    const jobs = await prisma.autonomousJob.findMany({ where: { tenantId, enabled: true, triggerType: 'event', eventType: input.eventType } });
    const runs = [];
    for (const job of jobs) runs.push(await this.runJob(tenantId, job.id, input.payload));
    await recordAuditLog({ tenantId, actorType: 'system', actorId: 'autonomy', operation: 'publish_autonomous_event', entityType: 'autonomous_event', entityId: event.id, newValue: { eventType: input.eventType, runCount: runs.length } });
    return { event, duplicate: false, runs };
  },

  async retryRun(tenantId: string, runId: string) {
    const run = await prisma.autonomousJobRun.findFirst({ where: { id: runId, tenantId }, include: { job: true } });
    if (!run) throw new NotFoundError('Autonomous job run not found');
    if (run.status !== 'failed') throw new ConflictError('Only failed autonomous runs can be retried');
    if (run.attempt >= run.job.maxRetries) throw new ConflictError('Autonomous job retry limit exceeded');
    await prisma.autonomousJobRun.update({ where: { id: run.id }, data: { status: 'running', attempt: { increment: 1 }, completedAt: null } });
    return this.executeJobRun(tenantId, run.job, run.id, { ...objectValue(run.inputPayload), _attempt: run.attempt + 1 });
  },

  async heartbeat(tenantId: string, component: string, status: string, metadata: Record<string, unknown> = {}) {
    return prisma.autonomyHeartbeat.upsert({ where: { tenantId_component: { tenantId, component } }, update: { status, metadata: json(metadata), lastSeenAt: new Date() }, create: { tenantId, component, status, metadata: json(metadata) } });
  },

  async dashboard(tenantId: string) {
    const [jobs, activeRuns, failedRuns, approvals, notifications, heartbeats] = await Promise.all([
      prisma.autonomousJob.findMany({ where: { tenantId }, include: { runs: { orderBy: { startedAt: 'desc' }, take: 5 } }, orderBy: { name: 'asc' } }),
      prisma.autonomousJobRun.findMany({ where: { tenantId, status: 'running' }, orderBy: { startedAt: 'desc' } }),
      prisma.autonomousJobRun.findMany({ where: { tenantId, status: 'failed' }, orderBy: { startedAt: 'desc' }, take: 20 }),
      prisma.approvalRequest.findMany({ where: { tenantId, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.autonomyNotification.findMany({ where: { tenantId, status: 'unread' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.autonomyHeartbeat.findMany({ where: { tenantId }, orderBy: { component: 'asc' } }),
    ]);
    return { jobs, activeRuns, failedRuns, approvals, notifications, heartbeats };
  },

  async listNotifications(tenantId: string) {
    return prisma.autonomyNotification.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  },

  async markNotificationRead(tenantId: string, notificationId: string) {
    const notification = await prisma.autonomyNotification.findFirst({ where: { id: notificationId, tenantId } });
    if (!notification) throw new NotFoundError('Notification not found');
    return prisma.autonomyNotification.update({ where: { id: notificationId }, data: { status: 'read', readAt: new Date() } });
  },

  startScheduler(intervalMs = 60000) {
    if (schedulerTimer) return;
    schedulerTimer = setInterval(() => { this.tick().catch((error) => logger.error('Autonomy scheduler tick failed', { error: error instanceof Error ? error.message : String(error) })); }, intervalMs);
    schedulerTimer.unref();
  },

  stopScheduler() {
    if (schedulerTimer) clearInterval(schedulerTimer);
    schedulerTimer = null;
  },
};

function objectValue(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
