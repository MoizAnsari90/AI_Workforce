import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { env } from '../config/env';
import { IntegrationService } from '../services/integrationService';
import { prisma } from '../lib/prisma';
import { whatsappConnectionState } from '../services/whatsappConnectionState';
import { getWhatsAppSetupTestStatus, hasRecentWhatsAppDeliveryProof, startWhatsAppSetupTest } from '../services/whatsappSetupTestService';
import { AppError } from '../errors/AppError';

// Never forward Meta's raw errors: they may contain authorization URLs or tokens.
async function signupMetaRequest(url: URL | string, options: RequestInit, stage: 'authorization' | 'assets' | 'subscription') {
  const messages = {
    authorization: 'Meta could not exchange the login code. Restart setup; if it repeats, check that the App Secret and signup configuration belong to this Meta app.',
    assets: 'Meta did not grant access to the selected WhatsApp account. Check the signup configuration uses a system-user token, WhatsApp account assets and both WhatsApp permissions.',
    subscription: 'Meta could not subscribe this app to WhatsApp messages. Check WhatsApp business management permission and the app webhook configuration.',
  };
  let response: Response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError(`Meta could not be reached during ${stage}. Refresh connection status before retrying setup.`, 503, 'WHATSAPP_META_UNAVAILABLE', { stage });
  }
  const body = await response.json().catch(() => null) as any;
  if (!response.ok || !body || body.error) {
    throw new AppError(messages[stage], 400, 'WHATSAPP_META_REJECTED', {
      stage,
      ...(typeof body?.error?.code === 'number' ? { providerCode: body.error.code } : {}),
      ...(typeof body?.error?.error_subcode === 'number' ? { providerSubcode: body.error.error_subcode } : {}),
    });
  }
  return body;
}

function signupConfigured() {
  return !!(env.META_APP_ID && env.META_APP_SECRET && env.META_EMBEDDED_SIGNUP_CONFIG_ID && env.META_VERIFY_TOKEN && process.env.INTEGRATION_ENCRYPTION_KEY && process.env.INTEGRATION_ENCRYPTION_KEY.length >= 32);
}

export const whatsappOnboardingRouter = Router();
whatsappOnboardingRouter.use(authenticate, requireRole('admin'));

whatsappOnboardingRouter.get('/config', (_req, res) => {
  if (!signupConfigured()) {
    return res.status(503).json({ success: false, error: { code: 'INTEGRATION_NOT_CONFIGURED', message: 'WhatsApp self-serve setup is not configured yet.' } });
  }
  return res.json({ success: true, data: { appId: env.META_APP_ID, configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID, graphApiVersion: env.META_GRAPH_API_VERSION } });
});

whatsappOnboardingRouter.get('/connection', async (req, res, next) => {
  try {
    const connection = await IntegrationService.getCredential(req.user!.tenantId, 'whatsapp');
    const state = whatsappConnectionState(connection);
    const verificationTest = state.connected ? await getWhatsAppSetupTestStatus(req.user!.tenantId) : null;
    const registration = connection?.cloudRegistration as { status?: string; completedAt?: string } | undefined;
    return res.json({ success: true, data: {
      ...state,
      deliveryVerified: state.connected ? await hasRecentWhatsAppDeliveryProof(req.user!.tenantId) : false,
      registrationStatus: registration?.status ?? 'required',
      registeredAt: registration?.completedAt ?? null,
      verificationTest,
    } });
  } catch (error) { next(error); }
});

