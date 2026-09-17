import Ajv, { ErrorObject } from 'ajv';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, ValidationError } from '../errors/AppError';
import { recordAuditLog } from './auditService';

const ajv = new Ajv({ allErrors: true, strict: false });

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function validationMessage(errors: ErrorObject[] | null | undefined) {
  return errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ') ?? 'Schema validation failed';
}

async function getPolicy(tenantId: string) {
  return prisma.harnessPolicy.upsert({ where: { tenantId }, update: {}, create: { tenantId } });
}

type ToolDefinition = {
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  verificationSchema?: Record<string, unknown>;
  requiredPermissions: string[];
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  timeoutMs: number;
  maxRetries: number;
};

function getToolUniqueWhere(tenantId: string, toolName: string) {
  return { tenantId_name: { tenantId, name: toolName } };
}

async function resolveTenantTool(tenantId: string, toolName: string): Promise<ToolDefinition | null> {
  const dbTool = await prisma.tool.findUnique({
    where: getToolUniqueWhere(tenantId, toolName),
    include: { permissions: { include: { permission: true } } },
  });

  if (!dbTool) return null;

  const resolvedTool: ToolDefinition = {
    name: toolName,
    description: dbTool.description,
    parameterSchema: dbTool.parameterSchema as Record<string, unknown>,
    verificationSchema: dbTool.verificationSchema as Record<string, unknown> | undefined,
    requiredPermissions: dbTool.permissions.map((item) => item.permission.name),
    riskLevel: dbTool.riskLevel as 'low' | 'medium' | 'high',
    requiresApproval: dbTool.requiresApproval,
    timeoutMs: dbTool.timeoutMs,
    maxRetries: dbTool.maxRetries,
  };

  return resolvedTool;
}

