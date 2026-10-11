import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: any, res: any, next: any) => { if (req.headers.authorization !== 'Bearer fixture') return res.sendStatus(401); req.user = { tenantId: 'tenant-a', userId: 'admin', role: 'admin', permissions: [] }; next(); } }));
vi.mock('../src/lib/prisma', () => ({ prisma: { tenant: { findUnique: vi.fn(async () => ({ id: 'tenant-a' })) }, business: { updateMany: vi.fn(async () => ({ count: 1 })) } } }));
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: vi.fn(), getWhatsAppCredential: vi.fn(), deleteCredential: vi.fn(async () => true) } }));
vi.mock('../src/services/queueService', () => ({ queueService: { enqueue: vi.fn(async () => {}) } }));
vi.mock('../src/services/nicheAutomationWorker', () => ({ acceptNicheInbound: vi.fn(async () => false) }));
import { IntegrationService } from '../src/services/integrationService';
import { queueService } from '../src/services/queueService';
import { env } from '../src/config/env';
import { whatsappService } from '../src/services/whatsappService';
import { receiveWebhook } from '../src/controllers/webhookController';
import { whatsappOnboardingRouter } from '../src/routes/whatsappOnboardingRoutes';
import { whatsappConnectionState } from '../src/services/whatsappConnectionState';
import { parseWhatsAppSignupEvent } from '../../web/lib/whatsapp-signup';
const original = env.NODE_ENV;
const app = express();
app.post('/webhook/:tenantId', express.raw({ type: 'application/json' }), receiveWebhook);
app.use(express.json(), whatsappOnboardingRouter);
const finish = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '123456', phone_number_id: '654321' } };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(IntegrationService.getWhatsAppCredential).mockResolvedValue({ phoneNumberId: '654321', accessToken: 'tenant-token' }); });
afterEach(() => { env.NODE_ENV = original; vi.unstubAllGlobals(); });

describe('WhatsApp signup and delivery safety', () => {
  it('handles both JSON and object completion messages', () => {
    for (const payload of [finish, JSON.stringify(finish)]) expect(parseWhatsAppSignupEvent('https://www.facebook.com', payload)).toEqual({ type: 'finish', wabaId: '123456', phoneNumberId: '654321' });
  });
  it('rejects spoofed origins, malformed JSON and incomplete finish events', () => {
    for (const origin of ['http://www.facebook.com', 'https://facebook.com.evil.test', 'https://evilfacebook.com']) expect(parseWhatsAppSignupEvent(origin, finish)).toBeNull();
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', '{')).toBeNull();
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', { ...finish, data: {} })).toEqual({ type: 'error' });
  });
  it('allows cancellation/error recovery and explicitly identifies unsupported finish flows', () => {
    for (const event of ['CANCEL', 'ERROR']) expect(parseWhatsAppSignupEvent('https://web.facebook.com', { ...finish, event })).toEqual({ type: event.toLowerCase() });
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', { ...finish, event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' })).toEqual({ type: 'unsupported' });
  });
  it('never represents a stored token as verified message delivery or exposes its secret', () => {
    const result = whatsappConnectionState({ accessToken: 'private-value', wabaId: '123456', phoneNumberId: '654321' });
    expect(result).toMatchObject({ connected: true, status: 'verification_required', deliveryVerified: false });
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(whatsappConnectionState({ expiresAt: 'invalid' }).status).toBe('reconnect_required');
    expect(whatsappConnectionState({ expiresAt: new Date(0).toISOString() }).status).toBe('reconnect_required');
    expect(whatsappConnectionState(null).connected).toBe(false);
  });
  it('requires authentication for connection status', async () => {
    expect((await request(app).get('/connection')).status).toBe(401);
  });
  it('disconnects locally without unsubscribing other phone numbers on the shared WABA', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await request(app).delete('/connection').set('Authorization', 'Bearer fixture')).status).toBe(200);
    expect(IntegrationService.deleteCredential).toHaveBeenCalledWith('tenant-a', 'whatsapp', 'admin');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('binds signed legacy webhook batches to the tenant number before enqueueing anything', async () => {
    const message = (phone: string) => ({ value: { metadata: { phone_number_id: phone }, messages: [{ id: 'message-fixture', from: '923001234567', type: 'text', text: { body: 'Hello' } }] } });
    async function send(numbers: string[]) {
      const body = JSON.stringify({ entry: [{ changes: numbers.map(message) }] });
      const signature = 'sha256=' + crypto.createHmac('sha256', env.META_APP_SECRET!).update(body).digest('hex');
      return request(app).post('/webhook/tenant-a').set('Content-Type', 'application/json').set('x-hub-signature-256', signature).send(body);
    }
    expect((await send(['654321', '999999'])).status).toBe(403);
    expect(queueService.enqueue).not.toHaveBeenCalled();
    expect((await send(['654321'])).status).toBe(200);
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });
  it('does not invent a live message ID or silently use platform demo credentials', async () => {
    env.NODE_ENV = 'development';
    const fetch = vi.fn(async () => new Response('{}', { status: 200 })); vi.stubGlobal('fetch', fetch);
    await expect(whatsappService.sendMessage('tenant-a', '923001234567', 'Test')).rejects.toThrow('acceptance is unknown');
    vi.mocked(IntegrationService.getWhatsAppCredential).mockResolvedValue({}); fetch.mockClear();
    await expect(whatsappService.sendMessage('tenant-a', '923001234567', 'Test')).rejects.toThrow('no connected');
    expect(fetch).not.toHaveBeenCalled();
  });
});
