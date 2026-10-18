import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: any, res: any, next: any) => { if (req.headers.authorization !== 'Bearer fixture') return res.sendStatus(401); req.user = { tenantId: 'tenant-a', userId: 'admin', role: 'admin', permissions: [] }; next(); } }));
vi.mock('../src/lib/prisma', () => ({ prisma: { $queryRaw: vi.fn(async () => []), tenant: { findUnique: vi.fn(async () => ({ id: 'tenant-a' })) }, business: { updateMany: vi.fn(async () => ({ count: 1 })) } } }));
vi.mock('../src/services/integrationService', () => ({ IntegrationService: { getCredential: vi.fn(), getWhatsAppCredential: vi.fn(), storeCredential: vi.fn(async () => {}), deleteCredential: vi.fn(async () => true) } }));
vi.mock('../src/services/queueService', () => ({ queueService: { enqueue: vi.fn(async () => {}) } }));
vi.mock('../src/services/nicheAutomationWorker', () => ({ acceptNicheInbound: vi.fn(async () => false) }));
import { IntegrationService } from '../src/services/integrationService';
import { queueService } from '../src/services/queueService';
import { env } from '../src/config/env';
import { whatsappService } from '../src/services/whatsappService';
import { receiveWebhook } from '../src/controllers/webhookController';
import { whatsappOnboardingRouter } from '../src/routes/whatsappOnboardingRoutes';
import { whatsappConnectionState } from '../src/services/whatsappConnectionState';
import { parseWhatsAppSignupEvent, signupWaitingMessage } from '../../web/lib/whatsapp-signup';
import { errorHandler } from '../src/middleware/errorHandler';
const original = env.NODE_ENV;
const app = express();
app.post('/webhook/:tenantId', express.raw({ type: 'application/json' }), receiveWebhook);
app.use(express.json(), whatsappOnboardingRouter);
app.use(errorHandler);
const finish = { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { waba_id: '123456', phone_number_id: '654321' } };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(IntegrationService.getWhatsAppCredential).mockResolvedValue({ phoneNumberId: '654321', accessToken: 'tenant-token' }); });
afterEach(() => { env.NODE_ENV = original; vi.unstubAllGlobals(); });

