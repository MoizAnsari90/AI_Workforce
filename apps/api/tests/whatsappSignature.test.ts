import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { whatsappService } from '../src/services/whatsappService';

const originalNodeEnv = env.NODE_ENV;

afterEach(() => {
  env.NODE_ENV = originalNodeEnv;
});

describe('WhatsApp webhook signature verification', () => {
  it('requires valid Meta signatures outside automated tests, including development', () => {
    env.NODE_ENV = 'development';
    const rawBody = JSON.stringify({ object: 'whatsapp_business_account' });
    const validSignature = `sha256=${crypto.createHmac('sha256', env.META_APP_SECRET!).update(rawBody).digest('hex')}`;

    expect(whatsappService.verifySignature(rawBody)).toBe(false);
    expect(whatsappService.verifySignature(rawBody, 'sha256=invalid')).toBe(false);
    expect(whatsappService.verifySignature(rawBody, validSignature)).toBe(true);
  });

  it('allows unsigned test fixtures only in the test environment', () => {
    env.NODE_ENV = 'test';
    expect(whatsappService.verifySignature(undefined)).toBe(true);
    expect(whatsappService.verifySignature('test payload')).toBe(true);
  });
});
