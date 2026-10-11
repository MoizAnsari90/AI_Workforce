import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getBusinessProfile } from './businessProfileService';
import { wallTimeToUtc } from './calendarAvailability';
import { generateStoreReport } from './storeReportService';
import { sendStoreReport, verifyReportTemplate } from './storeReportDelivery';
import { hasSubscription, assertSubscription } from './subscriptionService';
import { DispatchError } from './nicheProviders';
import { sealAutomation } from './nicheAutomationStore';
import { ValidationError } from '../errors/AppError';
import { logger } from '../utils/logger';

export const reportSettingsSchema = z.object({ enabled: z.boolean(), recipient: z.string().trim().max(16), deliveryTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), templateName: z.string().regex(/^[a-z0-9_]*$/).max(100), templateLanguage: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/), consent: z.boolean() }).strict().superRefine((s, ctx) => {
  if (s.enabled && (!/^\+[1-9]\d{7,14}$/.test(s.recipient) || !s.templateName || !s.consent)) ctx.addIssue({ code: 'custom', message: 'Enter a WhatsApp recipient with country code, choose a template, and confirm recipient consent.' });
});
export function localReportDate(now: Date, timezone: string, days = 0) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + days)).toISOString().slice(0, 10);
}
export function nextReportTime(now: Date, timezone: string, time: string) {
  const [hour, minute] = time.split(':').map(Number);
  for (let day = 0; day < 3; day++) {
    const date = localReportDate(now, timezone, day);
    const [y, m, d] = date.split('-').map(Number);
    for (let offset = 0; offset <= 180; offset++) {
      const wall = new Date(Date.UTC(y, m - 1, d, hour, minute + offset));
      try {
        const candidate = wallTimeToUtc(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), timezone);
        if (candidate > now) return candidate;
        break;
      } catch { /* A DST gap uses the next existing local minute. */ }
    }
  }
  throw new ValidationError('The report delivery time could not be scheduled.');
}
export async function reportSettings(tenantId: string) {
  const [settings, reports, business] = await Promise.all([
    prisma.storeReportSchedule.findUnique({ where: { tenantId } }),
    prisma.storeDailyReport.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 14 }),
    getBusinessProfile(tenantId),
  ]);
  return { settings: settings ? { ...settings, consent: !!settings.consentAt } : { enabled: false, recipient: '', deliveryTime: '00:10', templateName: '', templateLanguage: 'en_US', timezone: business.profile?.timezone || 'Asia/Karachi', consent: false }, reports };
}
export async function saveReportSettings(tenantId: string, input: unknown) {
  const settings = reportSettingsSchema.parse(input);
  const { profile } = await getBusinessProfile(tenantId);
  if (settings.enabled) {
    await assertSubscription(tenantId);
    if (!profile || profile.industry !== 'ecommerce') throw new ValidationError('Save your e-commerce business details before enabling daily reports.');
    await verifyReportTemplate(tenantId, settings.templateName, settings.templateLanguage);
    // Read-only preflight verifies store access. It never sends a test message.
    await generateStoreReport(tenantId, 'yesterday');
  }
  const timezone = profile?.timezone || 'Asia/Karachi';
  const { consent, ...values } = settings;
  const data = { ...values, timezone, consentAt: consent ? new Date() : null, nextRunAt: nextReportTime(new Date(), timezone, settings.deliveryTime) };
  await prisma.storeReportSchedule.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  return reportSettings(tenantId);
}
export async function recordStoreReportDelivery(tenantId: string, providerId: string, status: string) {
  if (!['delivered', 'read', 'failed'].includes(status)) return;
  const final = status === 'failed' ? 'failed' : 'delivered';
  const changed = await prisma.storeDailyReport.updateMany({ where: { tenantId, providerId, status: { in: final === 'delivered' ? ['accepted', 'unknown', 'failed'] : ['accepted', 'unknown'] } }, data: { status: final } });
  if (!changed.count && await prisma.storeDailyReport.findFirst({ where: { tenantId, status: 'sending' }, select: { id: true } })) {
    const key = `store-report-receipt:${providerId}`;
    const existing = await prisma.nicheDispatch.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (existing?.status === 'delivered') return;
    await prisma.nicheDispatch.upsert({ where: { tenantId_key: { tenantId, key } }, create: { tenantId, key, type: 'provider_delivery_receipt', status: final, dueAt: new Date(Date.now() + 600000), encryptedPayload: sealAutomation({ providerId }, tenantId) }, update: { status: final } });
  }
}
export async function runScheduledReport(tenantId: string, now = new Date()) {
  const config = await prisma.storeReportSchedule.findUnique({ where: { tenantId } });
  if (!config?.enabled || !config.consentAt || config.nextRunAt > now) return;
  // Use the scheduled day, so restarts catch up missed days rather than silently skipping them.
  const reportDate = localReportDate(config.nextRunAt, config.timezone, -1);
  const report = await prisma.storeDailyReport.upsert({ where: { tenantId_reportDate: { tenantId, reportDate } }, create: { tenantId, reportDate }, update: {} });
  if (['accepted', 'delivered', 'failed', 'unknown', 'skipped'].includes(report.status)) {
    await prisma.storeReportSchedule.updateMany({ where: { tenantId, updatedAt: config.updatedAt }, data: { nextRunAt: nextReportTime(config.nextRunAt, config.timezone, config.deliveryTime) } }); return;
  }
  const attempt = report.attempts + 1;
  const claim = await prisma.storeDailyReport.updateMany({ where: { id: report.id, tenantId, attempts: report.attempts, AND: { attempts: { lt: 3 } }, OR: [{ status: 'pending' }, { status: 'generating', leaseUntil: { lt: now } }] }, data: { status: 'generating', attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + 600000) } });
  if (!claim.count) return;
  let sending = false;
  try {
    if (!await hasSubscription(tenantId)) throw new ValidationError('An active subscription is required for scheduled reports.');
    const summary = await generateStoreReport(tenantId, reportDate, now, config.timezone);
    await verifyReportTemplate(tenantId, config.templateName, config.templateLanguage);
    const current = await prisma.storeReportSchedule.findUnique({ where: { tenantId } });
    if (!current?.enabled || current.updatedAt.getTime() !== config.updatedAt.getTime() || !await hasSubscription(tenantId)) {
      await prisma.storeDailyReport.updateMany({ where: { id: report.id, status: 'generating', attempts: attempt }, data: { status: 'skipped', leaseUntil: null, error: 'Delivery settings or subscription changed before sending.' } }); return;
    }
    const reserved = await prisma.storeDailyReport.updateMany({ where: { id: report.id, status: 'generating', attempts: attempt, leaseUntil: { gt: new Date() } }, data: { summary: summary as unknown as Prisma.InputJsonValue, status: 'sending', leaseUntil: new Date(Date.now() + 60000) } });
    if (!reserved.count) return; // An expired worker must never send after another worker took over.
    sending = true;
    const providerId = await sendStoreReport(tenantId, config.recipient, config.templateName, config.templateLanguage, summary);
    await prisma.storeDailyReport.updateMany({ where: { id: report.id, attempts: attempt, status: { in: ['sending', 'unknown'] } }, data: { providerId, status: 'accepted', error: null, leaseUntil: null } });
    const receipt = await prisma.nicheDispatch.findUnique({ where: { tenantId_key: { tenantId, key: `store-report-receipt:${providerId}` } } });
    if (receipt) await recordStoreReportDelivery(tenantId, providerId, receipt.status);
  } catch (error) {
    const uncertain = sending && (!(error instanceof DispatchError) || error.uncertain);
    const retry = !sending && report.attempts < 2;
    await prisma.storeDailyReport.updateMany({ where: { id: report.id, attempts: attempt, status: { in: sending ? ['sending', 'unknown'] : ['generating'] } }, data: { status: uncertain ? 'unknown' : retry ? 'pending' : 'failed', error: uncertain ? 'Provider acceptance is uncertain. Review Meta delivery activity; automatic resend is disabled.' : 'Report generation or delivery failed. Check store access, subscription and approved template.', leaseUntil: null } });
    if (retry) return;
  }
  await prisma.storeReportSchedule.updateMany({ where: { tenantId, updatedAt: config.updatedAt }, data: { nextRunAt: nextReportTime(config.nextRunAt, config.timezone, config.deliveryTime) } });
}
export async function tickStoreReports(tenantId?: string) {
  await prisma.storeDailyReport.updateMany({ where: { tenantId, status: 'generating', attempts: { gte: 3 }, leaseUntil: { lt: new Date() } }, data: { status: 'failed', leaseUntil: null, error: 'Report generation was interrupted repeatedly. Check store access before the next scheduled report.' } });
  await prisma.storeDailyReport.updateMany({ where: { tenantId, status: 'sending', leaseUntil: { lt: new Date() } }, data: { status: 'unknown', error: 'Sending was interrupted. Review provider activity before taking action.' } });
  const due = await prisma.storeReportSchedule.findMany({ where: { tenantId, enabled: true, nextRunAt: { lte: new Date() } }, orderBy: { nextRunAt: 'asc' }, take: 25, select: { tenantId: true } });
  for (const item of due) await runScheduledReport(item.tenantId).catch(() => logger.warn('Store report cycle failed', { tenantId: item.tenantId }));
}
let timer: NodeJS.Timeout | undefined; let running: Promise<void> | null = null;
export function startStoreReports() { if (timer) return; timer = setInterval(() => { if (!running) running = tickStoreReports().catch(() => logger.warn('Store report scheduler unavailable')).finally(() => { running = null; }); }, 60000); timer.unref(); }
export async function stopStoreReports() { if (timer) clearInterval(timer); timer = undefined; await running; }
