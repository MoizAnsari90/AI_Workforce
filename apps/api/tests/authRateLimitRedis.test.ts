import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createAuthRateLimiter } from '../src/middleware/authRateLimiter';

const originalTrustProxy = process.env.TRUST_PROXY_HOPS;
const clientIp = `203.0.113.${Math.floor(1 + Math.random() * 200)}`;
let firstApp: ReturnType<typeof createApp>;
let secondApp: ReturnType<typeof createApp>;

beforeAll(() => {
  process.env.TRUST_PROXY_HOPS = '1';
  firstApp = createApp();
  secondApp = createApp();
});

afterAll(() => {
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = originalTrustProxy;
});

describe('Redis-backed authentication rate limiting', () => {
  it('shares the auth request budget across two app instances', async () => {
    let finalResponse;
    for (let index = 0; index < 21; index += 1) {
      const currentApp = index % 2 === 0 ? firstApp : secondApp;
      finalResponse = await request(currentApp).post('/api/v1/auth/login').set('X-Forwarded-For', clientIp).send({});
    }
    expect(finalResponse?.status).toBe(429);
  });

  it('fails closed when its Redis store is unavailable', async () => {
    const app = express();
    app.post('/api/v1/auth/login', createAuthRateLimiter({
      redisOptions: { host: '127.0.0.1', port: 1, connectTimeout: 100, maxRetriesPerRequest: 1, retryStrategy: () => null },
      prefix: `test:auth-down:${Date.now()}:`,
    }), (_req, res) => res.sendStatus(200));
    const response = await request(app).post('/api/v1/auth/login').send({});
    expect(response.status).not.toBe(200);
  });
});