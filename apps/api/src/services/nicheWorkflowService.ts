import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ServiceUnavailableError, ValidationError } from '../errors/AppError';
import { getBusinessProfile } from './businessProfileService';
import { availableSlots, dateBounds } from './calendarAvailability';
import { bookingCalendarContext, resourceCalendarBusy, syncAppointmentEvent } from './googleCalendarService';
import { decryptMedicalData, encryptMedicalData } from './medicalDataEncryption';

export const nicheKind = z.enum(['real_estate', 'healthcare']);
export type NicheKind = z.infer<typeof nicheKind>;
const name = z.string().trim().min(2).max(120);
const id = z.string().uuid();
const money = z.number().finite().min(0).max(9999999999999.99).multipleOf(0.01);
const phone = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number, for example +923001234567.');
export const resourceInput = z.object({ name, specialty: z.string().trim().max(120).optional(), calendarId: z.string().min(1).max(1024) }).strict();
export const serviceInput = z.object({ resourceId: id, name, durationMinutes: z.number().int().min(10).max(180) }).strict();
export const propertyInput = z.object({ reference: z.string().trim().min(1).max(50), title: name, city: name, area: name, propertyType: z.enum(['apartment', 'house', 'commercial', 'land']), purpose: z.enum(['buy', 'rent']), price: money, bedrooms: z.number().int().min(0).max(100).nullable().optional() }).strict();
export const qualificationInput = z.object({ purpose: z.enum(['buy', 'rent']).nullable(), city: name.nullable(), area: name.nullable(), propertyType: z.enum(['apartment', 'house', 'commercial', 'land']).nullable(), budget: money.nullable(), timeline: z.enum(['within_month', 'within_quarter', 'later', 'unknown']), funding: z.enum(['ready', 'needs_financing', 'unknown']) }).strict();
export const leadInput = z.object({ name, phone, qualification: qualificationInput }).strict();
export const bookingInput = z.object({ resourceId: id, serviceId: id.optional(), propertyId: id.optional(), leadId: id.optional(), start: z.iso.datetime({ offset: true }), contact: z.object({ name, phone }).strict(), idempotencyKey: id }).strict();
export const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && +value.slice(0, 4) >= 2020 && +value.slice(0, 4) <= 2100; }, 'Choose a valid date.');

