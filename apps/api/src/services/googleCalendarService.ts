import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ConflictError, ServiceUnavailableError, ValidationError } from '../errors/AppError';
import { getBusinessProfile } from './businessProfileService';
import { availableSlots, dateBounds } from './calendarAvailability';

const scopes = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.freebusy'];
const bookingScope = 'https://www.googleapis.com/auth/calendar.events';
const tokenSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number(), scope: z.string() });
const providerTokens = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number().positive(), scope: z.string().optional() });
const calendarSchema = z.object({ id: z.string().min(1), summary: z.string().optional(), timeZone: z.string().optional(), accessRole: z.string(), primary: z.boolean().optional(), deleted: z.boolean().optional() });
const calendarListSchema = z.object({ items: z.array(calendarSchema).optional(), nextPageToken: z.string().optional() });
type Tokens = z.infer<typeof tokenSchema>;

function configuration() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri || !process.env.INTEGRATION_ENCRYPTION_KEY || process.env.INTEGRATION_ENCRYPTION_KEY.length < 32) throw new ServiceUnavailableError('Google Calendar setup is not enabled. Ask your platform administrator to configure it.');
  const url = new URL(redirectUri);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && url.hostname === 'localhost')) throw new ServiceUnavailableError('Google Calendar redirect URL must use HTTPS.');
  return { clientId, clientSecret, redirectUri };
}
export function calendarConfigured() { try { configuration(); return true; } catch { return false; } }
function encryptionKey() {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key || key.length < 32) throw new ServiceUnavailableError('Integration encryption is not configured.');
  return crypto.createHash('sha256').update(key).digest();
}
export function encryptCalendarTokens(tokens: Tokens) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), content].map(value => value.toString('base64url')).join('.');
}
export function decryptCalendarTokens(value: string): Tokens {
  try {
    const [iv, tag, content] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return tokenSchema.parse(JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8')));
  } catch { throw new ServiceUnavailableError('Calendar credentials could not be read. Reconnect your calendar.'); }
}

async function tokenRequest(body: URLSearchParams) {
  let response: Response;
  try { response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body, signal: AbortSignal.timeout(15_000), redirect: 'error' }); }
  catch { throw new ServiceUnavailableError('Google did not respond. Please retry the calendar connection.'); }
  if (!response.ok) throw new ServiceUnavailableError(response.status === 400 || response.status === 401 ? 'Google authorization expired or was declined. Reconnect your calendar.' : 'Google Calendar is temporarily unavailable.');
  const parsed = providerTokens.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new ServiceUnavailableError('Google returned an incomplete authorization response.');
  return parsed.data;
}

export async function startCalendarConnection(tenantId: string, userId: string) {
  const config = configuration();
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(48).toString('base64url');
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  await prisma.$transaction(async tx => {
    await tx.calendarOAuthState.deleteMany({ where: { OR: [{ tenantId, userId }, { expiresAt: { lt: new Date() } }] } });
    await tx.calendarOAuthState.create({ data: { stateHash, tenantId, userId, codeVerifier, expiresAt: new Date(Date.now() + 600_000) } });
  });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: [...scopes, bookingScope].join(' '), access_type: 'offline', prompt: 'consent', state, code_challenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { authorizationUrl: url.toString() };
}

