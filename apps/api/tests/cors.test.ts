import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { app } from '../src/app';
import { initSocketServer } from '../src/lib/socket';

describe('Browser origin restrictions', () => {
  it('allows the configured frontend and its preflight requests', async () => {
    const response = await request(app).options('/api/v1/auth/login').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'POST');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(response.headers.vary).toContain('Origin');
  });
  it('rejects foreign and null origins before reaching routes', async () => {
    for (const origin of ['https://attacker.test', 'null']) {
      const response = await request(app).get('/api/v1/auth/me').set('Origin', origin);
      expect(response.status).toBe(403); expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
  it('permits server-to-server requests without an Origin', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });
  const server = createServer();
  const socket = initSocketServer(server);
  afterAll(() => new Promise<void>(resolve => socket.close(() => resolve())));
  it('blocks foreign origins on WebSocket upgrades as well as polling', async () => {
    const allow = socket.engine.opts.allowRequest!;
    for (const [origin, expected] of [['http://localhost:3000', true], ['https://attacker.test', false], [undefined, true]] as const) {
      const result = await new Promise(resolve => allow({ headers: { origin } } as any, (_error, allowed) => resolve(allowed)));
      expect(result).toBe(expected);
    }
  });
});
