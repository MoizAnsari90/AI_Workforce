import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const context = vi.hoisted(() => ({ tenantId: '', userId: 'setup-admin', role: 'admin' }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: Request, _res: Response, next: NextFunction) => {
  if (req.headers.authorization !== 'Bearer fixture-session') return next(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
  req.user = { tenantId: context.tenantId, userId: context.userId, role: context.role as 'admin', permissions: [] };
  req.tenantId = context.tenantId; next();
} }));
import { prisma } from '../src/lib/prisma';
import { businessSetupRouter } from '../src/routes/businessSetupRoutes';
import { decryptCalendarTokens, encryptCalendarTokens } from '../src/services/googleCalendarService';

const app = express(); app.use(express.json(), businessSetupRouter);
app.use((error: Error & { statusCode?: number; issues?: unknown }, _req: Request, res: Response, _next: NextFunction) => res.status(error.statusCode || (error.issues ? 400 : 500)).json({ success: false, error: { message: error.message } }));
const original = { ...process.env };
let otherTenant = '';
const profile = { name: 'Calendar fixture', country: 'US', industry: 'real_estate', currency: 'USD', timezone: 'America/New_York', languages: ['en'], primaryLanguage: 'en', slotMinutes: 30, bufferMinutes: 0, workingHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, start: '09:00', end: '11:00' })) };
const scope = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy';
const providerReply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const tokenReply = () => providerReply({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 3600, scope });
async function start() { const response = await request(app).post('/calendar/google/start').set('Authorization', 'Bearer fixture-session'); expect(response.status).toBe(200); return new URL(response.body.data.authorizationUrl); }
async function connect() { const url = await start(); vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => tokenReply())); const response = await request(app).post('/calendar/google/complete').set('Authorization', 'Bearer fixture-session').send({ code: 'fixture-code', state: url.searchParams.get('state') }); expect(response.status).toBe(200); return url; }
beforeAll(async () => {
  context.tenantId = (await prisma.tenant.create({ data: { name: `setup-fixture-${randomUUID()}` } })).id;
  otherTenant = (await prisma.tenant.create({ data: { name: `setup-other-${randomUUID()}` } })).id;
});
beforeEach(async () => {
  context.role = 'admin'; context.userId = 'setup-admin';
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'fixture-client'; process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'fixture-secret'; process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'http://localhost:3000/api/calendar/google/callback';
  await prisma.calendarOAuthState.deleteMany({ where: { tenantId: context.tenantId } });
  await prisma.googleCalendarConnection.deleteMany({ where: { tenantId: context.tenantId } });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { process.env = original; await prisma.tenant.deleteMany({ where: { id: { in: [context.tenantId, otherTenant] } } }); await prisma.$disconnect(); });

describe('Business setup and calendar integration', () => {
  it('saves and reloads an isolated profile, blocks cross-tenant and non-admin writes', async () => {
    const path = `/tenants/${context.tenantId}/business-setup`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).put(path).set('Authorization', 'Bearer fixture-session').send(profile)).status).toBe(200);
    expect((await request(app).get(path).set('Authorization', 'Bearer fixture-session')).body.data.profile).toEqual(profile);
    expect((await request(app).get(`/tenants/${otherTenant}/business-setup`).set('Authorization', 'Bearer fixture-session')).status).toBe(403);
    context.role = 'viewer';
    expect((await request(app).put(path).set('Authorization', 'Bearer fixture-session').send(profile)).status).toBe(403);
    expect((await request(app).post('/calendar/google/start').set('Authorization', 'Bearer fixture-session')).status).toBe(403);
  });
  it('validates profile data without overwriting the existing settings', async () => {
    const path = `/tenants/${context.tenantId}/business-setup`;
    expect((await request(app).put(path).set('Authorization', 'Bearer fixture-session').send({ ...profile, country: 'XX' })).status).toBe(400);
    expect((await request(app).get(path).set('Authorization', 'Bearer fixture-session')).body.data.profile.country).toBe('US');
  });
  it('reports missing configuration without exposing credentials', async () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
    const status = await request(app).get('/calendar/google/connection').set('Authorization', 'Bearer fixture-session');
    expect(status.body.data).toMatchObject({ configured: false, connected: false });
    expect((await request(app).post('/calendar/google/start').set('Authorization', 'Bearer fixture-session')).status).toBe(503);
  });
  it('binds OAuth to PKCE, the session and a single-use expiring state; stores encrypted tokens', async () => {
    const url = await start();
    expect(url.hostname).toBe('accounts.google.com'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline'); expect(url.searchParams.has('client_secret')).toBe(false);
    const fetchMock = vi.fn().mockImplementation(async () => tokenReply()); vi.stubGlobal('fetch', fetchMock);
    const body = { state: url.searchParams.get('state'), code: 'fixture-code' };
    context.userId = 'other-admin';
    expect((await request(app).post('/calendar/google/complete').set('Authorization', 'Bearer fixture-session').send(body)).status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
    context.userId = 'setup-admin';
    expect((await request(app).post('/calendar/google/complete').set('Authorization', 'Bearer fixture-session').send(body)).status).toBe(200);
    const saved = await prisma.googleCalendarConnection.findUniqueOrThrow({ where: { tenantId: context.tenantId } });
    expect(saved.encryptedTokens).not.toContain('private'); expect(decryptCalendarTokens(saved.encryptedTokens).refreshToken).toBe('private-refresh-token');
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('code_verifier')).toBeTruthy();
    expect((await request(app).post('/calendar/google/complete').set('Authorization', 'Bearer fixture-session').send(body)).status).toBe(400);
    const second = await start(); await prisma.calendarOAuthState.updateMany({ where: { tenantId: context.tenantId }, data: { expiresAt: new Date(0) } });
    expect((await request(app).post('/calendar/google/complete').set('Authorization', 'Bearer fixture-session').send({ ...body, state: second.searchParams.get('state') })).status).toBe(400);
  });
  it('rejects missing scopes and refresh tokens without creating a connection', async () => {
    const url = await start(); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(providerReply({ access_token: 'partial', expires_in: 3600, scope })));
    expect((await request(app).post('/calendar/google/complete').set('Authorization', 'Bearer fixture-session').send({ code: 'partial', state: url.searchParams.get('state') })).status).toBe(400);
    expect(await prisma.googleCalendarConnection.findUnique({ where: { tenantId: context.tenantId } })).toBeNull();
  });
  it('paginates calendars, verifies selection and returns availability without tokens or event titles', async () => {
    await connect();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.includes('freeBusy') ? providerReply({ calendars: { 'work@example.test': { busy: [{ start: '2030-01-07T14:00:00Z', end: '2030-01-07T14:30:00Z' }] } } }) : url.includes('pageToken=next') ? providerReply({ items: [{ id: 'work@example.test', summary: 'Work', timeZone: 'America/New_York', accessRole: 'owner' }] }) : providerReply({ items: [], nextPageToken: 'next' })));
    const status = await request(app).get('/calendar/google/connection').set('Authorization', 'Bearer fixture-session');
    expect(status.body.data.calendars).toHaveLength(1); expect(status.text).not.toContain('private-'); expect(status.text).not.toContain('encryptedTokens');
    expect((await request(app).put('/calendar/google/selection').set('Authorization', 'Bearer fixture-session').send({ calendarId: 'unauthorized' })).status).toBe(400);
    expect((await request(app).put('/calendar/google/selection').set('Authorization', 'Bearer fixture-session').send({ calendarId: 'work@example.test' })).status).toBe(200);
    const result = await request(app).get('/calendar/google/availability?date=2030-01-07').set('Authorization', 'Bearer fixture-session');
    expect(result.status).toBe(200); expect(result.body.data.slots).toHaveLength(3); expect(result.body.data.slots[0].start).toBe('2030-01-07T14:30:00.000Z'); expect(result.body.data.readOnly).toBe(true);
    expect((await request(app).get('/calendar/google/availability?date=2030-02-30').set('Authorization', 'Bearer fixture-session')).status).toBe(400);
  });
  it('fails closed when Google returns a per-calendar error', async () => {
    await connect(); await prisma.googleCalendarConnection.update({ where: { tenantId: context.tenantId }, data: { calendarId: 'work' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(providerReply({ calendars: { work: { busy: [], errors: [{ reason: 'notFound' }] } } })));
    const result = await request(app).get('/calendar/google/availability?date=2030-01-07').set('Authorization', 'Bearer fixture-session');
    expect(result.status).toBe(503); expect(result.body.data).toBeUndefined();
  });
  it('refreshes expired tokens and preserves the refresh token when Google omits rotation', async () => {
    await connect(); const connection = await prisma.googleCalendarConnection.findUniqueOrThrow({ where: { tenantId: context.tenantId } });
    await prisma.googleCalendarConnection.update({ where: { tenantId: context.tenantId }, data: { encryptedTokens: encryptCalendarTokens({ ...decryptCalendarTokens(connection.encryptedTokens), expiresAt: 0 }) } });
    const fetchMock = vi.fn().mockImplementation(async (url: string) => url.includes('oauth2') ? providerReply({ access_token: 'renewed', expires_in: 3600 }) : providerReply({ items: [] })); vi.stubGlobal('fetch', fetchMock);
    expect((await request(app).get('/calendar/google/connection').set('Authorization', 'Bearer fixture-session')).status).toBe(200);
    const current = await prisma.googleCalendarConnection.findUniqueOrThrow({ where: { tenantId: context.tenantId } });
    expect(decryptCalendarTokens(current.encryptedTokens)).toMatchObject({ accessToken: 'renewed', refreshToken: 'private-refresh-token' });
  });
  it('does not resurrect a connection disconnected during token refresh', async () => {
    await connect(); const connection = await prisma.googleCalendarConnection.findUniqueOrThrow({ where: { tenantId: context.tenantId } });
    await prisma.googleCalendarConnection.update({ where: { tenantId: context.tenantId }, data: { encryptedTokens: encryptCalendarTokens({ ...decryptCalendarTokens(connection.encryptedTokens), expiresAt: 0 }) } });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => { await prisma.googleCalendarConnection.delete({ where: { tenantId: context.tenantId } }); return providerReply({ access_token: 'renewed', expires_in: 3600 }); }));
    expect((await request(app).get('/calendar/google/connection').set('Authorization', 'Bearer fixture-session')).status).toBe(409);
    expect(await prisma.googleCalendarConnection.findUnique({ where: { tenantId: context.tenantId } })).toBeNull();
  });
  it('cancels outstanding OAuth attempts on disconnect', async () => {
    const url = await start();
    expect((await request(app).delete('/calendar/google/connection').set('Authorization', 'Bearer fixture-session')).status).toBe(200);
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await request(app).post('/calendar/google/complete').set('Authorization', 'Bearer fixture-session').send({ code: 'code', state: url.searchParams.get('state') })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('detects tampered credential ciphertext', () => {
    const encrypted = encryptCalendarTokens({ accessToken: 'a', refreshToken: 'r', scope, expiresAt: 100 });
    const parts = encrypted.split('.'); parts[1] = Buffer.alloc(16).toString('base64url');
    expect(() => decryptCalendarTokens(parts.join('.'))).toThrow('credentials could not be read');
  });
});