export async function finishCalendarConnection(tenantId: string, userId: string, state: string, code: string) {
  const config = configuration();
  const stateHash = crypto.createHash('sha256').update(state).digest('hex');
  const pending = await prisma.calendarOAuthState.findFirst({ where: { stateHash, tenantId, userId, expiresAt: { gt: new Date() } } });
  if (!pending) throw new ValidationError('Calendar connection request expired or belongs to another session. Start again.');
  const token = await tokenRequest(new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code, code_verifier: pending.codeVerifier }));
  if (!token.refresh_token || !scopes.every(scope => token.scope?.split(' ').includes(scope))) throw new ValidationError('Approve both calendar permissions to connect. Please try again.');
  const encryptedTokens = encryptCalendarTokens({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, scope: token.scope! });
  await prisma.$transaction(async tx => {
    // Serialize final connection changes against disconnect; a cancelled attempt cannot reconnect later.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
    const claimed = await tx.calendarOAuthState.deleteMany({ where: { stateHash, tenantId, userId, expiresAt: { gt: new Date() } } });
    if (claimed.count !== 1) throw new ConflictError('Calendar connection was already used or cancelled. Start again.');
    const data = { connectionId: crypto.randomUUID(), encryptedTokens, calendarId: null, calendarName: null, calendarTimezone: null, connectedAt: new Date() };
    await tx.googleCalendarConnection.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    await tx.auditLog.create({ data: { tenantId, actorType: 'user', actorId: userId, operation: 'google_calendar_connected', entityType: 'integration', entityId: tenantId } });
  });
  return { connected: true };
}

async function connectionWithToken(tenantId: string) {
  const connection = await prisma.googleCalendarConnection.findUnique({ where: { tenantId } });
  if (!connection) throw new ConflictError('Connect Google Calendar first.');
  let tokens = decryptCalendarTokens(connection.encryptedTokens);
  if (tokens.expiresAt < Date.now() + 60_000) {
    const config = configuration();
    const refreshed = await tokenRequest(new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: tokens.refreshToken }));
    tokens = { ...tokens, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token || tokens.refreshToken, expiresAt: Date.now() + refreshed.expires_in * 1000 };
    const changed = await prisma.googleCalendarConnection.updateMany({ where: { tenantId, connectionId: connection.connectionId, encryptedTokens: connection.encryptedTokens }, data: { encryptedTokens: encryptCalendarTokens(tokens) } });
    if (changed.count !== 1) {
      const current = await prisma.googleCalendarConnection.findUnique({ where: { tenantId } });
      if (!current || current.connectionId !== connection.connectionId) throw new ConflictError('Calendar connection changed. Reload and retry.');
      tokens = decryptCalendarTokens(current.encryptedTokens);
    }
  }
  return { connection, tokens };
}

async function calendarRequest(path: string, accessToken: string, body?: unknown) {
  let response: Response;
  try { response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new ServiceUnavailableError('Google Calendar did not respond. Please retry.'); }
  if (!response.ok) throw new ServiceUnavailableError(response.status === 401 || response.status === 403 ? 'Google Calendar access could not be verified. Reconnect and approve the requested permissions.' : 'Google Calendar is temporarily unavailable.');
  return response.json();
}

export async function listGoogleCalendars(tenantId: string) {
  const { tokens, connection } = await connectionWithToken(tenantId);
  const calendars: z.infer<typeof calendarSchema>[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ maxResults: '250', ...(pageToken ? { pageToken } : {}) });
    const result = calendarListSchema.safeParse(await calendarRequest(`users/me/calendarList?${params}`, tokens.accessToken));
    if (!result.success) throw new ServiceUnavailableError('Google returned an invalid calendar list.');
    calendars.push(...(result.data.items || []).filter(item => !item.deleted));
    pageToken = result.data.nextPageToken;
    if (!pageToken) return { connection, calendars: calendars.map(item => ({ id: item.id, name: item.summary || 'Calendar', timezone: item.timeZone || null, accessRole: item.accessRole, primary: item.primary === true })) };
  }
  throw new ServiceUnavailableError('Too many calendars to load. Reduce the subscribed calendar list and retry.');
}

export async function getCalendarStatus(tenantId: string) {
  const stored = await prisma.googleCalendarConnection.findUnique({ where: { tenantId } });
  if (!stored) return { configured: calendarConfigured(), connected: false, calendars: [] };
  const { calendars, connection } = await listGoogleCalendars(tenantId);
  const selected = calendars.find(item => item.id === connection.calendarId) || null;
  const canBook = decryptCalendarTokens(connection.encryptedTokens).scope.split(' ').includes(bookingScope);
  return { configured: calendarConfigured(), connected: true, calendars, selected, canBook, readOnly: !canBook, checkedAt: new Date().toISOString() };
}

