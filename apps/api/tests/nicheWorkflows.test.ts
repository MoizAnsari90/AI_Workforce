import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const context = vi.hoisted(() => ({ tenantId: '', role: 'admin' }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: Request, _res: Response, next: NextFunction) => {
  if (req.headers.authorization !== 'Bearer fixture') return next(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
  req.user = { tenantId: context.tenantId, userId: 'fixture-admin', role: context.role as 'admin', permissions: [] }; req.tenantId = context.tenantId; next();
} }));
vi.mock('../src/services/googleCalendarService', () => ({ bookingCalendarContext: vi.fn(), resourceCalendarBusy: vi.fn(), syncAppointmentEvent: vi.fn() }));
import { prisma } from '../src/lib/prisma';
import { nicheWorkflowRouter } from '../src/routes/nicheWorkflowRoutes';
import { bookingCalendarContext, resourceCalendarBusy, syncAppointmentEvent } from '../src/services/googleCalendarService';
import { qualifyPropertyLead } from '../src/services/nicheWorkflowService';
import { ServiceUnavailableError } from '../src/errors/AppError';
const app = express(); app.use(express.json(), nicheWorkflowRouter);
app.use((error: Error & { statusCode?: number; issues?: unknown }, _req: Request, res: Response, _next: NextFunction) => res.status(error.statusCode || (error.issues ? 400 : 500)).json({ error: error.message }));
const profile = { name: 'Niche fixture', country: 'PK', industry: 'healthcare', currency: 'PKR', timezone: 'Asia/Karachi', languages: ['en'], primaryLanguage: 'en', slotMinutes: 30, bufferMinutes: 10, workingHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, start: '09:00', end: '17:00' })) };
const qualification = { purpose: 'buy' as const, city: 'Lahore', area: 'DHA', propertyType: 'house' as const, budget: 200000, timeline: 'within_month' as const, funding: 'ready' as const };
const contact = { name: 'Fixture customer', phone: '+923001234567' };
let otherTenant: string;
const path = (kind = 'healthcare') => `/tenants/${context.tenantId}/bundles/${kind}`;
const post = (url: string, body: unknown) => request(app).post(url).set('Authorization', 'Bearer fixture').send(body);
const get = (url: string) => request(app).get(url).set('Authorization', 'Bearer fixture');
async function doctor(kind = 'healthcare', calendarId = 'fixture-calendar') { const response = await post(`${path(kind)}/resources`, { name: 'Fixture professional', calendarId }); expect(response.status).toBe(201); return response.body.data; }
async function setup() { const resource = await doctor(); const response = await post(`${path()}/services`, { resourceId: resource.id, name: 'Consultation', durationMinutes: 30 }); expect(response.status).toBe(201); return { resourceId: resource.id, serviceId: response.body.data.id, start: '2030-01-07T04:00:00.000Z', contact, idempotencyKey: randomUUID() }; }
beforeAll(async () => { context.tenantId = (await prisma.tenant.create({ data: { name: `niche-${randomUUID()}` } })).id; otherTenant = (await prisma.tenant.create({ data: { name: `niche-other-${randomUUID()}` } })).id; });
beforeEach(async () => {
  context.role = 'admin'; vi.clearAllMocks();
  vi.mocked(bookingCalendarContext).mockResolvedValue({ connectionId: 'fixture-connection' });
  vi.mocked(resourceCalendarBusy).mockResolvedValue({ busy: [], connectionId: 'fixture-connection' });
  vi.mocked(syncAppointmentEvent).mockImplementation(async (_booking, cancel) => cancel ? 'cancelled' : 'confirmed');
  await prisma.scheduledAppointment.deleteMany({ where: { tenantId: context.tenantId } });
  await prisma.bookingResource.deleteMany({ where: { tenantId: context.tenantId } });
  await prisma.propertyListing.deleteMany({ where: { tenantId: context.tenantId } });
  await prisma.lead.deleteMany({ where: { tenantId: context.tenantId } });
  await prisma.businessProfile.upsert({ where: { tenantId: context.tenantId }, create: { tenantId: context.tenantId, profile }, update: { profile } });
});
afterAll(async () => { await prisma.tenant.deleteMany({ where: { id: { in: [context.tenantId, otherTenant] } } }); await prisma.$disconnect(); });

