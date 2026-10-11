import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
const actor = vi.hoisted(() => ({ tenantId: '', role: 'admin' }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: any, res: any, next: any) => { if (!req.headers.authorization) return res.sendStatus(401); req.tenantId = actor.tenantId; req.user = { tenantId: actor.tenantId, role: actor.role }; next(); } }));
vi.mock('../src/services/storeReportService', () => ({ generateStoreReport: vi.fn() }));
vi.mock('../src/services/storeReportDelivery', () => ({ sendStoreReport: vi.fn(), verifyReportTemplate: vi.fn() }));
vi.mock('../src/services/subscriptionService', () => ({ hasSubscription: vi.fn(), assertSubscription: vi.fn() }));
import { prisma } from '../src/lib/prisma';
import { generateStoreReport } from '../src/services/storeReportService';
import { sendStoreReport, verifyReportTemplate } from '../src/services/storeReportDelivery';
import { hasSubscription } from '../src/services/subscriptionService';
import { DispatchError } from '../src/services/nicheProviders';
import { nextReportTime, runScheduledReport, recordStoreReportDelivery, tickStoreReports, localReportDate } from '../src/services/storeReportScheduler';
import { storeReportRouter } from '../src/routes/storeReportRoutes';
const app = express(); app.use(express.json(), storeReportRouter); app.use((e: any, _req: any, res: any, _next: any) => res.status(e.statusCode || (e.issues ? 400 : 500)).json({ error: e.message }));
const base = () => `/tenants/${actor.tenantId}/store-reports`;
const row = () => prisma.storeDailyReport.findFirstOrThrow({ where: { tenantId: actor.tenantId } });
beforeAll(async () => { actor.tenantId = (await prisma.tenant.create({ data: { name: `report-fixture-${randomUUID()}` } })).id; });
beforeEach(async () => {
  vi.resetAllMocks(); actor.role = 'admin';
  vi.mocked(hasSubscription).mockResolvedValue(true); vi.mocked(sendStoreReport).mockResolvedValue('wamid.report'); vi.mocked(generateStoreReport).mockResolvedValue({ orders: 2 } as any);
  await prisma.storeDailyReport.deleteMany({ where: { tenantId: actor.tenantId } }); await prisma.nicheDispatch.deleteMany({ where: { tenantId: actor.tenantId } });
  const settings = { enabled: true, consentAt: new Date(), recipient: '+923001234567', timezone: 'Asia/Karachi', deliveryTime: '00:10', templateName: 'store_summary', templateLanguage: 'en_US', nextRunAt: new Date(Date.now() - 1000) };
  await prisma.storeReportSchedule.upsert({ where: { tenantId: actor.tenantId }, create: { tenantId: actor.tenantId, ...settings }, update: settings });
});
afterAll(async () => { await prisma.tenant.delete({ where: { id: actor.tenantId } }); await prisma.$disconnect(); });
it('sends only once under concurrent workers and repeat ticks', async () => {
  await Promise.all([runScheduledReport(actor.tenantId), runScheduledReport(actor.tenantId)]); await runScheduledReport(actor.tenantId);
  expect(sendStoreReport).toHaveBeenCalledTimes(1); expect(await row()).toMatchObject({ status: 'accepted', providerId: 'wamid.report', attempts: 1 });
});
it('never retries an uncertain provider send', async () => {
  vi.mocked(sendStoreReport).mockRejectedValue(new DispatchError('timeout', true));
  await runScheduledReport(actor.tenantId); await runScheduledReport(actor.tenantId);
  expect(sendStoreReport).toHaveBeenCalledOnce(); expect((await row()).status).toBe('unknown');
});
it('retries read failures three times without sending', async () => {
  vi.mocked(generateStoreReport).mockRejectedValue(new Error('access failed'));
  for (let i = 0; i < 4; i++) await runScheduledReport(actor.tenantId);
  expect(generateStoreReport).toHaveBeenCalledTimes(3); expect(sendStoreReport).not.toHaveBeenCalled(); expect(await row()).toMatchObject({ status: 'failed', attempts: 3 });
});
it('does not send when settings are disabled while calculating', async () => {
  vi.mocked(generateStoreReport).mockImplementationOnce(async () => { await prisma.storeReportSchedule.update({ where: { tenantId: actor.tenantId }, data: { enabled: false } }); return { orders: 1 } as any; });
  await runScheduledReport(actor.tenantId); expect(sendStoreReport).not.toHaveBeenCalled(); expect((await row()).status).toBe('skipped');
});
it('fences a worker whose lease was taken over before sending', async () => {
  vi.mocked(verifyReportTemplate).mockImplementationOnce(async () => { await prisma.storeDailyReport.updateMany({ where: { tenantId: actor.tenantId }, data: { attempts: 2 } }); });
  await runScheduledReport(actor.tenantId); expect(sendStoreReport).not.toHaveBeenCalled();
});
it('does not send without a subscription or recipient consent', async () => {
  vi.mocked(hasSubscription).mockResolvedValue(false); await runScheduledReport(actor.tenantId); expect(sendStoreReport).not.toHaveBeenCalled();
  await prisma.storeReportSchedule.update({ where: { tenantId: actor.tenantId }, data: { consentAt: null } }); await runScheduledReport(actor.tenantId); expect(generateStoreReport).not.toHaveBeenCalled();
});
it('accepts early delivery receipts without downgrading delivered or crossing tenant', async () => {
  vi.mocked(sendStoreReport).mockImplementationOnce(async () => { await recordStoreReportDelivery(actor.tenantId, 'wamid.report', 'delivered'); return 'wamid.report'; });
  await runScheduledReport(actor.tenantId); expect((await row()).status).toBe('delivered');
  await recordStoreReportDelivery(actor.tenantId, 'wamid.report', 'failed'); expect((await row()).status).toBe('delivered');
  await prisma.storeDailyReport.updateMany({ where: { tenantId: actor.tenantId }, data: { status: 'accepted' } });
  await recordStoreReportDelivery(randomUUID(), 'wamid.report', 'delivered'); expect((await row()).status).toBe('accepted');
});
it('marks interrupted sending unknown instead of automatically resending', async () => {
  await prisma.storeDailyReport.create({ data: { tenantId: actor.tenantId, reportDate: localReportDate(new Date(), 'Asia/Karachi', -1), status: 'sending', attempts: 1, leaseUntil: new Date(0) } });
  await tickStoreReports(actor.tenantId); expect((await row()).status).toBe('unknown'); expect(sendStoreReport).not.toHaveBeenCalled();
});
it('enforces authenticated admin and tenant isolation on all report routes', async () => {
  expect((await request(app).get(base())).status).toBe(401);
  actor.role = 'viewer'; expect((await request(app).get(base()).set('Authorization', 'Bearer fixture')).status).toBe(403); actor.role = 'admin';
  expect((await request(app).get(`/tenants/${randomUUID()}/store-reports/preview`).set('Authorization', 'Bearer fixture')).status).toBe(403);
  expect(generateStoreReport).not.toHaveBeenCalled();
});
it('previews a report without sending and rejects invalid enabling input', async () => {
  expect((await request(app).get(`${base()}/preview?date=2026-10-10`).set('Authorization', 'Bearer fixture')).status).toBe(200); expect(sendStoreReport).not.toHaveBeenCalled();
  expect((await request(app).put(base()).set('Authorization', 'Bearer fixture').send({ enabled: true, recipient: '123', deliveryTime: '00:10', consent: false, templateName: '', templateLanguage: 'en_US' })).status).toBe(400);
});
it('schedules in business timezone including DST gaps', () => {
  expect(nextReportTime(new Date('2026-10-10T20:00:00Z'), 'Asia/Karachi', '00:10').toISOString()).toBe('2026-10-11T19:10:00.000Z');
  expect(nextReportTime(new Date('2026-03-08T05:00:00Z'), 'America/New_York', '02:30').toISOString()).toBe('2026-03-08T07:00:00.000Z');
});