export async function selectGoogleCalendar(tenantId: string, calendarId: string) {
  const { calendars, connection } = await listGoogleCalendars(tenantId);
  const selected = calendars.find(item => item.id === calendarId);
  if (!selected) throw new ValidationError('Select a calendar available to the connected account.');
  const updated = await prisma.googleCalendarConnection.updateMany({ where: { tenantId, connectionId: connection.connectionId }, data: { calendarId: selected.id, calendarName: selected.name, calendarTimezone: selected.timezone } });
  if (updated.count !== 1) throw new ConflictError('Calendar connection changed. Reload and retry.');
  return { selected };
}

export async function checkCalendarAvailability(tenantId: string, date: string) {
  const { profile } = await getBusinessProfile(tenantId);
  if (!profile) throw new ConflictError('Save your business setup and working hours first.');
  const { tokens, connection } = await connectionWithToken(tenantId);
  if (!connection.calendarId) throw new ConflictError('Select a calendar first.');
  const bounds = dateBounds(date, profile.timezone);
  // Include neighbouring busy events so buffer time also applies across midnight.
  const padding = profile.bufferMinutes * 60_000;
  const raw = await calendarRequest('freeBusy', tokens.accessToken, { timeMin: new Date(bounds.start.getTime() - padding).toISOString(), timeMax: new Date(bounds.end.getTime() + padding).toISOString(), timeZone: profile.timezone, items: [{ id: connection.calendarId }] });
  const result = z.object({ calendars: z.record(z.string(), z.object({ busy: z.array(z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) })), errors: z.array(z.unknown()).optional() })) }).safeParse(raw);
  const calendar = result.success ? result.data.calendars[connection.calendarId] : undefined;
  if (!calendar || calendar.errors?.length || calendar.busy.some(item => Date.parse(item.end) <= Date.parse(item.start))) throw new ServiceUnavailableError('Calendar availability could not be verified. No slots have been offered.');
  const current = await prisma.googleCalendarConnection.findUnique({ where: { tenantId } });
  if (!current || current.connectionId !== connection.connectionId || current.calendarId !== connection.calendarId) throw new ConflictError('Calendar selection changed. Check availability again.');
  return { date, timezone: profile.timezone, calendarName: connection.calendarName, slotMinutes: profile.slotMinutes, slots: availableSlots(date, profile, calendar.busy), checkedAt: new Date().toISOString(), readOnly: true };
}

export async function disconnectGoogleCalendar(tenantId: string, userId: string) {
  // Local disconnect is deterministic even if Google is unavailable. Revocation is available in Google Account permissions.
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
    await tx.calendarOAuthState.deleteMany({ where: { tenantId } });
    await tx.googleCalendarConnection.deleteMany({ where: { tenantId } });
    await tx.auditLog.create({ data: { tenantId, actorType: 'user', actorId: userId, operation: 'google_calendar_disconnected', entityType: 'integration', entityId: tenantId } });
  });
  return { disconnected: true };
}

/** Calendar identifiers come from a workspace resource, never an arbitrary public URL. */
export async function bookingCalendarContext(tenantId: string, calendarId: string) {
  const { calendars, connection } = await listGoogleCalendars(tenantId);
  if (!calendars.some(item => item.id === calendarId && ['owner', 'writer'].includes(item.accessRole))) throw new ConflictError('This resource needs a writable calendar. Reconnect Google or choose another calendar.');
  const { tokens, connection: current } = await connectionWithToken(tenantId);
  if (current.connectionId !== connection.connectionId) throw new ConflictError('Google connection changed. Reload and retry.');
  if (!tokens.scope.split(' ').includes(bookingScope)) throw new ConflictError('Reconnect Google and allow appointment creation before booking.');
  return { connectionId: connection.connectionId };
}