function contactKey() {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new ServiceUnavailableError('Integration encryption must be configured before storing appointment contacts.');
  return crypto.createHash('sha256').update(`appointment-contact:${key}`).digest();
}
function encryptContact(value: z.infer<typeof bookingInput>['contact'], tenantId: string, kind: NicheKind) {
  if (kind === 'healthcare') return encryptMedicalData(value, tenantId);
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', contactKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export function decryptAppointmentContact(value: string, tenantId: string) {
  if (value.startsWith('m1.')) return bookingInput.shape.contact.parse(decryptMedicalData(value, tenantId));
  try { const [iv, tag, content] = value.split('.').map(part => Buffer.from(part, 'base64url')); const decipher = crypto.createDecipheriv('aes-256-gcm', contactKey(), iv); decipher.setAuthTag(tag); return bookingInput.shape.contact.parse(JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString())); }
  catch { throw new ServiceUnavailableError('Appointment contact could not be read. Restore the original encryption key.'); }
}
async function lock(tx: Prisma.TransactionClient, tenantId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`; }
async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, operation: string, entityId: string) { await tx.auditLog.create({ data: { tenantId, actorId, actorType: 'user', operation, entityType: 'niche_workflow', entityId } }); }
async function requireProfile(tenantId: string) { const { profile } = await getBusinessProfile(tenantId); if (!profile) throw new ConflictError('Save Business setup before configuring this workflow.'); return profile; }

export function qualifyPropertyLead(input: z.infer<typeof qualificationInput>) {
  const missing: string[] = [];
  if (!input.purpose) missing.push('Are you looking to buy or rent?');
  if (!input.city) missing.push('Which city are you interested in?');
  if (!input.area) missing.push('Which area do you prefer?');
  if (!input.propertyType) missing.push('What type of property do you need?');
  if (!input.budget) missing.push('What is your maximum budget? For rent, give a monthly budget.');
  if (input.timeline === 'unknown') missing.push('When would you like to move or buy?');
  if (input.funding === 'unknown') missing.push('Is your budget ready, or do you need financing?');
  return { complete: missing.length === 0, score: Math.round((7 - missing.length) / 7 * 100), nextQuestions: missing, method: 'rules' as const };
}
async function matchingProperties(tenantId: string, q: z.infer<typeof qualificationInput>, country: string, currency: string) {
  if (!q.budget || !q.city || !q.purpose) return [];
  return prisma.propertyListing.findMany({ where: { tenantId, active: true, country, currency, purpose: q.purpose, city: { equals: q.city, mode: 'insensitive' }, ...(q.area ? { area: { equals: q.area, mode: 'insensitive' as const } } : {}), ...(q.propertyType ? { propertyType: q.propertyType } : {}), price: { lte: q.budget } }, orderBy: { price: 'asc' }, take: 20 });
}

export async function saveNicheLead(tenantId: string, actorId: string, raw: unknown, leadId?: string) {
  const input = leadInput.parse(raw); const profile = await requireProfile(tenantId); const qualification = qualifyPropertyLead(input.qualification);
  const matches = await matchingProperties(tenantId, input.qualification, profile.country, profile.currency);
  const lead = await prisma.$transaction(async tx => {
    await lock(tx, tenantId);
    const existing = leadId ? await tx.lead.findFirst({ where: { id: leadId, tenantId, source: 'real_estate' } }) : null;
    if (leadId && !existing) throw new NotFoundError('Lead not found in this workspace.');
    const data = { firstName: input.name, phone: input.phone, source: 'real_estate', currency: profile.currency, estimatedValue: input.qualification.budget, score: qualification.score, qualificationData: { ...input.qualification, country: profile.country }, status: qualification.complete ? 'qualified' : 'new' };
    const saved = existing ? await tx.lead.update({ where: { id: existing.id }, data }) : await tx.lead.create({ data: { ...data, tenantId } });
    await audit(tx, tenantId, actorId, 'real_estate_lead_qualified', saved.id);
    return saved;
  });
  return { lead, qualification, matches };
}

export async function nicheOverview(tenantId: string, actorId: string, kind: NicheKind) {
  const [profile, resources, services, properties, leads, appointments] = await Promise.all([
    getBusinessProfile(tenantId),
    prisma.bookingResource.findMany({ where: { tenantId, kind }, orderBy: { createdAt: 'desc' }, take: 100 }),
    kind === 'healthcare' ? prisma.clinicService.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
    kind === 'real_estate' ? prisma.propertyListing.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
    kind === 'real_estate' ? prisma.lead.findMany({ where: { tenantId, source: 'real_estate' }, orderBy: { createdAt: 'desc' }, take: 100 }) : [],
    prisma.scheduledAppointment.findMany({ where: { tenantId, kind }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const safeAppointments = appointments.map(({ encryptedContact, requestHash: _hash, idempotencyKey: _key, connectionId: _connection, ...booking }) => ({ ...booking, contact: decryptAppointmentContact(encryptedContact, booking.tenantId) }));
  await audit(prisma, tenantId, actorId, 'niche_records_viewed', kind);
  return { profile: profile.profile, resources, services, properties, leads, appointments: safeAppointments, limit: 100 };
}
export async function createNicheResource(tenantId: string, actorId: string, kind: NicheKind, raw: unknown) {
  const input = resourceInput.parse(raw); await requireProfile(tenantId);
  await bookingCalendarContext(tenantId, input.calendarId);
  return prisma.$transaction(async tx => { await lock(tx, tenantId); const resource = await tx.bookingResource.create({ data: { ...input, tenantId, kind } }); await audit(tx, tenantId, actorId, 'booking_resource_created', resource.id); return resource; });
}
export async function createClinicService(tenantId: string, actorId: string, raw: unknown) {
  const input = serviceInput.parse(raw);
  return prisma.$transaction(async tx => { await lock(tx, tenantId); if (!await tx.bookingResource.findFirst({ where: { tenantId, id: input.resourceId, kind: 'healthcare', active: true } })) throw new NotFoundError('Choose an active doctor in this workspace.'); const service = await tx.clinicService.create({ data: { ...input, tenantId } }); await audit(tx, tenantId, actorId, 'clinic_service_created', service.id); return service; });
}
export async function createProperty(tenantId: string, actorId: string, raw: unknown) {
  const input = propertyInput.parse(raw); const profile = await requireProfile(tenantId);
  return prisma.$transaction(async tx => { await lock(tx, tenantId); if (await tx.propertyListing.findUnique({ where: { tenantId_reference: { tenantId, reference: input.reference } } })) throw new ConflictError('This property reference already exists.'); const property = await tx.propertyListing.create({ data: { ...input, tenantId, country: profile.country, currency: profile.currency } }); await audit(tx, tenantId, actorId, 'property_created', property.id); return property; });
}
export async function setNicheActive(tenantId: string, actorId: string, kind: NicheKind, collection: 'resources' | 'services' | 'properties', recordId: string, active: boolean) {
  return prisma.$transaction(async tx => {
    await lock(tx, tenantId);
    const result = collection === 'resources' ? await tx.bookingResource.updateMany({ where: { tenantId, id: recordId, kind }, data: { active } }) : collection === 'services' && kind === 'healthcare' ? await tx.clinicService.updateMany({ where: { tenantId, id: recordId }, data: { active } }) : collection === 'properties' && kind === 'real_estate' ? await tx.propertyListing.updateMany({ where: { tenantId, id: recordId }, data: { active } }) : { count: 0 };
    if (result.count !== 1) throw new NotFoundError('Record not found in this workspace.'); await audit(tx, tenantId, actorId, active ? 'niche_record_activated' : 'niche_record_archived', recordId); return { updated: true };
  });
}

async function scheduleContext(tenantId: string, kind: NicheKind, resourceId: string, serviceId?: string) {
  const profile = await requireProfile(tenantId);
  const resource = await prisma.bookingResource.findFirst({ where: { tenantId, id: resourceId, kind, active: true } });
  if (!resource) throw new NotFoundError('Choose an active resource in this workspace.');
  const service = serviceId ? await prisma.clinicService.findFirst({ where: { tenantId, id: serviceId, resourceId, active: true } }) : null;
  if (kind === 'healthcare' && !service) throw new ValidationError('Choose an active service for this doctor.');
  if (kind === 'real_estate' && serviceId) throw new ValidationError('Property viewings do not use clinic services.');
  return { profile: { ...profile, slotMinutes: service?.durationMinutes || profile.slotMinutes }, resource };
}
function localDay(start: Date, timezone: string) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(start).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
export async function nicheAvailability(tenantId: string, kind: NicheKind, resourceId: string, date: string, serviceId?: string) {
  dateInput.parse(date);
  const { profile, resource } = await scheduleContext(tenantId, kind, resourceId, serviceId);
  const bounds = dateBounds(date, profile.timezone); const pad = 60 * 60_000;
  const provider = await resourceCalendarBusy(tenantId, resource.calendarId, new Date(bounds.start.getTime() - pad), new Date(bounds.end.getTime() + pad));
  const local = await prisma.scheduledAppointment.findMany({ where: { tenantId, calendarId: resource.calendarId, status: { not: 'cancelled' }, startTime: { lt: new Date(bounds.end.getTime() + pad) }, endTime: { gt: new Date(bounds.start.getTime() - pad) } } });
  const slots = availableSlots(date, profile, provider.busy).filter(slot => !local.some(item => { const buffer = Math.max(profile.bufferMinutes, item.bufferMinutes) * 60_000; return Date.parse(slot.start) < item.endTime.getTime() + buffer && Date.parse(slot.end) > item.startTime.getTime() - buffer; }));
  return { date, timezone: profile.timezone, slotMinutes: profile.slotMinutes, slots, checkedAt: new Date().toISOString(), connectionId: provider.connectionId };
}

export async function createAppointment(tenantId: string, actorId: string, kind: NicheKind, raw: unknown) {
  const input = bookingInput.parse(raw);
  const hash = crypto.createHash('sha256').update(JSON.stringify({ kind, ...input, start: new Date(input.start).toISOString() })).digest('hex');
  const booking = await prisma.$transaction(async tx => {
    await lock(tx, tenantId);
    const existing = await tx.scheduledAppointment.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) { if (existing.requestHash !== hash) throw new ConflictError('This booking request key was already used for different details.'); return existing; }
    const { profile, resource } = await scheduleContext(tenantId, kind, input.resourceId, input.serviceId);
    if (kind === 'healthcare' && (input.propertyId || input.leadId)) throw new ValidationError('Clinic appointments do not use property leads.');
    if (kind === 'real_estate') {
      if (!input.propertyId || !input.leadId) throw new ValidationError('Choose a property and lead for this viewing.');
      const property = await tx.propertyListing.findFirst({ where: { tenantId, id: input.propertyId, active: true } });
      const lead = await tx.lead.findFirst({ where: { tenantId, id: input.leadId, source: 'real_estate' } });
      if (!property || !lead) throw new NotFoundError('The property or lead is not available in this workspace.');
      if (property.country !== profile.country || property.currency !== profile.currency) throw new ConflictError('The property market differs from your current business profile.');
      if (lead.phone !== input.contact.phone || lead.firstName !== input.contact.name) throw new ValidationError('Use the selected lead contact details for this viewing.');
    }
    const authorization = await bookingCalendarContext(tenantId, resource.calendarId);
    const start = new Date(input.start); const date = localDay(start, profile.timezone);
    const availability = await nicheAvailability(tenantId, kind, input.resourceId, date, input.serviceId);
    const slot = availability.slots.find(item => Date.parse(item.start) === start.getTime());
    if (!slot || authorization.connectionId !== availability.connectionId) throw new ConflictError('This time is no longer available. Check availability again.');
    const saved = await tx.scheduledAppointment.create({ data: { tenantId, resourceId: input.resourceId, kind, serviceId: input.serviceId, propertyId: input.propertyId, leadId: input.leadId, startTime: start, endTime: new Date(slot.end), bufferMinutes: profile.bufferMinutes, timezone: profile.timezone, encryptedContact: encryptContact(input.contact, tenantId, kind), calendarId: resource.calendarId, connectionId: authorization.connectionId, eventId: crypto.randomUUID().replace(/-/g, ''), idempotencyKey: input.idempotencyKey, requestHash: hash } });
    await audit(tx, tenantId, actorId, 'appointment_reserved', saved.id); return saved;
  }, { timeout: 60_000, maxWait: 10_000 });
  return syncAppointment(tenantId, actorId, kind, booking.id);
}

export async function syncAppointment(tenantId: string, actorId: string, kind: NicheKind, bookingId: string, cancel = false) {
  if (cancel) await prisma.$transaction(async tx => {
    await lock(tx, tenantId); const found = await tx.scheduledAppointment.findFirst({ where: { id: bookingId, tenantId, kind } });
    if (!found) throw new NotFoundError('Appointment not found.');
    if (found.status !== 'cancelled') { await tx.scheduledAppointment.update({ where: { id: found.id }, data: { status: 'cancel_pending' } }); await audit(tx, tenantId, actorId, 'appointment_cancel_requested', found.id); }
  }, { maxWait: 60_000 });
  return prisma.$transaction(async tx => {
    await lock(tx, tenantId); const booking = await tx.scheduledAppointment.findFirst({ where: { id: bookingId, tenantId, kind } });
    if (!booking) throw new NotFoundError('Appointment not found.');
    if (booking.status === 'cancelled') return { id: booking.id, status: booking.status };
    try {
      const status = await syncAppointmentEvent(booking, booking.status === 'cancel_pending');
      await tx.scheduledAppointment.update({ where: { id: booking.id }, data: { status } });
      await audit(tx, tenantId, actorId, `appointment_${status}`, booking.id);
      return { id: booking.id, status };
    } catch (error) {
      if (!(error instanceof ServiceUnavailableError) && !(error instanceof ConflictError)) throw error;
      // Preserve the reservation after an uncertain provider response. Retry uses its original event ID.
      return { id: booking.id, status: booking.status, message: error.message };
    }
  }, { timeout: 60_000, maxWait: 60_000 });
}
