/**
 * @ai-employee/shared
 * Core TypeScript types, enums, interfaces, and contracts for AI Workforce.
 */

// ---------------------------------------------------------------------------
// 1. Roles & Permissions (RBAC)
// ---------------------------------------------------------------------------

export type RoleName = 'admin' | 'agent' | 'viewer';

export const StandardRoles: Record<string, RoleName> = {
  ADMIN: 'admin',
  AGENT: 'agent',
  VIEWER: 'viewer',
} as const;

export type StandardPermission =
  | 'admin:all'
  | 'tenant:manage'
  | 'users:manage'
  | 'roles:manage'
  | 'agents:manage'
  | 'agents:read'
  | 'tasks:execute'
  | 'tasks:read'
  | 'approvals:manage'
  | 'approvals:read'
  | 'audit:read'
  | 'support:read'
  | 'support:write'
  | 'sales:read'
  | 'sales:write'
  | 'marketing:read'
  | 'marketing:write'
  | 'operations:read'
  | 'operations:write'
  | 'finance:read'
  | 'finance:write';

export const RoleDefaultPermissions: Record<RoleName, StandardPermission[]> = {
  admin: [
    'admin:all',
    'tenant:manage',
    'users:manage',
    'roles:manage',
    'agents:manage',
    'agents:read',
    'tasks:execute',
    'tasks:read',
    'approvals:manage',
    'approvals:read',
    'audit:read',
    'support:read',
    'support:write',
    'sales:read',
    'sales:write',
    'marketing:read',
    'marketing:write',
    'operations:read',
    'operations:write',
    'finance:read',
    'finance:write',
  ],
  agent: [
    'agents:read',
    'tasks:execute',
    'tasks:read',
    'approvals:read',
    'support:read',
    'support:write',
    'sales:read',
    'marketing:read',
    'operations:read',
    'finance:read',
  ],
  viewer: [
    'agents:read',
    'tasks:read',
    'approvals:read',
    'support:read',
    'sales:read',
  ],
};

// ---------------------------------------------------------------------------
// 2. Authentication & Tenant Context
// ---------------------------------------------------------------------------

export interface JWTPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: RoleName;
  iat?: number;
  exp?: number;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
  email: string;
  role: RoleName;
  permissions: string[];
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  role: RoleName;
  permissions: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 3. API Response Envelope
// ---------------------------------------------------------------------------

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// 4. Domain Model Interfaces
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionStatus: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface Role {
  id: string;
  tenantId?: string | null;
  name: string;
  description?: string | null;
}

export interface Permission {
  id: string;
  name: string;
  description?: string | null;
}

export interface Business {
  id: string;
  tenantId: string;
  name: string;
  industry?: string | null;
  brandVoiceGuide?: string | null;
  supportPhoneNumberId?: string | null;
  supportAccessToken?: string | null;
  createdAt: Date | string;
}

export type Department = 'support' | 'sales' | 'marketing' | 'operations' | 'finance';

export interface Agent {
  id: string;
  tenantId: string;
  department: Department;
  name: string;
  isActive: boolean;
  currentVersionId?: string | null;
  createdAt: Date | string;
}

export interface AgentVersion {
  id: string;
  agentId: string;
  systemPrompt: string;
  temperature: number;
  toolAllowlist: string[];
  createdAt: Date | string;
}

export type TaskStatus = 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed';

export interface Task {
  id: string;
  tenantId: string;
  agentId?: string | null;
  title: string;
  description?: string | null;
  status: TaskStatus;
  inputData?: Record<string, unknown> | null;
  outputData?: Record<string, unknown> | null;
  errorMessage?: string | null;
  scheduledAt?: Date | string | null;
  completedAt?: Date | string | null;
  createdAt: Date | string;
}

export type WorkflowStatus = 'running' | 'completed' | 'failed' | 'paused';

export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  status: WorkflowStatus;
  graphState: Record<string, unknown>;
  createdAt: Date | string;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  isRisky: boolean;
  createdAt: Date | string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  requestedByAgentId: string;
  associatedTaskId?: string | null;
  actionType: string;
  actionPayload: Record<string, unknown>;
  status: ApprovalStatus;
  reviewedByUserId?: string | null;
  rejectionReason?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type AuditActorType = 'user' | 'agent' | 'system';

export interface AuditLog {
  id: string;
  tenantId: string;
  actorType: AuditActorType;
  actorId: string;
  operation: string;
  entityType: string;
  entityId: string;
  oldValue?: string | null;
  newValue?: string | null;
  createdAt: Date | string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  customerPhone: string;
  customerName?: string | null;
  channel: string;
  aiActive: boolean;
  assignedAgentId?: string | null;
  lastMessageAt: Date | string;
  createdAt: Date | string;
}

export type MessageDirection = 'incoming' | 'outgoing';
export type MessageSenderType = 'customer' | 'ai' | 'human';

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  textContent: string;
  metaMessageId?: string | null;
  createdAt: Date | string;
}

export interface KnowledgeSource {
  id: string;
  tenantId: string;
  sourceName: string;
  sourceType: 'pdf' | 'txt' | 'url';
  status: 'pending' | 'processed' | 'failed';
  createdAt: Date | string;
}

export interface DocumentChunk {
  id: string;
  tenantId: string;
  sourceId?: string | null;
  content: string;
  embedding?: string | null;
  createdAt: Date | string;
}

export interface FAQ {
  id: string;
  tenantId: string;
  question: string;
  answer: string;
  isActive: boolean;
  createdAt: Date | string;
}

export interface SystemEvent {
  id: string;
  tenantId: string;
  eventName: string;
  source: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processed' | 'failed';
  emittedAt: Date | string;
}
