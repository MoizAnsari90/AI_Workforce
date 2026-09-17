import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';
import { recordAuditLog } from './auditService';

const recordTypes = ['revenue', 'expense', 'adjustment'] as const;
type RecordType = (typeof recordTypes)[number];

type FinanceApprovalType = 'finance_expense' | 'finance_invoice' | 'finance_refund';

function money(value: number) {
  return new Prisma.Decimal(value.toFixed(2));
}

function categorizeExpense(description: string, category?: string) {
  if (category) return category;
  const value = description.toLowerCase();
  if (value.includes('payroll') || value.includes('salary')) return 'payroll';
  if (value.includes('shipping') || value.includes('delivery')) return 'shipping';
  if (value.includes('software') || value.includes('subscription')) return 'software';
  if (value.includes('tax')) return 'tax';
  if (value.includes('rent') || value.includes('lease')) return 'facilities';
  return 'uncategorized';
}

async function financeAgent(tenantId: string) {
  const agent = await prisma.agent.findFirst({ where: { tenantId, department: 'finance', isActive: true } });
  if (!agent) throw new NotFoundError('Active finance agent not found');
  return agent;
}

export const financeService = {
  async getPolicy(tenantId: string) {
    return prisma.financePolicy.upsert({ where: { tenantId }, update: {}, create: { tenantId } });
  },

  async updatePolicy(tenantId: string, input: { highValueExpenseThreshold?: number; refundApprovalThreshold?: number; defaultCurrency?: string }, updatedBy: string) {
    if ((input.highValueExpenseThreshold ?? 0) < 0 || (input.refundApprovalThreshold ?? 0) < 0) {
      throw new ValidationError('Finance thresholds cannot be negative');
    }
    const previous = await this.getPolicy(tenantId);
    const policy = await prisma.financePolicy.update({
      where: { tenantId },
      data: {
        ...(input.highValueExpenseThreshold !== undefined ? { highValueExpenseThreshold: money(input.highValueExpenseThreshold) } : {}),
        ...(input.refundApprovalThreshold !== undefined ? { refundApprovalThreshold: money(input.refundApprovalThreshold) } : {}),
        ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
      },
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: updatedBy, operation: 'update_finance_policy', entityType: 'finance_policy', entityId: policy.id, oldValue: previous, newValue: policy });
    return policy;
  },

  async createRecord(tenantId: string, input: { recordType: RecordType; amount: number; currency?: string; category?: string; description: string; occurredAt: Date; source?: string; externalRef?: string; status?: 'candidate' }, createdBy: string) {
    if (input.amount <= 0) throw new ValidationError('Financial record amount must be greater than zero');
    const policy = await this.getPolicy(tenantId);
    const requiresApproval = input.recordType === 'expense' && input.amount >= Number(policy.highValueExpenseThreshold);
    const agent = requiresApproval ? await financeAgent(tenantId) : null;
    const record = await prisma.financialRecord.create({
      data: {
        tenantId,
        recordType: input.recordType,
        amount: money(input.amount),
        currency: input.currency ?? policy.defaultCurrency,
        category: input.recordType === 'expense' ? categorizeExpense(input.description, input.category) : (input.category ?? input.recordType),
        description: input.description,
        status: requiresApproval ? 'awaiting_approval' : (input.status ?? 'confirmed'),
        occurredAt: input.occurredAt,
        source: input.source,
        externalRef: input.externalRef,
        createdBy,
      },
    });
    if (agent) {
      await prisma.approvalRequest.create({ data: { tenantId, requestedByAgentId: agent.id, actionType: 'finance_expense', actionPayload: { recordId: record.id, amount: input.amount } as Prisma.InputJsonValue } });
    }
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_financial_record', entityType: 'financial_record', entityId: record.id, newValue: { recordType: record.recordType, amount: record.amount, status: record.status, category: record.category } });
    return record;
  },

  async listRecords(tenantId: string, recordType?: string) {
    return prisma.financialRecord.findMany({ where: { tenantId, ...(recordType ? { recordType } : {}) }, orderBy: { occurredAt: 'desc' } });
  },

  async reconcileCandidate(tenantId: string, recordId: string, reconciledBy: string) {
    const record = await prisma.financialRecord.findFirst({ where: { id: recordId, tenantId } });
    if (!record) throw new NotFoundError('Financial record not found');
    if (record.status !== 'candidate') throw new ConflictError('Only candidate records can be reconciled');
    const updated = await prisma.financialRecord.update({ where: { id: recordId }, data: { status: 'reconciled' } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: reconciledBy, operation: 'reconcile_financial_record', entityType: 'financial_record', entityId: recordId, oldValue: { status: record.status }, newValue: { status: updated.status } });
    return updated;
  },

  async createInvoice(tenantId: string, input: { invoiceNumber: string; customerName: string; customerEmail?: string; currency?: string; dueAt?: Date; items: Array<{ description: string; quantity: number; unitPrice: number }> }, createdBy: string) {
    if (input.items.length === 0) throw new ValidationError('Invoice must contain at least one line item');
    if (input.items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0 || item.unitPrice < 0)) throw new ValidationError('Invoice line items are invalid');
    const subtotalNumber = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        invoiceNumber: input.invoiceNumber,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        subtotal: money(subtotalNumber),
        total: money(subtotalNumber),
        currency: input.currency ?? (await this.getPolicy(tenantId)).defaultCurrency,
        dueAt: input.dueAt,
        createdBy,
        items: { create: input.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPrice: money(item.unitPrice), lineTotal: money(item.quantity * item.unitPrice) })) },
      },
      include: { items: true },
    });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'create_invoice_draft', entityType: 'invoice', entityId: invoice.id, newValue: { total: invoice.total, status: invoice.status } });
    return invoice;
  },

  async listInvoices(tenantId: string) {
    return prisma.invoice.findMany({ where: { tenantId }, include: { items: true, payments: true }, orderBy: { createdAt: 'desc' } });
  },

  async requestInvoiceApproval(tenantId: string, invoiceId: string, requestedBy: string) {
    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundError('Invoice not found');
    if (invoice.status !== 'draft') throw new ConflictError('Only invoice drafts can be submitted for approval');
    const agent = await financeAgent(tenantId);
    const approval = await prisma.approvalRequest.create({ data: { tenantId, requestedByAgentId: agent.id, actionType: 'finance_invoice', actionPayload: { invoiceId: invoice.id, total: Number(invoice.total) } as Prisma.InputJsonValue } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'awaiting_approval' } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: requestedBy, operation: 'request_invoice_approval', entityType: 'invoice', entityId: invoiceId, newValue: { approvalId: approval.id } });
    return approval;
  },

  async recordPayment(tenantId: string, input: { invoiceId?: string; amount: number; currency?: string; status: string; paymentMethod?: string; externalRef?: string }, recordedBy: string) {
    if (input.amount <= 0) throw new ValidationError('Payment amount must be greater than zero');
    if (input.invoiceId) {
      const invoice = await prisma.invoice.findFirst({ where: { id: input.invoiceId, tenantId } });
      if (!invoice) throw new NotFoundError('Invoice not found');
    }
    const payment = await prisma.paymentRecord.create({ data: { tenantId, invoiceId: input.invoiceId, amount: money(input.amount), currency: input.currency ?? (await this.getPolicy(tenantId)).defaultCurrency, status: input.status, paymentMethod: input.paymentMethod, externalRef: input.externalRef, recordedBy } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: recordedBy, operation: 'record_payment_status', entityType: 'payment_record', entityId: payment.id, newValue: { amount: payment.amount, status: payment.status } });
    return payment;
  },

  async requestRefund(tenantId: string, input: { invoiceId?: string; paymentId?: string; amount: number; reason: string }, requestedBy: string) {
    if (input.amount <= 0) throw new ValidationError('Refund amount must be greater than zero');
    if (!input.invoiceId && !input.paymentId) throw new ValidationError('Refund must reference an invoice or payment');
    if (input.invoiceId) {
      const invoice = await prisma.invoice.findFirst({ where: { id: input.invoiceId, tenantId } });
      if (!invoice) throw new NotFoundError('Invoice not found');
    }
    if (input.paymentId) {
      const payment = await prisma.paymentRecord.findFirst({ where: { id: input.paymentId, tenantId } });
      if (!payment) throw new NotFoundError('Payment record not found');
    }
    const policy = await this.getPolicy(tenantId);
    const agent = await financeAgent(tenantId);
    const approval = await prisma.approvalRequest.create({ data: { tenantId, requestedByAgentId: agent.id, actionType: 'finance_refund', actionPayload: { invoiceId: input.invoiceId, paymentId: input.paymentId, amount: input.amount, reason: input.reason, threshold: Number(policy.refundApprovalThreshold) } as Prisma.InputJsonValue } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: requestedBy, operation: 'request_refund_approval', entityType: 'approval_request', entityId: approval.id, newValue: { amount: input.amount } });
    return approval;
  },

  async generateReport(tenantId: string, input: { periodStart: Date; periodEnd: Date; reportType?: string }, createdBy: string) {
    if (input.periodEnd < input.periodStart) throw new ValidationError('Report period is invalid');
    const records = await prisma.financialRecord.findMany({ where: { tenantId, status: { in: ['confirmed', 'reconciled'] }, occurredAt: { gte: input.periodStart, lte: input.periodEnd } } });
    const totalRevenue = records.filter((record) => record.recordType === 'revenue').reduce((sum, record) => sum.plus(record.amount), new Prisma.Decimal(0));
    const totalExpenses = records.filter((record) => record.recordType === 'expense').reduce((sum, record) => sum.plus(record.amount), new Prisma.Decimal(0));
    const netCashFlow = totalRevenue.minus(totalExpenses);
    const byCategory = records.reduce<Record<string, number>>((result, record) => { result[record.category] = (result[record.category] ?? 0) + Number(record.amount); return result; }, {});
    const report = await prisma.financeReport.create({ data: { tenantId, reportType: input.reportType ?? 'cash_flow', periodStart: input.periodStart, periodEnd: input.periodEnd, totalRevenue, totalExpenses, netCashFlow, summaryData: { recordCount: records.length, byCategory } as Prisma.InputJsonValue, createdBy } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: createdBy, operation: 'generate_finance_report', entityType: 'finance_report', entityId: report.id, newValue: report });
    return report;
  },

  async reviewApproval(tenantId: string, approvalId: string, reviewerId: string, decision: 'approved' | 'rejected', rejectionReason?: string) {
    const approval = await prisma.approvalRequest.findFirst({ where: { id: approvalId, tenantId, actionType: { in: ['finance_expense', 'finance_invoice', 'finance_refund'] } } });
    if (!approval) throw new NotFoundError('Finance approval request not found');
    if (approval.status !== 'pending') throw new ConflictError('Approval request has already been reviewed');
    const payload = approval.actionPayload as Record<string, unknown>;
    const recordId = typeof payload.recordId === 'string' ? payload.recordId : null;
    const invoiceId = typeof payload.invoiceId === 'string' ? payload.invoiceId : null;
    const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: decision, reviewedByUserId: reviewerId, rejectionReason: decision === 'rejected' ? rejectionReason : null } });
    if (recordId) await prisma.financialRecord.update({ where: { id: recordId }, data: { status: decision === 'approved' ? 'confirmed' : 'rejected' } });
    if (invoiceId && approval.actionType === 'finance_invoice') await prisma.invoice.update({ where: { id: invoiceId }, data: { status: decision === 'approved' ? 'approved' : 'rejected' } });
    await recordAuditLog({ tenantId, actorType: 'user', actorId: reviewerId, operation: `finance_approval_${decision}`, entityType: 'approval_request', entityId: approvalId, newValue: { actionType: approval.actionType, status: decision } });
    return updated;
  },
};