whatsappOnboardingRouter.post('/connection/registration', async (req, res, next) => {
  try {
    const input = z.object({
      mode: z.enum(['register', 'already_registered']),
      pin: z.string().regex(/^\d{6}$/).optional(),
      confirmCloudApiNumber: z.literal(true),
    }).strict().superRefine((value, context) => {
      if (value.mode === 'register' && !value.pin) context.addIssue({ code: 'custom', path: ['pin'], message: 'Enter a six-digit two-step verification PIN.' });
      if (value.mode === 'already_registered' && value.pin) context.addIssue({ code: 'custom', path: ['pin'], message: 'A PIN is not needed for a number that is already registered.' });
    }).parse(req.body);
    const connection = await IntegrationService.getCredential(req.user!.tenantId, 'whatsapp');
    if (typeof connection?.accessToken !== 'string' || typeof connection.phoneNumberId !== 'string') {
      return res.status(409).json({ success: false, error: { code: 'WHATSAPP_NOT_CONNECTED', message: 'Connect the WhatsApp number with Meta first.' } });
    }
    let status: 'registered' | 'owner_confirmed' = 'owner_confirmed';
    if (input.mode === 'register') {
      let response: Response;
      try {
        response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${connection.phoneNumberId}/register`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
          headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', pin: input.pin }),
        });
      } catch {
        return res.status(503).json({ success: false, error: { code: 'WHATSAPP_REGISTRATION_UNKNOWN', message: 'Meta did not confirm number registration. Check WhatsApp Manager before trying again.' } });
      }
      const body = await response.json().catch(() => null) as { success?: unknown } | null;
      if (!response.ok || (body?.success !== true && body?.success !== 'true')) {
        return res.status(400).json({ success: false, error: { code: 'WHATSAPP_REGISTRATION_FAILED', message: 'Meta could not register this number. Check its Cloud API status and two-step PIN in WhatsApp Manager.' } });
      }
      status = 'registered';
    }
    const current = await IntegrationService.getCredential(req.user!.tenantId, 'whatsapp');
    if (!current || current.phoneNumberId !== connection.phoneNumberId) {
      return res.status(409).json({ success: false, error: { code: 'WHATSAPP_CONNECTION_CHANGED', message: 'The WhatsApp connection changed. Refresh this page and try again.' } });
    }
    await IntegrationService.storeCredential({ tenantId: req.user!.tenantId, provider: 'whatsapp', userId: req.user!.userId,
      config: { ...current, cloudRegistration: { status, completedAt: new Date().toISOString() } } });
    return res.json({ success: true, data: { status, message: status === 'registered' ? 'Meta confirmed Cloud API registration.' : 'Saved your confirmation. The delivery test will verify that the number can send and receive.' } });
  } catch (error) { next(error); }
});

whatsappOnboardingRouter.post('/connection/test', async (req, res, next) => {
  try {
    z.object({ confirmUseOfTestPhone: z.literal(true) }).strict().parse(req.body);
    const test = await startWhatsAppSetupTest(req.user!.tenantId, req.user!.userId);
    return res.status(201).json({ success: true, data: test });
  } catch (error) { next(error); }
});

whatsappOnboardingRouter.post('/embedded-signup', async (req, res, next) => {
  try {
    const input = z.object({
      code: z.string().min(1).max(4096),
      wabaId: z.string().regex(/^\d{5,30}$/),
      phoneNumberId: z.string().regex(/^\d{5,30}$/),
    }).strict().parse(req.body);
    if (!signupConfigured()) {
      return res.status(503).json({ success: false, error: { code: 'INTEGRATION_NOT_CONFIGURED', message: 'WhatsApp self-serve setup is not configured yet.' } });
    }
    const graph = `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}`;
    const tokenUrl = new URL(`${graph}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, code: input.code }).toString();
    const tokenBody = await signupMetaRequest(tokenUrl, {}, 'authorization');
    const accessToken = tokenBody?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length < 10) {
      return res.status(400).json({ success: false, error: { code: 'WHATSAPP_AUTH_FAILED', message: 'Meta could not authorize this WhatsApp connection. Restart setup and approve access.' } });
    }
    const apiGet = async (path: string) => {
      const url = new URL(`${graph}/${path}`);
      return signupMetaRequest(url, { headers: { Authorization: `Bearer ${accessToken}` } }, 'assets');
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
    const subscription = await signupMetaRequest(`${graph}/${input.wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }),
    }, 'subscription');
    if (subscription.success !== true) throw new AppError('Meta did not confirm WhatsApp webhook subscription. Check app permissions and retry setup.', 400, 'WHATSAPP_SUBSCRIPTION_UNCONFIRMED');
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
    return res.json({ success: true, data: { connected: true, phoneNumber: number.display_phone_number ?? null, verifiedName: number.verified_name ?? null, status: 'verification_required', deliveryVerified: false } });
  } catch (error) { next(error); }
});

whatsappOnboardingRouter.delete('/connection', async (req, res, next) => {
  try {
    // Subscription is WABA-wide. Removing it here would stop other workspace
    // numbers on that WABA. The central webhook ignores disconnected numbers.
    await prisma.business.updateMany({ where: { tenantId: req.user!.tenantId }, data: { supportAccessToken: null, supportPhoneNumberId: null } });
    const disconnected = await IntegrationService.deleteCredential(req.user!.tenantId, 'whatsapp', req.user!.userId);
    return res.json({ success: true, data: { disconnected } });
  } catch (error) { next(error); }
});
