import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createAuthRateLimiter } from '../src/middleware/authRateLimiter';
import { createServer, connect, type Socket, type AddressInfo } from 'node:net';
import { env } from '../src/config/env';
import { redisConnectionOptions } from '../src/config/redis';
import { errorHandler } from '../src/middleware/errorHandler';

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
  it('recovers from an initial Redis connection failure without losing the shared budget', async () => {
    const sockets = new Set<Socket>();
    let available = false;
    const target = redisConnectionOptions(env);
    const proxy = createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {});
      if (!available) { socket.destroy(); return; }
      const upstream = connect({ host: target.host, port: target.port! });
      sockets.add(upstream);
      upstream.on('close', () => { sockets.delete(upstream); socket.destroy(); });
      upstream.on('error', () => socket.destroy());
      socket.on('close', () => upstream.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const options = {
      redisOptions: { ...target, host: '127.0.0.1', port: (proxy.address() as AddressInfo).port,
        lazyConnect: true, connectTimeout: 200, commandTimeout: 200,
        maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null },
      prefix: `ai-workforce:rate-limit:auth:recovery:${Date.now()}:`, limit: 2,
    };
    const makeApp = () => {
      const app = express();
      app.post('/login', createAuthRateLimiter(options), (_req, res) => res.sendStatus(204));
      app.use(errorHandler);
      return app;
    };
    try {
      const first = makeApp();
      const failed = await request(first).post('/login').timeout(2000);
      expect(failed.status).toBe(503);
      expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
      available = true;
      expect((await request(first).post('/login').timeout(2000)).status).toBe(204);
      const second = makeApp();
      expect((await request(second).post('/login').timeout(2000)).status).toBe(204);
      // Simulate an idle serverless socket being closed by the provider.
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => setTimeout(resolve, 30));
      expect((await request(first).post('/login').timeout(2000)).status).toBe(429);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => proxy.close(() => resolve()));
    }
  });
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
    app.use(errorHandler);
    const response = await request(app).post('/api/v1/auth/login').send({});
    expect(response.status).toBe(503);
  });
});
