import { beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent }; } }));
vi.mock('../src/config/env', () => ({ env: { GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'test-model', LOG_LEVEL: 'error' } }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: any, _res: any, next: any) => {
  req.tenantId = 'tenant-a';
  req.user = { tenantId: 'tenant-a', userId: 'user', permissions: ['operations:read'] };
  next();
} }));
vi.mock('../src/lib/prisma', () => ({ prisma: {
  tenant: { findFirst: vi.fn() }, inventoryRecord: { count: vi.fn() },
  stockAlert: { count: vi.fn() }, approvalRequest: { count: vi.fn() },
  task: { count: vi.fn() }, message: { count: vi.fn() },
} }));
import { prisma } from '../src/lib/prisma';
import { operationsRouter } from '../src/routes/operationsRoutes';
import { answerVerifiedMetrics } from '../src/services/workforceMetricsService';
import { parseWorkforcePeriod } from '../src/services/workforcePeriod';
const app = express();
app.use(express.json(), operationsRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.tenant.findFirst).mockResolvedValue({ name: 'Workspace' } as any);
  for (const model of [prisma.inventoryRecord, prisma.stockAlert, prisma.approvalRequest, prisma.task]) vi.mocked(model.count).mockResolvedValue(0);
  vi.mocked(prisma.message.count).mockImplementation(async (args: any) => args.where.direction === 'outbound' ? 2 : 15);
  generateContent.mockRejectedValue(Object.assign(new Error('provider secret detail'), { status: 503 }));
});
it.each([2, 0])('answers the reported question from verified database counts (%s replies) without an LLM', async replies => {
  vi.mocked(prisma.message.count).mockImplementation(async (args: any) => args.where.direction === 'outbound' ? replies : 15);
  const result = await request(app).post('/tenants/tenant-a/workforce/ask').send({ question: 'AI ne kitne customer messages ka jawab diya hai?' });
  expect(result.status).toBe(200);
  expect(result.body.data).toMatchObject({ source: 'database', readOnly: true });
  expect(result.body.data.answer).toContain(`${replies} AI outbound replies`);
  expect(result.body.data.answer).toContain('15 inbound customer messages');
  expect(result.body.data.answer).toContain('does not represent unique');
  expect(prisma.message.count).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', direction: 'outbound', senderType: 'ai' } });
  expect(generateContent).not.toHaveBeenCalled();
});
it('returns a safe 503 instead of generic 500 when the provider fails for an unsupported question', async () => {
  const result = await request(app).post('/tenants/tenant-a/workforce/ask').send({ question: 'Explain what my workspace data can tell me.' });
  expect(result.status).toBe(503);
  expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
  expect(result.text).not.toContain('provider secret detail');
  expect(generateContent).toHaveBeenCalledOnce();
});
it('does not mistake “this workspace” for a request to filter by date', async () => {
  const result = await request(app).post('/tenants/tenant-a/workforce/ask').send({
    question: 'Using only the metrics provided, what cautious observation can you make about this workspace?',
  });
  expect(result.status).toBe(503); // mocked provider failure proves the Gemini branch was reached
  expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
  expect(generateContent).toHaveBeenCalledOnce();
});
it('rejects cross-tenant metrics access', async () => {
  expect((await request(app).post('/tenants/tenant-b/workforce/ask').send({ question: 'AI replies kitne hain?' })).status).toBe(403);
  expect(prisma.message.count).not.toHaveBeenCalled();
});
it('does not disguise database failure as a zero count', async () => {
  vi.mocked(prisma.message.count).mockRejectedValue(new Error('database unavailable'));
  const result = await request(app).post('/tenants/tenant-a/workforce/ask').send({ question: 'AI replies kitne hain?' });
  expect(result.status).toBe(500);
  expect(result.body.data).toBeUndefined();
  expect(generateContent).not.toHaveBeenCalled();
});
it('labels task counts and summary with their actual all-time scope', () => {
  const metrics = { inventoryCount: 0, lowStockAlerts: 3, pendingApprovals: 4, completedAgentTasks: 5, totalTasks: 8, inboundCustomerMessages: 15, aiOutboundReplies: 2, aiRepliesPer100Inbound: 13 };
  expect(answerVerifiedMetrics('Kitne agent tasks complete hue hain?', metrics)).toContain('5 agent-assigned tasks');
  expect(answerVerifiedMetrics('Kitni approvals pending hain?', metrics)).toContain('4 approvals');
  expect(answerVerifiedMetrics('workspace summary', metrics)).toContain('all time');
});

it.each(['Aaj AI ne kitne customer messages ka jawab diya hai?', 'Yesterday completed tasks?', 'Last week workspace summary', '2026-10-01 AI reply count?'])('answers using date-filtered figures for: %s', async question => {
  const response = await request(app).post('/tenants/tenant-a/workforce/ask').send({ question });
  expect(response.status).toBe(200);
  expect(response.body.data.answer).toContain('During ');
  expect(response.body.data.answer).toContain('0');
  expect(response.body.data.answer).not.toContain('Date-filtered metrics are not supported');
  expect(generateContent).not.toHaveBeenCalled();
});

it('uses date-bounded message counts instead of all-time totals for today', async () => {
  vi.mocked(prisma.message.count).mockImplementation(async (args: any) => {
    if (args.where.createdAt) return args.where.direction === 'outbound' ? 4 : 12;
    return args.where.direction === 'outbound' ? 2 : 15;
  });
  const response = await request(app).post('/tenants/tenant-a/workforce/ask').send({ question: 'Aaj AI ne kitne customer messages ka jawab diya hai?' });
  expect(response.status).toBe(200);
  expect(response.body.data.answer).toContain('4 AI outbound replies and 12 inbound customer messages');
  expect(prisma.message.count).toHaveBeenCalledWith({ where: {
    tenantId: 'tenant-a', direction: 'outbound', senderType: 'ai',
    createdAt: expect.objectContaining({ gte: expect.any(Date), lt: expect.any(Date) }),
  } });
});

it('applies Karachi calendar boundaries with an exclusive next-day end', () => {
  const range = parseWorkforcePeriod('AI replies today?', new Date('2026-10-02T09:00:00.000Z'))!;
  expect(range.start.toISOString()).toBe('2026-10-01T19:00:00.000Z');
  expect(range.end.toISOString()).toBe('2026-10-02T19:00:00.000Z');
});

it('covers complete week and month ranges in Karachi time', () => {
  const now = new Date('2026-10-02T09:00:00.000Z');
  const week = parseWorkforcePeriod('last week tasks', now)!;
  expect(week.start.toISOString()).toBe('2026-09-20T19:00:00.000Z');
  expect(week.end.toISOString()).toBe('2026-09-27T19:00:00.000Z');
  const month = parseWorkforcePeriod('this month replies', now)!;
  expect(month.start.toISOString()).toBe('2026-09-30T19:00:00.000Z');
  expect(month.end.toISOString()).toBe('2026-10-31T19:00:00.000Z');
});
