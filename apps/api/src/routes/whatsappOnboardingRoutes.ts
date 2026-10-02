import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { env } from '../config/env';
import { IntegrationService } from '../services/integrationService';
import { prisma } from '../lib/prisma';

export const whatsappOnboardingRouter = Router();
whatsappOnboardingRouter.use(authenticate, requireRole('admin'));

whatsappOnboardingRouter.get('/config', (_req, res) => {
  if (!env.META_APP_ID || !env.META_EMBEDDED_SIGNUP_CONFIG_ID) {
    return res.status(503).json({ success: false, error: { code: 'INTEGRATION_NOT_CONFIGURED', message: 'WhatsApp self-serve setup is not configured yet.' } });
  }
  return res.json({ success: true, data: { appId: env.META_APP_ID, configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID, graphApiVersion: env.META_GRAPH_API_VERSION } });
});

whatsappOnboardingRouter.get('/connection', async (req, res, next) => {
  try {
    const connection = await IntegrationService.getCredential(req.user!.tenantId, 'whatsapp');
    if (!connection) return res.json({ success: true, data: { connected: false } });
    return res.json({ success: true, data: {
      connected: true,
      phoneNumber: typeof connection.displayPhoneNumber === 'string' ? connection.displayPhoneNumber : null,
      verifiedName: typeof connection.verifiedName === 'string' ? connection.verifiedName : null,
      expiresAt: typeof connection.expiresAt === 'string' ? connection.expiresAt : null,
      status: typeof connection.expiresAt === 'string' && Date.parse(connection.expiresAt) < Date.now() + 7 * 86_400_000 ? 'reconnect_soon' : 'ready',
    } });
  } catch (error) { next(error); }
});

whatsappOnboardingRouter.post('/embedded-signup', async (req, res, next) => {
  try {
    const input = z.object({
      code: z.string().min(1).max(4096),
      wabaId: z.string().regex(/^\d{5,30}$/),
      phoneNumberId: z.string().regex(/^\d{5,30}$/),
    }).strict().parse(req.body);
    if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_EMBEDDED_SIGNUP_CONFIG_ID || !process.env.INTEGRATION_ENCRYPTION_KEY || process.env.INTEGRATION_ENCRYPTION_KEY.length < 32) {
      return res.status(503).json({ success: false, error: { code: 'INTEGRATION_NOT_CONFIGURED', message: 'WhatsApp self-serve setup is not configured yet.' } });
    }
    const graph = `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}`;
    const tokenUrl = new URL(`${graph}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, code: input.code }).toString();
    const tokenResponse = await fetch(tokenUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    const tokenBody = await tokenResponse.json().catch(() => null) as any;
    const accessToken = tokenBody?.access_token;
    if (!tokenResponse.ok || typeof accessToken !== 'string' || accessToken.length < 10) {
      return res.status(400).json({ success: false, error: { code: 'WHATSAPP_AUTH_FAILED', message: 'Meta could not authorize this WhatsApp connection. Restart setup and approve access.' } });
    }
    const apiGet = async (path: string) => {
      const url = new URL(`${graph}/${path}`);
      url.searchParams.set('access_token', accessToken);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const body = await response.json().catch(() => null) as any;
      if (!response.ok) throw new Error('WhatsApp account verification failed');
      return body;
    };
    const [waba, numbers] = await Promise.all([
      apiGet(`${input.wabaId}?fields=id,name`),
      apiGet(`${input.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`),
    ]);
    const number = Array.isArray(numbers?.data) ? numbers.data.find((asset: any) => asset?.id === input.phoneNumberId) : null;
    if (waba?.id !== input.wabaId || !number) {
      return res.status(400).json({ success: false, error: { code: 'WHATSAPP_ASSET_MISMATCH', message: 'Meta returned a different WhatsApp account than the one selected. Restart setup.' } });
    }
    const saved = await IntegrationService.getCredential(req.user!.tenantId, 'whatsapp');
    if (saved && saved.phoneNumberId !== input.phoneNumberId) {
      return res.status(409).json({ success: false, error: { code: 'WHATSAPP_NUMBER_ALREADY_CONNECTED', message: 'Disconnect the current WhatsApp number before connecting another.' } });
    }
    const otherWorkspace = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM external_integration_credentials
      WHERE provider = 'whatsapp' AND external_account_id = ${input.phoneNumberId}
        AND tenant_id <> ${req.user!.tenantId} AND is_active = true LIMIT 1`;
    if (otherWorkspace.length) return res.status(409).json({ success: false, error: { code: 'WHATSAPP_NUMBER_IN_USE', message: 'This WhatsApp number is already connected to another workspace.' } });
    const subscribeResponse = await fetch(`${graph}/${input.wabaId}/subscribed_apps`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }),
    });
    if (!subscribeResponse.ok) throw new Error('WhatsApp webhook subscription failed');
    await IntegrationService.storeCredential({
      tenantId: req.user!.tenantId,
      provider: 'whatsapp',
      externalAccountId: input.phoneNumberId,
      userId: req.user!.userId,
      config: {
        accessToken,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: typeof number.display_phone_number === 'string' ? number.display_phone_number : '',
        verifiedName: typeof number.verified_name === 'string' ? number.verified_name : '',
        expiresAt: typeof tokenBody.expires_in === 'number' ? new Date(Date.now() + tokenBody.expires_in * 1000).toISOString() : null,
        connectedAt: new Date().toISOString(),
      },
    });
    return res.json({ success: true, data: { connected: true, phoneNumber: number.display_phone_number ?? null, verifiedName: number.verified_name ?? null, status: 'ready' } });
  } catch (error) { next(error); }
});

whatsappOnboardingRouter.delete('/connection', async (req, res, next) => {
  try {
    const connection = await IntegrationService.getCredential(req.user!.tenantId, 'whatsapp');
    if (typeof connection?.accessToken === 'string' && typeof connection.wabaId === 'string') {
      try {
        await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${connection.wabaId}/subscribed_apps?access_token=${encodeURIComponent(connection.accessToken)}`, {
          method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(10000),
        });
      } catch { /* Remove tenant credentials even when Meta is temporarily unavailable. */ }
    }
    const disconnected = await IntegrationService.deleteCredential(req.user!.tenantId, 'whatsapp', req.user!.userId);
    return res.json({ success: true, data: { disconnected } });
  } catch (error) { next(error); }
});
