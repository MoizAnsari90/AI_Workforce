import { Router, Response } from 'express';
import { z } from 'zod';
import { ApiResponse, StandardRoles } from '@ai-employee/shared';
import { authenticate } from '../middleware/authMiddleware';
import { enforceTenantIsolation } from '../middleware/tenantIsolationMiddleware';
import { requirePermission, requireRole } from '../middleware/rbacMiddleware';
import { prisma } from '../lib/prisma';
import { financeService } from '../services/financeService';

export const financeRouter = Router();
financeRouter.use('/tenants/:tenantId', authenticate, enforceTenantIsolation);

function send<T>(res: Response, data: T, status = 200) {
  const response: ApiResponse<T> = { success: true, data, meta: { timestamp: new Date().toISOString() } };
  res.status(status).json(response);
}

financeRouter.get('/tenants/:tenantId/finance/policy', requirePermission('finance:read'), async (req, res, next) => {
  try { send(res, await financeService.getPolicy(req.params.tenantId)); } catch (error) { next(error); }
});

financeRouter.put('/tenants/:tenantId/finance/policy', requirePermission('finance:write'), async (req, res, next) => {
  try {
    const input = z.object({ highValueExpenseThreshold: z.number().nonnegative().optional(), refundApprovalThreshold: z.number().nonnegative().optional(), defaultCurrency: z.string().length(3).optional() }).parse(req.body);
    send(res, await financeService.updatePolicy(req.params.tenantId, input, req.user!.userId));
  } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/records', requirePermission('finance:write'), async (req, res, next) => {
  try {
    const input = z.object({ recordType: z.enum(['revenue', 'expense', 'adjustment']), amount: z.number().positive(), currency: z.string().length(3).optional(), category: z.string().optional(), description: z.string().min(1), occurredAt: z.coerce.date(), source: z.string().optional(), externalRef: z.string().optional(), status: z.literal('candidate').optional() }).parse(req.body);
    send(res, await financeService.createRecord(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

financeRouter.get('/tenants/:tenantId/finance/records', requirePermission('finance:read'), async (req, res, next) => {
  try { send(res, await financeService.listRecords(req.params.tenantId, typeof req.query.recordType === 'string' ? req.query.recordType : undefined)); } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/records/:recordId/reconcile', requirePermission('finance:write'), async (req, res, next) => {
  try { send(res, await financeService.reconcileCandidate(req.params.tenantId, req.params.recordId, req.user!.userId)); } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/invoices', requirePermission('finance:write'), async (req, res, next) => {
  try {
    const input = z.object({ invoiceNumber: z.string().min(1), customerName: z.string().min(1), customerEmail: z.string().email().optional(), currency: z.string().length(3).optional(), dueAt: z.coerce.date().optional(), items: z.array(z.object({ description: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().nonnegative() })).min(1) }).parse(req.body);
    send(res, await financeService.createInvoice(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

financeRouter.get('/tenants/:tenantId/finance/invoices', requirePermission('finance:read'), async (req, res, next) => {
  try { send(res, await financeService.listInvoices(req.params.tenantId)); } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/invoices/:invoiceId/approval-request', requirePermission('finance:write'), async (req, res, next) => {
  try { send(res, await financeService.requestInvoiceApproval(req.params.tenantId, req.params.invoiceId, req.user!.userId), 201); } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/payments', requirePermission('finance:write'), async (req, res, next) => {
  try {
    const input = z.object({ invoiceId: z.string().optional(), amount: z.number().positive(), currency: z.string().length(3).optional(), status: z.enum(['recorded', 'pending', 'settled', 'failed']), paymentMethod: z.string().optional(), externalRef: z.string().optional() }).parse(req.body);
    send(res, await financeService.recordPayment(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/refund-requests', requirePermission('finance:write'), async (req, res, next) => {
  try {
    const input = z.object({ invoiceId: z.string().optional(), paymentId: z.string().optional(), amount: z.number().positive(), reason: z.string().min(1) }).parse(req.body);
    send(res, await financeService.requestRefund(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/reports', requirePermission('finance:read'), async (req, res, next) => {
  try {
    const input = z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date(), reportType: z.string().optional() }).parse(req.body);
    send(res, await financeService.generateReport(req.params.tenantId, input, req.user!.userId), 201);
  } catch (error) { next(error); }
});

financeRouter.get('/tenants/:tenantId/finance/reports', requirePermission('finance:read'), async (req, res, next) => {
  try { send(res, await prisma.financeReport.findMany({ where: { tenantId: req.params.tenantId }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

financeRouter.get('/tenants/:tenantId/finance/approval-requests', requirePermission('finance:read'), async (req, res, next) => {
  try { send(res, await prisma.approvalRequest.findMany({ where: { tenantId: req.params.tenantId, actionType: { in: ['finance_expense', 'finance_invoice', 'finance_refund'] } }, orderBy: { createdAt: 'desc' } })); } catch (error) { next(error); }
});

financeRouter.post('/tenants/:tenantId/finance/approval-requests/:approvalId/review', requirePermission('finance:write'), requireRole(StandardRoles.ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ decision: z.enum(['approved', 'rejected']), rejectionReason: z.string().optional() }).parse(req.body);
    send(res, await financeService.reviewApproval(req.params.tenantId, req.params.approvalId, req.user!.userId, input.decision, input.rejectionReason));
  } catch (error) { next(error); }
});
