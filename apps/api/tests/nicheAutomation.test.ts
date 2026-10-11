import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const actor = vi.hoisted(() => ({ tenantId: '', role: 'admin' }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: Request, _res: Response, next: NextFunction) => { if (req.headers.authorization !== 'Bearer fixture') return next(Object.assign(new Error('Unauthorized'), { statusCode: 401 })); req.user = { tenantId: actor.tenantId, userId: 'admin-fixture', role: actor.role as 'admin', permissions: [] }; req.tenantId = actor.tenantId; next(); } }));
vi.mock('../src/services/googleCalendarService', () => ({ bookingCalendarContext: vi.fn(async () => ({ connectionId: 'fixture' })), resourceCalendarBusy: vi.fn(async () => ({ connectionId: 'fixture', busy: [] })), syncAppointmentEvent: vi.fn(async (_booking, cancel) => cancel ? 'cancelled' : 'confirmed') }));
vi.mock('../src/services/nicheProviders', async importOriginal => { const original = await importOriginal<typeof import('../src/services/nicheProviders')>(); return { ...original, whatsappCredential: vi.fn(), sendNicheWhatsApp: vi.fn(), sendNicheVoiceCall: vi.fn(), verifyReminderTemplate: vi.fn(), verifyNicheVoiceRequest: vi.fn(), getVoiceCredential: vi.fn() }; });
import { prisma } from '../src/lib/prisma';
import { nicheAutomationRouter } from '../src/routes/nicheAutomationRoutes';
import { receiveNicheVoice } from '../src/controllers/nicheVoiceController';
import { processNicheTurn } from '../src/services/nicheConversationService';
import { customerHash, defaultAutomation, enqueueNicheDispatch, openAutomation, sealAutomation } from '../src/services/nicheAutomationStore';
import { acceptNicheInbound, recordNicheDelivery, runNicheDispatch, scheduleNicheReminders } from '../src/services/nicheAutomationWorker';
import { DispatchError, getVoiceCredential, sendNicheVoiceCall, sendNicheWhatsApp, verifyNicheVoiceRequest, verifyReminderTemplate, whatsappCredential } from '../src/services/nicheProviders';
const app = express(); app.use(express.json()); app.post('/webhook/:tenantId/niche-voice', receiveNicheVoice); app.use(nicheAutomationRouter);
app.use((error: Error & { statusCode?: number; issues?: unknown }, _req: Request, res: Response, _next: NextFunction) => res.status(error.statusCode || (error.issues ? 400 : 500)).json({ error: error.message }));
const phone = '+923001234567'; const config = { ...defaultAutomation, whatsappEnabled: true, voiceEnabled: true, remindersEnabled: true, templateName: 'appointment_reminder' };
const profile = { name: 'Automation fixture', country: 'PK', industry: 'healthcare', currency: 'PKR', timezone: 'Asia/Karachi', languages: ['en'], primaryLanguage: 'en', slotMinutes: 30, bufferMinutes: 0, workingHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, start: '09:00', end: '17:00' })) };
const base = () => `/tenants/${actor.tenantId}/reception-automation`;
const turn = (text: string, messageId = randomUUID()) => processNicheTurn(actor.tenantId, { text, phone, messageId, channel: 'whatsapp', receivedAt: new Date().toISOString() });
async function bookClinic() { for (const text of ['hello', 'AGREE', 'Fixture Patient', '1', '1', '2030-01-07', '1']) await turn(text); return turn('YES'); }
beforeAll(async () => { actor.tenantId = (await prisma.tenant.create({ data: { name: `automation-fixture-${randomUUID()}` } })).id; });
beforeEach(async () => {
  await prisma.agent.deleteMany({ where: { tenantId: actor.tenantId } });
  await prisma.agent.createMany({ data: ['healthcare', 'sales'].map(department => ({ tenantId: actor.tenantId, department, name: `${department} fixture`, isActive: true })) });
  actor.role = 'admin'; vi.clearAllMocks();
  vi.mocked(whatsappCredential).mockResolvedValue({ accessToken: 'fixture-token', phoneNumberId: '12345678', wabaId: '87654321' });
  vi.mocked(sendNicheWhatsApp).mockResolvedValue('wamid.accepted-fixture'); vi.mocked(sendNicheVoiceCall).mockResolvedValue(randomUUID()); vi.mocked(verifyReminderTemplate).mockResolvedValue({ name: 'appointment_reminder', language: 'en_US', text: 'Appointment reminder {{1}}' }); vi.mocked(verifyNicheVoiceRequest).mockResolvedValue(null);
  vi.mocked(getVoiceCredential).mockResolvedValue({ apiKey: 'fixture-key', assistantId: randomUUID(), phoneNumberId: randomUUID(), webhookSecret: 'fixture-secret-that-is-long-enough' });
  await prisma.nicheDispatch.deleteMany({ where: { tenantId: actor.tenantId } }); await prisma.nicheSession.deleteMany({ where: { tenantId: actor.tenantId } }); await prisma.scheduledAppointment.deleteMany({ where: { tenantId: actor.tenantId } }); await prisma.bookingResource.deleteMany({ where: { tenantId: actor.tenantId } }); await prisma.lead.deleteMany({ where: { tenantId: actor.tenantId } }); await prisma.propertyListing.deleteMany({ where: { tenantId: actor.tenantId } });
  await prisma.nicheAutomation.upsert({ where: { tenantId: actor.tenantId }, create: { tenantId: actor.tenantId, config }, update: { config } }); await prisma.businessProfile.upsert({ where: { tenantId: actor.tenantId }, create: { tenantId: actor.tenantId, profile }, update: { profile } });
  const resource = await prisma.bookingResource.create({ data: { tenantId: actor.tenantId, kind: 'healthcare', name: 'Dr Fixture', calendarId: 'fixture-calendar' } }); await prisma.clinicService.create({ data: { tenantId: actor.tenantId, resourceId: resource.id, name: 'Consultation', durationMinutes: 30 } });
});
afterAll(async () => { await prisma.tenant.delete({ where: { id: actor.tenantId } }); await prisma.$disconnect(); });
describe('Reception automation', () => {
  it('keeps new customer automation paused when its bundle agent is paused', async () => {
    await prisma.agent.updateMany({ where: { tenantId: actor.tenantId, department: 'healthcare' }, data: { isActive: false } });
    const result = await turn('hello'); expect(result.paused).toBe(true); expect(result.reply).toBe('');
    expect(await prisma.nicheDispatch.count({ where: { tenantId: actor.tenantId, type: 'whatsapp_reply' } })).toBe(0);
  });
  it('requires admin access and tenant ownership for settings and inbox', async () => {
    expect((await request(app).get(base())).status).toBe(401); actor.role = 'viewer'; expect((await request(app).get(base()).set('Authorization', 'Bearer fixture')).status).toBe(403); actor.role = 'admin'; expect((await request(app).get(`/tenants/${randomUUID()}/reception-automation`).set('Authorization', 'Bearer fixture')).status).toBe(403);
  });
  it('validates providers before enabling automation', async () => {
    vi.mocked(verifyReminderTemplate).mockRejectedValueOnce(new Error('unapproved template'));
    expect((await request(app).put(base()).set('Authorization', 'Bearer fixture').send(config)).status).toBe(500);
    expect((await request(app).put(base()).set('Authorization', 'Bearer fixture').send({ ...config, reminderHours: 0 })).status).toBe(400);
  });
  it('persists and deduplicates inbound events before returning, binding the recipient number', async () => {
    const message = { fromPhone: phone.slice(1), text: 'hello', timestamp: new Date().toISOString(), phoneNumberId: '12345678', metaMessageId: 'wamid.once' };
    expect(await acceptNicheInbound(actor.tenantId, message)).toBe(true); await acceptNicheInbound(actor.tenantId, message); expect(await prisma.nicheDispatch.count({ where: { tenantId: actor.tenantId, type: 'inbound' } })).toBe(1);
    await expect(acceptNicheInbound(actor.tenantId, { ...message, phoneNumberId: 'foreign' })).rejects.toThrow('does not belong');
    const job = await prisma.nicheDispatch.findFirstOrThrow({ where: { tenantId: actor.tenantId, type: 'inbound' } }); await runNicheDispatch(job.id); await runNicheDispatch(job.id); expect(await prisma.nicheDispatch.count({ where: { tenantId: actor.tenantId, type: 'whatsapp_reply' } })).toBe(1);
  });
  it('completes a clinic conversation and only books after a clear confirmation', async () => {
    for (const text of ['hi', 'AGREE', 'Fixture Patient', '1', '1', '2030-01-07', '1']) await turn(text);
    expect(await prisma.scheduledAppointment.count({ where: { tenantId: actor.tenantId } })).toBe(0);
    expect((await turn('maybe')).reply).toContain('No appointment');
    const result = await turn('YES', 'confirm-once'); expect(result.reply).toContain('confirmed'); await turn('YES', 'confirm-once'); expect(await prisma.scheduledAppointment.count({ where: { tenantId: actor.tenantId } })).toBe(1);
    const record = await prisma.nicheSession.findFirstOrThrow({ where: { tenantId: actor.tenantId } }); expect(record.encryptedState).not.toContain(phone); expect(record.encryptedState).not.toContain('Fixture Patient');
    await turn('REMIND'); expect((await prisma.scheduledAppointment.findFirstOrThrow({ where: { tenantId: actor.tenantId } })).reminderConsent).toBe(true);
    await turn('CANCEL'); expect((await prisma.scheduledAppointment.findFirstOrThrow({ where: { tenantId: actor.tenantId } })).status).toBe('confirmed'); await turn('CANCEL YES'); expect((await prisma.scheduledAppointment.findFirstOrThrow({ where: { tenantId: actor.tenantId } })).status).toBe('cancelled');
  }, 30000);
  it('qualifies a real-estate lead and books a matching property viewing', async () => {
    await prisma.nicheAutomation.update({ where: { tenantId: actor.tenantId }, data: { config: { ...config, kind: 'real_estate' } } });
    await prisma.bookingResource.create({ data: { tenantId: actor.tenantId, kind: 'real_estate', name: 'Viewing agent', calendarId: 'property-calendar' } });
    await prisma.propertyListing.create({ data: { tenantId: actor.tenantId, reference: 'F1', title: 'Fixture house', city: 'Lahore', area: 'DHA', purpose: 'buy', propertyType: 'house', country: 'PK', currency: 'PKR', price: 100000 } });
    for (const text of ['hi', 'AGREE', 'Fixture Buyer', 'buy', 'Lahore', 'DHA', 'house', '150000', '1', '1', '1', '1', '2030-01-07', '1']) await turn(text);
    expect((await turn('YES')).reply).toContain('confirmed'); expect(await prisma.lead.count({ where: { tenantId: actor.tenantId, source: 'real_estate' } })).toBe(1);
  });
  it('pauses medical questions and emergencies instead of answering them', async () => {
    expect((await turn('What medicine should I take?')).paused).toBe(true); expect((await turn('hello')).reply).toBe('');
    expect((await turn('chest pain')).reply).toContain('emergency services');
  });
  it('honors STOP, prevents admin override, and requires customer START to resume', async () => {
    await turn('STOP'); const session = await prisma.nicheSession.findFirstOrThrow({ where: { tenantId: actor.tenantId } }); expect(session.optedOut).toBe(true);
    expect((await request(app).post(`${base()}/sessions/${session.id}/resume`).set('Authorization', 'Bearer fixture').send({})).status).toBe(409);
    expect((await turn('hello')).reply).toBe(''); expect((await turn('START')).reply).toContain('automated reception');
  });
  it('suppresses cancelled and opted-out reminders and records provider acceptance separately from delivery', async () => {
    await bookClinic(); await turn('REMIND'); let booking = await prisma.scheduledAppointment.findFirstOrThrow({ where: { tenantId: actor.tenantId } });
    await prisma.scheduledAppointment.update({ where: { id: booking.id }, data: { startTime: new Date(Date.now() + 3600_000), endTime: new Date(Date.now() + 5400_000) } });
    await scheduleNicheReminders(); await scheduleNicheReminders(); const job = await prisma.nicheDispatch.findFirstOrThrow({ where: { tenantId: actor.tenantId, type: 'reminder' } }); expect(await prisma.nicheDispatch.count({ where: { tenantId: actor.tenantId, type: 'reminder' } })).toBe(1);
    await runNicheDispatch(job.id); expect((await prisma.nicheDispatch.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('accepted'); await recordNicheDelivery(actor.tenantId, 'wamid.accepted-fixture', 'delivered'); expect((await prisma.nicheDispatch.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('delivered');
    await turn('STOP'); const second = await enqueueNicheDispatch(actor.tenantId, 'reminder-second', 'reminder', { appointmentId: booking.id }); await runNicheDispatch(second.id); expect((await prisma.nicheDispatch.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('skipped');
    await prisma.scheduledAppointment.update({ where: { id: booking.id }, data: { status: 'cancelled' } }); const third = await enqueueNicheDispatch(actor.tenantId, 'reminder-third', 'reminder', { appointmentId: booking.id }); await runNicheDispatch(third.id); expect((await prisma.nicheDispatch.findUniqueOrThrow({ where: { id: third.id } })).status).toBe('skipped'); expect(sendNicheWhatsApp).toHaveBeenCalledTimes(1);
  });
  it('does not automatically resend an uncertain outbound message or use an expired reply window', async () => {
    const job = await enqueueNicheDispatch(actor.tenantId, 'reply-unknown', 'whatsapp_reply', { phone, text: 'Fixture reply', receivedAt: new Date().toISOString() }); vi.mocked(sendNicheWhatsApp).mockRejectedValueOnce(new DispatchError('Timeout', true)); await runNicheDispatch(job.id); await runNicheDispatch(job.id); expect(sendNicheWhatsApp).toHaveBeenCalledTimes(1); expect((await prisma.nicheDispatch.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('unknown');
    const expired = await enqueueNicheDispatch(actor.tenantId, 'reply-expired', 'whatsapp_reply', { phone, text: 'Fixture', receivedAt: new Date(0).toISOString() }); await runNicheDispatch(expired.id); expect(sendNicheWhatsApp).toHaveBeenCalledTimes(1);
  });
  it('calls only after explicit CALL and cancels queued callbacks after STOP', async () => {
    await turn('hello'); expect(await prisma.nicheDispatch.count({ where: { tenantId: actor.tenantId, type: 'voice_call' } })).toBe(0); await turn('CALL', 'call-request'); await turn('CALL', 'call-request'); const job = await prisma.nicheDispatch.findFirstOrThrow({ where: { tenantId: actor.tenantId, type: 'voice_call' } }); await turn('STOP'); await runNicheDispatch(job.id); expect(sendNicheVoiceCall).not.toHaveBeenCalled();
    await turn('START'); await turn('CALL', 'second-call'); const next = await prisma.nicheDispatch.findFirstOrThrow({ where: { tenantId: actor.tenantId, key: 'callback:second-call' } }); await runNicheDispatch(next.id); expect(sendNicheVoiceCall).toHaveBeenCalledTimes(1);
  });
  it('rejects forged voice calls and caches authenticated tool results', async () => {
    const callId = randomUUID(); const body = { message: { type: 'tool-calls', call: { id: callId }, toolCallList: [{ id: 'tool-1', name: 'workforce_turn', parameters: { text: 'hello' } }] } };
    expect((await request(app).post(`/webhook/${actor.tenantId}/niche-voice`).send(body)).status).toBe(403);
    vi.mocked(verifyNicheVoiceRequest).mockResolvedValue({ id: callId, assistantId: randomUUID(), phoneNumberId: randomUUID(), customer: { number: phone }, status: 'in-progress' });
    const first = await request(app).post(`/webhook/${actor.tenantId}/niche-voice`).set('Authorization', 'Bearer fixture').send(body); const second = await request(app).post(`/webhook/${actor.tenantId}/niche-voice`).set('Authorization', 'Bearer fixture').send(body); expect(first.status).toBe(200); expect(second.body).toEqual(first.body); expect(first.body.results[0].toolCallId).toBe('tool-1');
  });
  it('binds encrypted session data to its tenant', () => { expect(() => openAutomation(sealAutomation({ phone }, actor.tenantId), 'foreign-tenant')).toThrow('could not be decrypted'); });
  it('carries customer opt-out across voice and WhatsApp and restarts after a business flow change', async () => {
    await turn('STOP');
    const voice = await processNicheTurn(actor.tenantId, { phone, text: 'hello', channel: 'voice', messageId: randomUUID(), receivedAt: new Date().toISOString() });
    expect(voice).toEqual({ reply: '', paused: true });
    expect(await prisma.nicheSession.count({ where: { tenantId: actor.tenantId, optedOut: true } })).toBe(2);
    await turn('START'); await turn('AGREE');
    await prisma.nicheAutomation.update({ where: { tenantId: actor.tenantId }, data: { config: { ...config, kind: 'real_estate' } } });
    expect((await turn('A name from an old flow')).reply).toContain('Reply AGREE');
  });
  it('keeps customer context in the admin inbox and deduplicates staff replies', async () => {
    await acceptNicheInbound(actor.tenantId, { fromPhone: phone.slice(1), text: 'HUMAN', timestamp: new Date().toISOString(), phoneNumberId: '12345678', metaMessageId: 'staff-inbound' });
    const inbound = await prisma.nicheDispatch.findFirstOrThrow({ where: { tenantId: actor.tenantId, type: 'inbound' } }); await runNicheDispatch(inbound.id);
    const inbox = await request(app).get(base()).set('Authorization', 'Bearer fixture'); expect(inbox.body.data.sessions[0].lastCustomerMessage).toBe('HUMAN');
    const sessionId = inbox.body.data.sessions[0].id; const payload = { text: 'Staff can help with scheduling.', requestId: randomUUID() };
    const first = await request(app).post(`${base()}/sessions/${sessionId}/reply`).set('Authorization', 'Bearer fixture').send(payload);
    const second = await request(app).post(`${base()}/sessions/${sessionId}/reply`).set('Authorization', 'Bearer fixture').send(payload);
    expect(first.status).toBe(202); expect(second.body.data.id).toBe(first.body.data.id);
    await runNicheDispatch(first.body.data.id); expect(sendNicheWhatsApp).toHaveBeenCalledWith(actor.tenantId, phone, { text: payload.text });
    await turn('STOP'); expect((await request(app).post(`${base()}/sessions/${sessionId}/reply`).set('Authorization', 'Bearer fixture').send({ ...payload, requestId: randomUUID() })).status).toBe(409);
  });
  it('processes a customer inbound queue in order even if another worker claims the later message first', async () => {
    for (const [id, text] of [['ordered-1', 'hello'], ['ordered-2', 'AGREE']]) await acceptNicheInbound(actor.tenantId, { fromPhone: phone.slice(1), text, timestamp: new Date().toISOString(), phoneNumberId: '12345678', metaMessageId: id });
    const first = await prisma.nicheDispatch.findUniqueOrThrow({ where: { tenantId_key: { tenantId: actor.tenantId, key: 'inbound:ordered-1' } } });
    await prisma.nicheDispatch.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 1000) } });
    const second = await prisma.nicheDispatch.findUniqueOrThrow({ where: { tenantId_key: { tenantId: actor.tenantId, key: 'inbound:ordered-2' } } });
    await runNicheDispatch(second.id); expect((await prisma.nicheDispatch.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('pending');
    await runNicheDispatch(first.id); await runNicheDispatch(second.id);
    const session = await prisma.nicheSession.findFirstOrThrow({ where: { tenantId: actor.tenantId } }); expect(openAutomation<{ stage: string }>(session.encryptedState, actor.tenantId).stage).toBe('name');
  });
});