describe('WhatsApp signup and delivery safety', () => {
  it('identifies which Meta callback is missing without exposing the login code', () => {
    const code = 'private-one-use-code';
    expect(signupWaitingMessage({ code }, true)).toContain('system-user');
    expect(signupWaitingMessage({ code }, true)).not.toContain(code);
    expect(signupWaitingMessage({ wabaId: '123456', phoneNumberId: '654321' }, true)).toContain('did not finish authorization');
    expect(signupWaitingMessage({}, true)).toContain('did not return a completed setup');
  });

  describe('authorization code exchange and account binding', () => {
    let originalAppId: typeof env.META_APP_ID;
    let originalConfigId: typeof env.META_EMBEDDED_SIGNUP_CONFIG_ID;
    beforeEach(() => {
      originalAppId = env.META_APP_ID; originalConfigId = env.META_EMBEDDED_SIGNUP_CONFIG_ID;
      env.META_APP_ID = '123456'; env.META_EMBEDDED_SIGNUP_CONFIG_ID = '654321';
      vi.mocked(IntegrationService.getCredential).mockResolvedValue(null);
    });
    afterEach(() => { env.META_APP_ID = originalAppId; env.META_EMBEDDED_SIGNUP_CONFIG_ID = originalConfigId; });
    const input = { code: 'one-use-code', wabaId: '123456', phoneNumberId: '654321' };
    function graphMock(failure?: 'authorization' | 'assets' | 'subscription' | 'unconfirmed') {
      const fetch = vi.fn(async (url: any) => {
        const path = new URL(String(url)).pathname;
        const stage = path.endsWith('/oauth/access_token') ? 'authorization' : path.endsWith('/subscribed_apps') ? 'subscription' : 'assets';
        if (failure === stage) return new Response(JSON.stringify({ error: { code: 190, message: 'secret-token-and-code' } }), { status: 400 });
        const body = stage === 'authorization' ? { access_token: 'tenant-secret-token', expires_in: 3600 }
          : stage === 'subscription' ? { success: failure !== 'unconfirmed' }
          : path.endsWith('/phone_numbers') ? { data: [{ id: '654321', display_phone_number: '+15551234567', verified_name: 'Test business' }] }
          : { id: '123456', name: 'Test business' };
        return new Response(JSON.stringify(body));
      });
      vi.stubGlobal('fetch', fetch);
      return fetch;
    }
    it('saves a verified account only after Meta confirms the webhook subscription', async () => {
      const fetch = graphMock();
      const response = await request(app).post('/embedded-signup').set('Authorization', 'Bearer fixture').send(input);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ connected: true, deliveryVerified: false });
      expect(JSON.stringify(response.body)).not.toContain('tenant-secret-token');
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(IntegrationService.storeCredential).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', externalAccountId: '654321', config: expect.objectContaining({ wabaId: '123456', phoneNumberId: '654321' }) }));
    });
    it.each(['authorization', 'assets', 'subscription'] as const)('reports a safe actionable %s error without saving credentials', async stage => {
      graphMock(stage);
      const response = await request(app).post('/embedded-signup').set('Authorization', 'Bearer fixture').send(input);
      expect(response.status).toBe(400);
      expect(response.body.error.details).toMatchObject({ stage, providerCode: 190 });
      expect(JSON.stringify(response.body)).not.toContain('secret-token-and-code');
      expect(IntegrationService.storeCredential).not.toHaveBeenCalled();
    });
    it('does not save credentials when Meta returns success:false for webhook subscription', async () => {
      graphMock('unconfirmed');
      const response = await request(app).post('/embedded-signup').set('Authorization', 'Bearer fixture').send(input);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('WHATSAPP_SUBSCRIPTION_UNCONFIRMED');
      expect(IntegrationService.storeCredential).not.toHaveBeenCalled();
    });
    it('reports unavailable Meta without logging or returning credential-bearing URLs', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('https://graph.facebook.com/?client_secret=private'); }));
      const response = await request(app).post('/embedded-signup').set('Authorization', 'Bearer fixture').send(input);
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('WHATSAPP_META_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toContain('client_secret');
      expect(IntegrationService.storeCredential).not.toHaveBeenCalled();
    });
  });
  it('handles both JSON and object completion messages', () => {
    for (const payload of [finish, JSON.stringify(finish)]) expect(parseWhatsAppSignupEvent('https://www.facebook.com', payload)).toEqual({ type: 'finish', wabaId: '123456', phoneNumberId: '654321' });
    expect(parseWhatsAppSignupEvent('https://business.facebook.com', finish)).toEqual({ type: 'finish', wabaId: '123456', phoneNumberId: '654321' });
  });
  it('rejects spoofed origins, malformed JSON and incomplete finish events', () => {
    for (const origin of ['http://www.facebook.com', 'https://facebook.com.evil.test', 'https://evilfacebook.com', 'https://business.facebook.com.evil.test']) expect(parseWhatsAppSignupEvent(origin, finish)).toBeNull();
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', '{')).toBeNull();
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', { ...finish, data: {} })).toEqual({ type: 'error' });
  });
  it('allows cancellation/error recovery and explicitly identifies unsupported finish flows', () => {
    for (const event of ['CANCEL', 'ERROR']) expect(parseWhatsAppSignupEvent('https://web.facebook.com', { ...finish, event })).toEqual({ type: event.toLowerCase() });
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', { ...finish, event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' })).toEqual({ type: 'unsupported' });
  });
  it('accepts v4 completion events and asks the user to finish phone setup when Meta returns only a WABA', () => {
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', { ...finish, version: 4 })).toEqual({ type: 'finish', wabaId: '123456', phoneNumberId: '654321' });
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', { ...finish, event: 'FINISH_ONLY_WABA', data: { waba_id: '123456' }, version: 4 })).toEqual({ type: 'needs_phone_number' });
    expect(parseWhatsAppSignupEvent('https://www.facebook.com', { ...finish, event: 'FINISH', data: { waba_id: '123456' }, version: 4 })).toEqual({ type: 'needs_phone_number' });
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
    vi.mocked(queueService.enqueue).mockRejectedValueOnce(new Error('Durable queue unavailable'));
    expect((await send(['654321'])).status).toBe(503);
    expect((await send(['654321'])).status).toBe(200);
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
