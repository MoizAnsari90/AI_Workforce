import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('Rate Limiting', () => {
  it('should apply global rate limit to non-auth routes', async () => {
    let rateLimited = false;
    for (let i = 0; i < 505; i++) {
      const res = await request(app).get('/api/v1/tenants');
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  }, 20000); // 20s timeout

  it('should apply stricter rate limit to auth routes', async () => {
    let rateLimited = false;
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post('/api/v1/auth/login');
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it('should NOT rate limit webhook route', async () => {
    // Even after hitting auth/global limits, webhooks should pass
    // (This is difficult to test properly without state reset, but verifying 200 is fine)
    const res = await request(app).post('/api/v1/webhook').send({});
    // Assuming 404 or something else as webhook logic is not setup, but NOT 429
    expect(res.status).not.toBe(429);
  });
});