export async function resourceCalendarBusy(tenantId: string, calendarId: string, start: Date, end: Date) {
  const { tokens, connection } = await connectionWithToken(tenantId);
  const result = z.object({ calendars: z.record(z.string(), z.object({ busy: z.array(z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) })), errors: z.array(z.unknown()).optional() })) }).safeParse(await calendarRequest('freeBusy', tokens.accessToken, { timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: calendarId }] }));
  const calendar = result.success ? result.data.calendars[calendarId] : undefined;
  if (!calendar || calendar.errors?.length || calendar.busy.some(item => Date.parse(item.end) <= Date.parse(item.start))) throw new ServiceUnavailableError('Calendar availability could not be verified. Retry before booking.');
  return { busy: calendar.busy, connectionId: connection.connectionId };
}

type AppointmentEvent = { id: string; tenantId: string; connectionId: string; calendarId: string; eventId: string; startTime: Date; endTime: Date; timezone: string };
const eventSchema = z.object({ id: z.string(), status: z.string().optional(), start: z.object({ dateTime: z.string() }).optional(), end: z.object({ dateTime: z.string() }).optional(), extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional() });
export async function syncAppointmentEvent(booking: AppointmentEvent, cancel = false) {
  const { tokens, connection } = await connectionWithToken(booking.tenantId);
  if (!tokens.scope.split(' ').includes(bookingScope)) throw new ConflictError('Reconnect Google with appointment permissions.');
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(booking.calendarId)}/events`;
  const perform = async (url: string, method: string, body?: unknown) => {
    try { return await fetch(url, { method, headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12_000), redirect: 'error' }); }
    catch { throw new ServiceUnavailableError('Google confirmation is pending. Retry this appointment; do not create a second booking.'); }
  };
  const inspect = async (response: Response) => {
    if (!response.ok) throw new ServiceUnavailableError('Google could not verify the appointment. Retry sync after checking calendar access.');
    const parsed = eventSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || parsed.data.id !== booking.eventId) throw new ServiceUnavailableError('Google returned an invalid appointment response.');
    const event = parsed.data;
    if (event.status === 'cancelled') return 'cancelled' as const;
    if (event.extendedProperties?.private?.workforceBooking !== booking.id || Date.parse(event.start?.dateTime || '') !== booking.startTime.getTime() || Date.parse(event.end?.dateTime || '') !== booking.endTime.getTime()) return 'review_required' as const;
    return 'confirmed' as const;
  };
  let response = await perform(`${base}/${booking.eventId}`, 'GET');
  if (response.status === 410) return 'cancelled' as const;
  if (response.status === 404) {
    if (connection.connectionId !== booking.connectionId) throw new ConflictError('This appointment is not visible after reconnecting Google. Restore access to its original calendar and review it before retrying.');
    // Deterministic provider ID makes a lost response retryable. No patient/contact data leaves the app.
    response = await perform(base, 'POST', { id: booking.eventId, summary: 'Reserved appointment', visibility: 'private', transparency: 'opaque', start: { dateTime: booking.startTime.toISOString(), timeZone: booking.timezone }, end: { dateTime: booking.endTime.toISOString(), timeZone: booking.timezone }, extendedProperties: { private: { workforceBooking: booking.id } }, reminders: { useDefault: false } });
    if (response.status === 409) response = await perform(`${base}/${booking.eventId}`, 'GET');
  }
  const status = await inspect(response);
  if (status !== 'confirmed' || !cancel) return status;
  // Establishing the deterministic event before deletion avoids releasing an uncertain timed-out insert.
  const deleted = await perform(`${base}/${booking.eventId}`, 'DELETE');
  if (deleted.status === 204 || deleted.status === 410) return 'cancelled' as const;
  throw new ServiceUnavailableError('Cancellation is pending Google confirmation. Retry cancellation.');
}
