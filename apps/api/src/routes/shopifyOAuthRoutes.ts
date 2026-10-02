import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware';
import { requireRole } from '../middleware/rbacMiddleware';
import { env } from '../config/env';
import { IntegrationService } from '../services/integrationService';
import { resolveUserContext } from '../services/authService';
import { ShopifyClient } from '../services/shopifyClient';
import { createShopifyInstallUrl, exchangeShopifyAuthorizationCode, verifyShopifyCallbackHmac } from '../services/shopifyAuth';

export const shopifyOAuthRouter = Router();

shopifyOAuthRouter.get('/start', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { shop } = z.object({ shop: z.string().trim().toLowerCase() }).strict().parse(req.query);
    const otherCommerce = await IntegrationService.getCredential(req.user!.tenantId, 'woocommerce');
    if (otherCommerce) {
      return res.status(409).json({ success: false, error: { message: 'This workspace already has WooCommerce connected. Disconnect it before selecting Shopify.' } });
    }
    const connected = await IntegrationService.getCredential(req.user!.tenantId, 'shopify');
    if (connected && connected.shop !== shop) {
      return res.status(409).json({ success: false, error: { message: 'This workspace already has a different Shopify store connected. Disconnect it before connecting another store.' } });
    }
    const state = jwt.sign({ purpose: 'shopify_oauth', nonce: crypto.randomBytes(32).toString('hex'),
      tenantId: req.user!.tenantId, userId: req.user!.userId, shop }, env.JWT_SECRET, { expiresIn: '10m' });
    const authorizationUrl = createShopifyInstallUrl(shop, state);
    res.json({ success: true, data: { authorizationUrl } });
  } catch (error) { next(error); }
});

shopifyOAuthRouter.get('/callback', async (req, res) => {
  const appUrl = process.env.WEB_APP_URL || 'http://localhost:3000';
  const finish = (result: string) => res.redirect(`${appUrl.replace(/\/$/, '')}/dashboard/integrations?shopify=${encodeURIComponent(result)}`);
  try {
    if (!verifyShopifyCallbackHmac(req.query as Record<string, unknown>)) return finish('invalid_callback');
    const parsed = z.object({ shop: z.string(), code: z.string().min(1), state: z.string().min(1) }).safeParse(req.query);
    if (!parsed.success) return finish('invalid_callback');
    let state: jwt.JwtPayload;
    try { state = jwt.verify(parsed.data.state, env.JWT_SECRET) as jwt.JwtPayload; }
    catch { return finish('expired_or_mismatched_state'); }
    if (state.purpose !== 'shopify_oauth' || typeof state.tenantId !== 'string' || typeof state.userId !== 'string' ||
        typeof state.shop !== 'string' || typeof state.nonce !== 'string' || state.shop !== parsed.data.shop.toLowerCase()) {
      return finish('expired_or_mismatched_state');
    }
    // The signed, short-lived state binds this callback to the initiating tenant; Shopify's code is one-use.
    const userContext = await resolveUserContext(state.userId);
    if (userContext.tenantId !== state.tenantId || userContext.role !== 'admin') return finish('expired_or_mismatched_state');
    const credentials = await exchangeShopifyAuthorizationCode(state.shop, parsed.data.code);
    const client = new ShopifyClient({ shop: state.shop, ...credentials, allowWrites: false });
    const connection = await client.verifyConnection();
    const scopes = connection.currentAppInstallation.accessScopes.map(scope => scope.handle);
    if (!scopes.includes('read_inventory')) throw new Error('Shopify app must request read_inventory access');
    const existing = await IntegrationService.getCredential(state.tenantId, 'shopify');
    if (existing && existing.shop !== state.shop) return finish('store_already_connected');
    await IntegrationService.storeCredential({
      tenantId: state.tenantId, provider: 'shopify',
      config: { shop: state.shop, ...credentials, allowWrites: false }, userId: state.userId,
    });
    return finish('connected');
  } catch (error) {
    return finish(error instanceof Error && error.message.includes('write_orders') ? 'missing_permissions' : 'connection_failed');
  }
});