export const harnessService = {
  async updatePolicy(tenantId: string, input: { maxInvocationsPerWindow?: number; rateWindowSeconds?: number; maxAgentRunIterations?: number }, updatedBy: string) {
    if (Object.values(input).some((value) => value != null && (!Number.isInteger(value) || value < 1))) throw new ValidationError('Harness policy values must be positive integers');
    const previous = await getPolicy(tenantId);
    const policy = await prisma.harnessPolicy.update({ where: { tenantId }, data: input });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: updatedBy, operation: 'update_harness_policy', entityType: 'harness_policy', entityId: policy.id, oldValue: previous, newValue: policy });
    return policy;
  },

  async registerTool(tenantId: string, input: { name: string; description: string; parameterSchema: Record<string, unknown>; verificationSchema?: Record<string, unknown>; requiredPermissions: string[]; riskLevel?: 'low' | 'medium' | 'high'; requiresApproval?: boolean; timeoutMs?: number; maxRetries?: number }, registeredBy: string) {
    try { ajv.compile(input.parameterSchema); if (input.verificationSchema) ajv.compile(input.verificationSchema); } catch (error) { throw new ValidationError(`Invalid tool JSON Schema: ${error instanceof Error ? error.message : String(error)}`); }
    if (input.requiredPermissions.length === 0) throw new ValidationError('Every tool must declare at least one permission');
    const riskLevel = input.riskLevel ?? 'low';
    let tool;
    try {
      tool = await prisma.$transaction(async (tx) => {
        const created = await tx.tool.create({
          data: { tenantId, name: input.name, description: input.description, parameterSchema: json(input.parameterSchema), verificationSchema: input.verificationSchema ? json(input.verificationSchema) : undefined, riskLevel, isRisky: riskLevel !== 'low', requiresApproval: input.requiresApproval ?? riskLevel === 'high', timeoutMs: input.timeoutMs ?? 30000, maxRetries: input.maxRetries ?? 0 },
        });
      await tx.toolPermission.deleteMany({ where: { toolId: created.id } });
      for (const permissionName of input.requiredPermissions) {
        const permission = await tx.permission.upsert({ where: { name: permissionName }, update: {}, create: { name: permissionName, description: `Harness permission for ${input.name}` } });
        await tx.toolPermission.create({ data: { toolId: created.id, permissionId: permission.id } });
      }
      return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictError('Tool name already exists in this tenant');
      throw error;
    }

    await recordAuditLog({ tenantId, actorType: 'user', actorId: registeredBy, operation: 'register_tool', entityType: 'tool', entityId: tool.id, newValue: { name: tool.name, riskLevel: tool.riskLevel } });
    return prisma.tool.findUniqueOrThrow({ where: { id: tool.id }, include: { permissions: { include: { permission: true } } } });
  },

  async listTools(tenantId: string) {
    return prisma.tool.findMany({ where: { tenantId }, include: { permissions: { include: { permission: true } } }, orderBy: { name: 'asc' } });
  },

  async invokeTool(tenantId: string, input: { toolName: string; idempotencyKey: string; payload: Record<string, unknown>; actorId: string; actorType?: string; actorPermissions: string[]; agentId?: string }) {
    const scopedKey = `${tenantId}:${input.idempotencyKey}`;
    const existing = await prisma.toolInvocation.findUnique({ where: { idempotencyKey: scopedKey } });
    if (existing) return existing;

    const tool = await resolveTenantTool(tenantId, input.toolName);
    if (!tool) throw new NotFoundError('Tool not found');

    const required = tool.requiredPermissions;
    if (!required.every((permission) => input.actorPermissions.includes(permission))) throw new ForbiddenError('Actor lacks permissions required by this tool');
    if (input.agentId) {
      const agent = await prisma.agent.findFirst({ where: { id: input.agentId, tenantId, isActive: true } });
      if (!agent) throw new NotFoundError('Agent not found in tenant');
      if (agent.currentVersionId) {
        const currentVersion = await prisma.agentVersion.findFirst({ where: { id: agent.currentVersionId } });
        const allowlist = currentVersion?.toolAllowlist ?? [];
        if (allowlist.length > 0 && !allowlist.includes(input.toolName)) {
          throw new ForbiddenError(`Agent is not authorized to invoke tool ${input.toolName}`);
        }
      }
    }
    const validateInput = ajv.compile(tool.parameterSchema as Record<string, unknown>);
    if (!validateInput(input.payload)) throw new ValidationError(`Tool input rejected: ${validationMessage(validateInput.errors)}`);
    const policy = await getPolicy(tenantId);
    const since = new Date(Date.now() - policy.rateWindowSeconds * 1000);
    const invocationCount = await prisma.toolInvocation.count({ where: { tenantId, startedAt: { gte: since } } });
    if (invocationCount >= policy.maxInvocationsPerWindow) throw new TooManyRequestsError();
    let status = 'awaiting_verification';
    let approval: { id: string } | null = null;
    if (tool.requiresApproval) {
      if (!input.agentId) throw new ValidationError('High-risk tool invocation requires an agentId for approval');
      status = 'awaiting_approval';
    }
    const dbTool = await prisma.tool.findUnique({ where: getToolUniqueWhere(tenantId, input.toolName) });
    if (!dbTool) throw new NotFoundError('Tool not found');

    const invocation = await prisma.toolInvocation.create({ data: { idempotencyKey: scopedKey, tenantId, toolId: dbTool.id, actorType: input.actorType ?? 'user', actorId: input.actorId, status, inputPayload: json(input.payload) } });
    if (tool.requiresApproval) {
      approval = await prisma.approvalRequest.create({ data: { tenantId, requestedByAgentId: input.agentId!, toolInvocationId: invocation.id, actionType: 'harness_tool_invocation', actionPayload: { invocationId: invocation.id, toolName: tool.name } as Prisma.InputJsonValue } });
    }
    await recordAuditLog({ tenantId, actorType: input.actorType === 'agent' ? 'agent' : 'user', actorId: input.actorId, operation: 'invoke_tool', entityType: 'tool_invocation', entityId: invocation.id, newValue: { toolName: tool.name, status, approvalId: approval?.id } });
    return invocation;
  },

  async completeInvocation(tenantId: string, invocationId: string, output: Record<string, unknown>, completedBy: string) {
    const invocation = await prisma.toolInvocation.findFirst({ where: { id: invocationId, tenantId }, include: { tool: true } });
    if (!invocation) throw new NotFoundError('Tool invocation not found');
    if (invocation.status !== 'awaiting_verification') throw new ConflictError('Tool invocation is not ready for verification');
    if (!invocation.tool.verificationSchema) throw new ValidationError('Tool has no independent verification schema');
    const validateOutput = ajv.compile(invocation.tool.verificationSchema as Record<string, unknown>);
    if (!validateOutput(output)) {
      await prisma.toolInvocation.update({ where: { id: invocation.id }, data: { status: 'failed', verificationStatus: 'failed', outputPayload: json(output), errorMessage: validationMessage(validateOutput.errors), completedAt: new Date() } });
      await recordAuditLog({ tenantId, actorType: 'user', actorId: completedBy, operation: 'tool_verification_failed', entityType: 'tool_invocation', entityId: invocation.id, newValue: { verificationStatus: 'failed' } });
      throw new ValidationError(`Tool output rejected: ${validationMessage(validateOutput.errors)}`);
    }
    const completed = await prisma.toolInvocation.update({ where: { id: invocation.id }, data: { status: 'succeeded', verificationStatus: 'passed', outputPayload: json(output), completedAt: new Date() } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: completedBy, operation: 'tool_verification_passed', entityType: 'tool_invocation', entityId: invocation.id, newValue: { verificationStatus: 'passed' } });
    return completed;
  },

  async reviewInvocation(tenantId: string, approvalId: string, reviewerId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
    const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalId, tenantId, actionType: 'harness_tool_invocation' } });
    if (!approval || !approval.toolInvocationId) throw new NotFoundError('Harness approval request not found');
    if (approval.status !== 'pending') throw new ConflictError('Approval request has already been reviewed');
    const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: decision, reviewedByUserId: reviewerId, rejectionReason: decision === 'rejected' ? rejectionReason : null } });
    await prisma.toolInvocation.update({ where: { id: approval.toolInvocationId }, data: { status: decision === 'approved' ? 'awaiting_verification' : 'failed', verificationStatus: decision === 'approved' ? 'pending' : 'blocked', ...(decision === 'rejected' ? { errorMessage: rejectionReason ?? 'Approval rejected', completedAt: new Date() } : {}) } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: reviewerId, operation: `harness_approval_${decision}`, entityType: 'tool_invocation', entityId: approval.toolInvocationId, newValue: { approvalId, decision } });
    return updated;
  },

  async startRun(tenantId: string, input: { agentId?: string; workflowExecutionId?: string; context?: Record<string, unknown> }, startedBy: string) {
    if (input.agentId) {
      const agent = await prisma.agent.findFirst({ where: { id: input.agentId, tenantId, isActive: true } });
      if (!agent) throw new NotFoundError('Agent not found in tenant');
    }
    const run = await prisma.harnessRun.create({ data: { tenantId, agentId: input.agentId, workflowExecutionId: input.workflowExecutionId, context: json(input.context ?? {}) } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: startedBy, operation: 'start_harness_run', entityType: 'harness_run', entityId: run.id });
    return run;
  },

  async recordIteration(tenantId: string, runId: string, input: { action: string; result?: Record<string, unknown>; status?: string }) {
    const run = await prisma.harnessRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundError('Harness run not found');
    if (run.status !== 'running') throw new ConflictError('Harness run is not active');
    const policy = await getPolicy(tenantId);
    const nextIteration = run.iterationCount + 1;
    if (nextIteration > policy.maxAgentRunIterations) {
      await prisma.harnessRun.update({ where: { id: runId }, data: { status: 'blocked' } });
      throw new ConflictError('Harness iteration limit exceeded');
    }
    const iteration = await prisma.harnessIteration.create({ data: { runId, iteration: nextIteration, action: input.action, result: input.result ? json(input.result) : undefined, status: input.status ?? 'completed' } });
    await prisma.harnessRun.update({ where: { id: runId }, data: { iterationCount: nextIteration } });
    return iteration;
  },

  async createEvaluationDataset(tenantId: string, input: { name: string; description?: string; cases: Array<{ input: Record<string, unknown>; expected: Record<string, unknown> }> }, createdBy: string) {
    const dataset = await prisma.evaluationDataset.create({ data: { tenantId, name: input.name, description: input.description, cases: { create: input.cases.map((item) => ({ input: json(item.input), expected: json(item.expected) })) } }, include: { cases: true } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_evaluation_dataset', entityType: 'evaluation_dataset', entityId: dataset.id });
    return dataset;
  },

  async listRuns(tenantId: string) {
    return prisma.harnessRun.findMany({ where: { tenantId }, include: { iterations: true }, orderBy: { startedAt: 'desc' } });
  },
};
