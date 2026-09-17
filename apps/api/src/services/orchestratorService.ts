import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';
import { recordAuditLog } from './auditService';

const nodeTypes = ['agent_task', 'tool_action', 'verification', 'approval', 'wait', 'human_handoff'] as const;
type NodeType = (typeof nodeTypes)[number];

type GraphNodeInput = { key: string; type: NodeType; agentId?: string; config?: Record<string, unknown> };
type GraphEdgeInput = { from: string; to: string; condition?: { key: string; equals: unknown } };

function objectValue(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function jsonValue(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function selectedContext(context: Record<string, unknown>, config: Record<string, unknown>) {
  const inputKeys = Array.isArray(config.inputKeys) ? config.inputKeys.filter((key): key is string => typeof key === 'string') : Object.keys(context);
  return Object.fromEntries(inputKeys.filter((key) => key in context).map((key) => [key, context[key]]));
}

function conditionMatches(condition: unknown, context: Record<string, unknown>) {
  if (!condition) return true;
  const value = objectValue(condition);
  return typeof value.key === 'string' && context[value.key] === value.equals;
}

function assertAcyclic(nodes: GraphNodeInput[], edges: GraphEdgeInput[]) {
  const adjacency = new Map(nodes.map((node) => [node.key, [] as string[]]));
  for (const edge of edges) adjacency.get(edge.from)!.push(edge.to);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(key: string): void {
    if (visiting.has(key)) throw new ValidationError('Workflow graph cannot contain cycles');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const next of adjacency.get(key) ?? []) visit(next);
    visiting.delete(key);
    visited.add(key);
  }
  for (const node of nodes) visit(node.key);
}

export const orchestratorService = {
  async createWorkflow(tenantId: string, input: { name: string; maxRetries?: number; nodes: GraphNodeInput[]; edges: GraphEdgeInput[] }, createdBy: string) {
    if (input.nodes.length === 0) throw new ValidationError('Workflow must contain at least one node');
    if (input.maxRetries != null && (!Number.isInteger(input.maxRetries) || input.maxRetries < 0 || input.maxRetries > 10)) throw new ValidationError('maxRetries must be between 0 and 10');
    const keys = new Set<string>();
    for (const node of input.nodes) {
      if (keys.has(node.key)) throw new ValidationError(`Duplicate workflow node key: ${node.key}`);
      keys.add(node.key);
      if (!nodeTypes.includes(node.type)) throw new ValidationError(`Unsupported workflow node type: ${node.type}`);
      if (['agent_task', 'tool_action', 'approval'].includes(node.type) && !node.agentId) throw new ValidationError(`Node ${node.key} requires an agentId`);
    }
    for (const edge of input.edges) {
      if (!keys.has(edge.from) || !keys.has(edge.to)) throw new ValidationError('Workflow edge references an unknown node');
      if (edge.from === edge.to) throw new ValidationError('Workflow node cannot transition to itself');
    }
    assertAcyclic(input.nodes, input.edges);
    const agentIds = input.nodes.flatMap((node) => node.agentId ? [node.agentId] : []);
    const agents = await prisma.agent.findMany({ where: { tenantId, id: { in: agentIds }, isActive: true }, select: { id: true } });
    if (agents.length !== new Set(agentIds).size) throw new NotFoundError('One or more workflow agents are not active in this tenant');

    const workflow = await prisma.$transaction(async (tx) => {
      const created = await tx.workflow.create({ data: { tenantId, name: input.name, status: 'draft', maxRetries: input.maxRetries ?? 3, graphDefinition: jsonValue({ nodes: input.nodes, edges: input.edges }), graphState: jsonValue({ createdBy }) } });
      const nodeMap = new Map<string, string>();
      for (const node of input.nodes) {
        const createdNode = await tx.workflowNode.create({ data: { workflowId: created.id, nodeKey: node.key, nodeType: node.type, agentId: node.agentId, config: jsonValue(node.config ?? {}) } });
        nodeMap.set(node.key, createdNode.id);
      }
      for (const edge of input.edges) {
        await tx.workflowEdge.create({ data: { workflowId: created.id, fromNodeId: nodeMap.get(edge.from)!, toNodeId: nodeMap.get(edge.to)!, condition: edge.condition ? jsonValue(edge.condition) : undefined } });
      }
      return created;
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_workflow', entityType: 'workflow', entityId: workflow.id, newValue: { name: workflow.name, nodeCount: input.nodes.length } });
    return workflow;
  },

  async listWorkflows(tenantId: string) {
    return prisma.workflow.findMany({ where: { tenantId }, include: { nodes: true, executions: { orderBy: { startedAt: 'desc' }, take: 5 } }, orderBy: { createdAt: 'desc' } });
  },

  async startExecution(tenantId: string, workflowId: string, context: Record<string, unknown>, idempotencyKey: string, startedBy: string) {
    const existing = await prisma.workflowExecution.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } }, include: { workflow: true, currentNode: true } });
    if (existing) return existing;
    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, tenantId }, include: { nodes: { include: { incoming: true }, orderBy: { createdAt: 'asc' } } } });
    if (!workflow) throw new NotFoundError('Workflow not found');
    const firstNode = workflow.nodes.find((node) => node.incoming.length === 0);
    if (!firstNode) throw new ValidationError('Workflow has no starting node');
    const execution = await prisma.workflowExecution.create({ data: { tenantId, workflowId, status: 'running', currentNodeId: firstNode.id, context: jsonValue(context), idempotencyKey } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: startedBy, operation: 'start_workflow_execution', entityType: 'workflow_execution', entityId: execution.id, newValue: { workflowId, idempotencyKey } });
    return prisma.workflowExecution.findUniqueOrThrow({ where: { id: execution.id }, include: { workflow: true, currentNode: true } });
  },

  async advance(tenantId: string, executionId: string, actorId: string) {
    const execution = await prisma.workflowExecution.findFirst({ where: { id: executionId, tenantId }, include: { workflow: true, currentNode: { include: { outgoing: { include: { toNode: true } } } } } });
    if (!execution) throw new NotFoundError('Workflow execution not found');
    if (execution.status === 'paused') throw new ConflictError('Workflow execution is paused and needs approval, event, or human resume');
    if (execution.status === 'completed') return execution;
    if (execution.status === 'failed') throw new ConflictError('Workflow execution has failed and must be retried');
    if (!execution.currentNode) throw new ValidationError('Workflow execution has no current node');

    const node = execution.currentNode;
    const previousAttempts = await prisma.workflowNodeExecution.count({ where: { executionId, nodeId: node.id } });
    const attempt = previousAttempts + 1;
    const config = objectValue(node.config);
    const context = objectValue(execution.context);
    const input = selectedContext(context, config);
    const nodeExecution = await prisma.workflowNodeExecution.create({ data: { executionId, nodeId: node.id, attempt, status: 'running', inputContext: jsonValue(input) } });

    if (typeof config.failUntilAttempt === 'number' && attempt <= config.failUntilAttempt) {
      await prisma.workflowNodeExecution.update({ where: { id: nodeExecution.id }, data: { status: 'failed', errorMessage: 'Deterministic node failure configured for retry test', completedAt: new Date() } });
      const failed = await prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'failed', retryCount: { increment: 1 } } });
      await recordAuditLog({ tenantId, actorType: 'user', actorId: actorId, operation: 'workflow_node_failed', entityType: 'workflow_execution', entityId: executionId, newValue: { nodeKey: node.nodeKey, attempt } });
      return failed;
    }

    if (node.nodeType === 'approval') {
      const approval = await prisma.approvalRequest.create({ data: { tenantId, requestedByAgentId: node.agentId!, workflowExecutionId: executionId, actionType: 'workflow_approval', actionPayload: { executionId, nodeId: node.id, nodeExecutionId: nodeExecution.id, context: input } as Prisma.InputJsonValue } });
      await prisma.workflowNodeExecution.update({ where: { id: nodeExecution.id }, data: { status: 'awaiting_approval' } });
      const paused = await prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'paused' } });
      await recordAuditLog({ tenantId, actorType: 'user', actorId: actorId, operation: 'workflow_approval_requested', entityType: 'workflow_execution', entityId: executionId, newValue: { approvalId: approval.id, nodeKey: node.nodeKey } });
      return paused;
    }

    if (node.nodeType === 'wait' || node.nodeType === 'human_handoff') {
      await prisma.workflowNodeExecution.update({ where: { id: nodeExecution.id }, data: { status: 'paused' } });
      return prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'paused' } });
    }

    const output = { nodeKey: node.nodeKey, nodeType: node.nodeType, agentId: node.agentId ?? null, acceptedContext: input };
    const nextContext = { ...context };
    if (typeof config.outputKey === 'string') nextContext[config.outputKey] = output;
    await prisma.workflowNodeExecution.update({ where: { id: nodeExecution.id }, data: { status: 'completed', outputContext: jsonValue(output), completedAt: new Date() } });
    const nextEdge = node.outgoing.find((edge) => conditionMatches(edge.condition, nextContext));
    if (!nextEdge) {
      const completed = await prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'completed', currentNodeId: null, context: jsonValue(nextContext), completedAt: new Date() } });
      await recordAuditLog({ tenantId, actorType: 'user', actorId: actorId, operation: 'complete_workflow_execution', entityType: 'workflow_execution', entityId: executionId, newValue: { nodeKey: node.nodeKey } });
      return completed;
    }
    return prisma.workflowExecution.update({ where: { id: executionId }, data: { currentNodeId: nextEdge.toNode.id, context: jsonValue(nextContext) } });
  },

  async retry(tenantId: string, executionId: string, actorId: string) {
    const execution = await prisma.workflowExecution.findFirst({ where: { id: executionId, tenantId }, include: { workflow: true } });
    if (!execution) throw new NotFoundError('Workflow execution not found');
    if (execution.status !== 'failed') throw new ConflictError('Only failed workflow executions can be retried');
    if (execution.retryCount > execution.workflow.maxRetries) throw new ConflictError('Workflow retry limit exceeded');
    const retried = await prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'running' } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: actorId, operation: 'retry_workflow_execution', entityType: 'workflow_execution', entityId: executionId, newValue: { retryCount: retried.retryCount } });
    return retried;
  },

  async recordEvent(tenantId: string, executionId: string, input: { eventKey: string; eventType: string; payload?: Record<string, unknown> }, actorId: string) {
    const execution = await prisma.workflowExecution.findFirst({ where: { id: executionId, tenantId }, include: { currentNode: true } });
    if (!execution) throw new NotFoundError('Workflow execution not found');
    const existing = await prisma.workflowEvent.findUnique({ where: { tenantId_eventKey: { tenantId, eventKey: input.eventKey } } });
    if (existing) return { event: existing, duplicate: true };
    const event = await prisma.workflowEvent.create({ data: { tenantId, executionId, eventKey: input.eventKey, eventType: input.eventType, payload: jsonValue(input.payload ?? {}) } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: actorId, operation: 'record_workflow_event', entityType: 'workflow_event', entityId: event.id, newValue: { eventKey: input.eventKey, eventType: input.eventType } });
    return { event, duplicate: false };
  },

  async reviewApproval(tenantId: string, approvalId: string, reviewerId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
    const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalId, tenantId, actionType: 'workflow_approval' } });
    if (!approval) throw new NotFoundError('Workflow approval request not found');
    if (approval.status !== 'pending') throw new ConflictError('Approval request has already been reviewed');
    const payload = objectValue(approval.actionPayload);
    const executionId = typeof payload.executionId === 'string' ? payload.executionId : null;
    const nodeExecutionId = typeof payload.nodeExecutionId === 'string' ? payload.nodeExecutionId : null;
    if (!executionId || !nodeExecutionId) throw new ValidationError('Workflow approval payload is invalid');
    const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: decision, reviewedByUserId: reviewerId, rejectionReason: decision === 'rejected' ? rejectionReason : null } });
    if (decision === 'approved') {
      await prisma.workflowNodeExecution.update({ where: { id: nodeExecutionId }, data: { status: 'completed', completedAt: new Date(), outputContext: jsonValue({ approved: true }) } });
      const execution = await prisma.workflowExecution.findUniqueOrThrow({ where: { id: executionId }, include: { currentNode: { include: { outgoing: { include: { toNode: true } } } } } });
      const nextEdge = execution.currentNode?.outgoing[0];
      await prisma.workflowExecution.update({ where: { id: executionId }, data: nextEdge ? { status: 'running', currentNodeId: nextEdge.toNode.id } : { status: 'completed', currentNodeId: null, completedAt: new Date() } });
    } else {
      await prisma.workflowNodeExecution.update({ where: { id: nodeExecutionId }, data: { status: 'failed', errorMessage: rejectionReason ?? 'Approval rejected', completedAt: new Date() } });
      await prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'failed', completedAt: new Date() } });
    }
    await recordAuditLog({ tenantId, actorType: 'user', actorId: reviewerId, operation: `workflow_approval_${decision}`, entityType: 'workflow_execution', entityId: executionId, newValue: { approvalId, decision } });
    return updated;
  },

  async trace(tenantId: string, executionId: string) {
    const execution = await prisma.workflowExecution.findFirst({ where: { id: executionId, tenantId }, include: { workflow: true, currentNode: true, nodeExecutions: { include: { node: true }, orderBy: { startedAt: 'asc' } }, events: { orderBy: { processedAt: 'asc' } }, approvalRequests: { orderBy: { createdAt: 'asc' } } } });
    if (!execution) throw new NotFoundError('Workflow execution not found');
    return execution;
  },
};
