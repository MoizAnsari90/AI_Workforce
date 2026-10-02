import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env';
import { authenticate } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { IntegrationService } from '../services/integrationService';
import { resolveUserContext } from '../services/authService';
import { validateWooCommerceUrl, WooCommerceClient, woocommerceCredentialSchema } from '../services/woocommerceClient';

export const woocommerceRouter = Router();

woocommerceRouter.get('/oauth/start', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const webAppUrl = process.env.WEB_APP_URL;
    if (!env.WOOCOMMERCE_CALLBACK_URL || !webAppUrl) {
      return res.status(503).json({ success: false, error: { code: 'INTEGRATION_NOT_CONFIGURED', message: 'WooCommerce self-serve setup is not configured yet.' } });
    }
    const parsed = z.object({ storeUrl: z.string().url() }).strict().safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: { code: 'INVALID_STORE_URL', message: 'Enter your store HTTPS address.' } });
    const storeUrl = validateWooCommerceUrl(parsed.data.storeUrl);
    const normalizedStoreUrl = storeUrl.origin + storeUrl.pathname;
    const shopify = await IntegrationService.getCredential(req.user!.tenantId, 'shopify');
    if (shopify) return res.status(409).json({ success: false, error: { code: 'OTHER_COMMERCE_STORE_CONNECTED', message: 'This workspace already has Shopify connected. Disconnect it before selecting WooCommerce.' } });
    const existing = await IntegrationService.getCredential(req.user!.tenantId, 'woocommerce');
    if (existing && existing.storeUrl !== normalizedStoreUrl) {
      return res.status(409).json({ success: false, error: { code: 'STORE_ALREADY_CONNECTED', message: 'Disconnect the current WooCommerce store before connecting a different one.' } });
    }
    const wooUserId = randomInt(1, 2_000_000_000);
    const state = jwt.sign({ purpose: 'woocommerce_oauth', tenantId: req.user!.tenantId, userId: req.user!.userId, wooUserId, storeUrl: normalizedStoreUrl }, env.JWT_SECRET, { expiresIn: '10m' });
    const callbackUrl = new URL(env.WOOCOMMERCE_CALLBACK_URL);
    callbackUrl.searchParams.set('state', state);
    const returnUrl = new URL('/dashboard/integrations?woocommerce=connected', webAppUrl);
    const authorization = new URL(`${storeUrl.toString().replace(/\/$/, '')}/wp-json/wc-auth/v1/authorize`);
    authorization.search = new URLSearchParams({
      app_name: 'AI Workforce', scope: 'read', user_id: String(wooUserId),
      return_url: returnUrl.toString(), callback_url: callbackUrl.toString(),
    }).toString();
    return res.json({ success: true, data: { authorizationUrl: authorization.toString() } });
  } catch (error) { next(error); }
});

// WooCommerce posts generated REST keys here after the store owner approves.
woocommerceRouter.post('/oauth/callback', async (req, res) => {
  try {
    const stateToken = typeof req.query.state === 'string' ? req.query.state : '';
    const state = jwt.verify(stateToken, env.JWT_SECRET) as jwt.JwtPayload;
    if (state.purpose !== 'woocommerce_oauth' || typeof state.tenantId !== 'string' || typeof state.userId !== 'string' || typeof state.storeUrl !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid WooCommerce authorization state' });
    }
    const user = await resolveUserContext(state.userId);
    if (user.tenantId !== state.tenantId || user.role !== 'admin') return res.status(403).json({ success: false, error: 'Workspace authorization expired' });
    const body = z.object({
      consumer_key: z.string().min(8), consumer_secret: z.string().min(8),
      key_permissions: z.enum(['read', 'write', 'read_write']).optional(),
      user_id: z.union([z.string(), z.number()]).optional(),
    }).passthrough().safeParse(req.body);
    if (!body.success || (body.data.key_permissions && !['read', 'read_write'].includes(body.data.key_permissions))) {
      return res.status(400).json({ success: false, error: 'WooCommerce did not return a read-enabled API key' });
    }
    if (body.data.user_id !== undefined && String(body.data.user_id) !== String(state.wooUserId)) {
      return res.status(403).json({ success: false, error: 'WooCommerce authorization user did not match the request' });
    }
    const candidate = woocommerceCredentialSchema.parse({ storeUrl: state.storeUrl, consumerKey: body.data.consumer_key, consumerSecret: body.data.consumer_secret });
    const client = new WooCommerceClient(candidate);
    const verified = await client.verify();
    await IntegrationService.storeCredential({
      tenantId: state.tenantId, provider: 'woocommerce', externalAccountId: new URL(state.storeUrl).host,
      userId: state.userId,
      config: { ...candidate, storeName: new URL(state.storeUrl).hostname, connectedAt: new Date().toISOString() },
    });
    return res.status(200).json({ success: true });
  } catch {
    return res.status(400).json({ success: false, error: 'WooCommerce connection could not be verified. Retry from AI Workforce and check store API access.' });
  }
});

woocommerceRouter.use(authenticate, requireRole('admin'));
woocommerceRouter.get('/connection', async (req, res, next) => {
  try {
    const stored = await IntegrationService.getCredential(req.user!.tenantId, 'woocommerce');
    if (!stored) return res.json({ success: true, data: { connected: false } });
    const parsed = woocommerceCredentialSchema.safeParse(stored);
    if (!parsed.success) return res.json({ success: true, data: { connected: false, needsReconnect: true } });
    const verified = await new WooCommerceClient(parsed.data).verify();
    return res.json({ success: true, data: { connected: true, storeUrl: verified.storeUrl, sampleProduct: verified.sampleProduct } });
  } catch (error) { next(error); }
});

woocommerceRouter.delete('/connection', async (req, res, next) => {
  try {
    const disconnected = await IntegrationService.deleteCredential(req.user!.tenantId, 'woocommerce', req.user!.userId);
    return res.json({ success: true, data: { disconnected } });
  } catch (error) { next(error); }
});