describe('Niche workflows', () => {
  it('requires authentication and admin access and rejects cross-workspace routes', async () => {
    expect((await request(app).get(path())).status).toBe(401);
    expect((await get(`/tenants/${otherTenant}/bundles/healthcare`)).status).toBe(403);
    context.role = 'viewer'; expect((await get(path())).status).toBe(403); expect((await post(`${path()}/resources`, {})).status).toBe(403);
  });
  it('collects missing qualification questions and matches inventory in the same currency/market', async () => {
    const listing = { reference: 'F-001', title: 'Fixture house', city: 'Lahore', area: 'DHA', propertyType: 'house', purpose: 'buy', price: 150000 };
    expect((await post(`${path('real_estate')}/properties`, listing)).status).toBe(201);
    expect((await post(`${path('real_estate')}/properties`, listing)).status).toBe(409);
    const created = await post(`${path('real_estate')}/leads`, { ...contact, qualification });
    expect(created.status).toBe(201); expect(created.body.data.qualification).toMatchObject({ complete: true, score: 100 }); expect(created.body.data.matches).toHaveLength(1);
    const updated = await request(app).put(`${path('real_estate')}/leads/${created.body.data.lead.id}`).set('Authorization', 'Bearer fixture').send({ ...contact, qualification: { ...qualification, budget: null } });
    expect(updated.status).toBe(200); expect(updated.body.data.qualification.complete).toBe(false); expect(updated.body.data.qualification.nextQuestions.join(' ')).toContain('budget'); expect(updated.body.data.matches).toHaveLength(0);
    expect(qualifyPropertyLead({ purpose: null, city: null, area: null, propertyType: null, budget: null, timeline: 'unknown', funding: 'unknown' }).score).toBe(0);
  });
  it('requires an active doctor belonging to the workspace when creating services', async () => {
    const resource = await doctor('real_estate');
    expect((await post(`${path()}/services`, { resourceId: resource.id, name: 'Consultation', durationMinutes: 30 })).status).toBe(404);
    expect((await post(`${path()}/services`, { resourceId: randomUUID(), name: 'Consultation', durationMinutes: 0 })).status).toBe(400);
  });
  it('rejects real foreign resource and service identifiers even on the correct tenant URL', async () => {
    const foreign = await prisma.bookingResource.create({ data: { tenantId: otherTenant, name: 'Foreign doctor', kind: 'healthcare', calendarId: 'foreign-calendar' } });
    const foreignService = await prisma.clinicService.create({ data: { tenantId: otherTenant, resourceId: foreign.id, name: 'Foreign service', durationMinutes: 30 } });
    expect((await post(`${path()}/services`, { resourceId: foreign.id, name: 'Consultation', durationMinutes: 30 })).status).toBe(404);
    expect((await post(`${path()}/appointments`, { resourceId: foreign.id, serviceId: foreignService.id, start: '2030-01-07T04:00:00Z', contact, idempotencyKey: randomUUID() })).status).toBe(404);
    expect((await request(app).patch(`${path()}/resources/${foreign.id}`).set('Authorization', 'Bearer fixture').send({ active: false })).status).toBe(404);
  });
  it('does not match properties left in a different market after business settings change', async () => {
    await post(`${path('real_estate')}/properties`, { reference: 'MARKET-001', title: 'Fixture house', city: 'Lahore', area: 'DHA', propertyType: 'house', purpose: 'buy', price: 100000 });
    await prisma.businessProfile.update({ where: { tenantId: context.tenantId }, data: { profile: { ...profile, country: 'AE', currency: 'AED', timezone: 'Asia/Dubai' } } });
    const response = await post(`${path('real_estate')}/leads`, { ...contact, qualification });
    expect(response.body.data.matches).toHaveLength(0); expect(response.body.data.lead.currency).toBe('AED');
  });
  it('uses service duration, business hours, Google busy times and local buffers', async () => {
    const input = await setup();
    vi.mocked(resourceCalendarBusy).mockResolvedValue({ connectionId: 'fixture-connection', busy: [{ start: '2030-01-07T04:00:00Z', end: '2030-01-07T04:30:00Z' }] });
    const response = await get(`${path()}/availability?resourceId=${input.resourceId}&serviceId=${input.serviceId}&date=2030-01-07`);
    expect(response.status).toBe(200); expect(response.body.data.slots[0]).toEqual({ start: '2030-01-07T04:40:00.000Z', end: '2030-01-07T05:10:00.000Z' }); expect(response.body.data.timezone).toBe('Asia/Karachi');
    expect((await get(`${path()}/availability?resourceId=${input.resourceId}&serviceId=${input.serviceId}&date=2030-02-30`)).status).toBe(400);
    vi.mocked(resourceCalendarBusy).mockRejectedValue(new ServiceUnavailableError('Google unavailable'));
    expect((await get(`${path()}/availability?resourceId=${input.resourceId}&serviceId=${input.serviceId}&date=2030-01-07`)).status).toBe(503);
  });
  it('books, stores encrypted contact data and returns the existing booking for a retry', async () => {
    const input = await setup(); const response = await post(`${path()}/appointments`, input);
    expect(response.status).toBe(200); expect(response.body.data.status).toBe('confirmed');
    const repeat = await post(`${path()}/appointments`, input); expect(repeat.body.data.id).toBe(response.body.data.id);
    expect((await post(`${path()}/appointments`, { ...input, contact: { ...contact, name: 'Other name' } })).status).toBe(409);
    const stored = await prisma.scheduledAppointment.findUniqueOrThrow({ where: { id: response.body.data.id } }); expect(stored.encryptedContact).not.toContain(contact.name); expect(stored.encryptedContact).not.toContain(contact.phone);
    const overview = await get(path()); expect(overview.body.data.appointments[0].contact).toEqual(contact); expect(overview.text).not.toContain('encryptedContact');
    const logs = await prisma.auditLog.findMany({ where: { tenantId: context.tenantId, entityId: stored.id } }); expect(JSON.stringify(logs)).not.toContain(contact.phone);
  });
  it('serializes concurrent requests and prevents double booking even across two resources sharing a calendar', async () => {
    const input = await setup(); const second = await doctor(); const secondService = await post(`${path()}/services`, { resourceId: second.id, name: 'Consultation', durationMinutes: 30 });
    const results = await Promise.all([post(`${path()}/appointments`, input), post(`${path()}/appointments`, { ...input, resourceId: second.id, serviceId: secondService.body.data.id, idempotencyKey: randomUUID() })]);
    expect(results.map(item => item.status).sort()).toEqual([200, 409]); expect(await prisma.scheduledAppointment.count({ where: { tenantId: context.tenantId } })).toBe(1);
  });
  it('retains a reservation after uncertain provider failure and retries the same event', async () => {
    const input = await setup(); vi.mocked(syncAppointmentEvent).mockRejectedValueOnce(new ServiceUnavailableError('Google timed out'));
    const response = await post(`${path()}/appointments`, input); expect(response.status).toBe(202); expect(response.body.data.status).toBe('sync_pending');
    expect((await post(`${path()}/appointments`, { ...input, idempotencyKey: randomUUID() })).status).toBe(409);
    const retry = await post(`${path()}/appointments/${response.body.data.id}/sync`, {}); expect(retry.body.data.status).toBe('confirmed');
    expect(vi.mocked(syncAppointmentEvent).mock.calls[0][0].eventId).toBe(vi.mocked(syncAppointmentEvent).mock.calls[1][0].eventId);
  });
  it('does not release a slot until Google confirms cancellation', async () => {
    const input = await setup(); const response = await post(`${path()}/appointments`, input);
    vi.mocked(syncAppointmentEvent).mockRejectedValueOnce(new ServiceUnavailableError('Google timed out'));
    const cancelled = await post(`${path()}/appointments/${response.body.data.id}/cancel`, {}); expect(cancelled.status).toBe(202); expect(cancelled.body.data.status).toBe('cancel_pending');
    expect((await post(`${path()}/appointments`, { ...input, idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await post(`${path()}/appointments/${response.body.data.id}/sync`, {})).body.data.status).toBe('cancelled');
    expect((await post(`${path()}/appointments`, { ...input, idempotencyKey: randomUUID() })).body.data.status).toBe('confirmed');
  });
  it('rejects wrong-kind/foreign services and archived resources, and cannot cancel another workspace booking', async () => {
    const input = await setup(); expect((await post(`${path()}/appointments`, { ...input, serviceId: randomUUID() })).status).toBe(400);
    expect((await post(`${path()}/appointments/${randomUUID()}/cancel`, {})).status).toBe(404);
    expect((await request(app).patch(`${path()}/resources/${input.resourceId}`).set('Authorization', 'Bearer fixture').send({ active: false })).status).toBe(200);
    expect((await post(`${path()}/appointments`, input)).status).toBe(404);
  });
  it('books a property viewing against actual workspace CRM and inventory records', async () => {
    const resource = await doctor('real_estate');
    const listing = await post(`${path('real_estate')}/properties`, { reference: 'V-001', title: 'Viewing fixture', city: 'Lahore', area: 'DHA', propertyType: 'house', purpose: 'buy', price: 150000 });
    const lead = await post(`${path('real_estate')}/leads`, { ...contact, qualification });
    const input = { resourceId: resource.id, propertyId: listing.body.data.id, leadId: lead.body.data.lead.id, contact, start: '2030-01-07T04:00:00Z', idempotencyKey: randomUUID() };
    expect((await post(`${path('real_estate')}/appointments`, { ...input, leadId: randomUUID() })).status).toBe(404);
    expect((await post(`${path('real_estate')}/appointments`, { ...input, contact: { ...contact, name: 'Wrong contact' } })).status).toBe(400);
    expect((await post(`${path('real_estate')}/appointments`, input)).body.data.status).toBe('confirmed');
  });
});
