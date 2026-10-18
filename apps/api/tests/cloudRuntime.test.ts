import { describe, expect, it } from 'vitest';
import { redisConnectionOptions } from '../src/config/redis';
import request from 'supertest';
import { app } from '../src/app';

const local = { REDIS_HOST: 'redis', REDIS_PORT: 6379, REDIS_DB: 0 };
describe('Managed Redis configuration', () => {
  it('supports authenticated TLS connections without disabling certificate verification', () => {
    expect(redisConnectionOptions({ ...local, REDIS_URL: 'rediss://default:p%40ss%3Aword@cache.acme.test:6380/0' })).toMatchObject({ host: 'cache.acme.test', port: 6380, username: 'default', password: 'p@ss:word', db: 0, tls: { rejectUnauthorized: true, servername: 'cache.acme.test' } });
  });
  it('supports private Redis and existing host-based Compose configuration', () => {
    expect(redisConnectionOptions({ ...local, REDIS_URL: 'redis://10.0.0.5:6379/2' })).toEqual({ host: '10.0.0.5', port: 6379, db: 2, username: undefined, password: undefined });
    expect(redisConnectionOptions(local)).toMatchObject({ host: 'redis', db: 0 });
  });
  it('accepts Upstash Redis TCP/TLS credentials on database zero', () => {
    expect(redisConnectionOptions({ ...local, REDIS_URL: 'rediss://default:encoded%40password@unit.upstash.io:6379/0' })).toMatchObject({
      host: 'unit.upstash.io', port: 6379, db: 0, username: 'default', password: 'encoded@password',
      tls: { rejectUnauthorized: true, servername: 'unit.upstash.io' },
    });
    for (const url of ['https://unit.upstash.io', 'redis://default:private@unit.upstash.io:6379', 'rediss://default:private@unit.upstash.io:6379/1', 'rediss://unit.upstash.io:6379']) {
      expect(() => redisConnectionOptions({ ...local, REDIS_URL: url })).toThrow('Invalid REDIS_URL');
    }
  });
  it('rejects invalid URLs without exposing credentials', () => {
    for (const url of ['https://default:private@cache.test', 'redis://default:private@cache.test/99', 'redis://default:private@cache.test/invalid', 'rediss://default:private@cache.test/0?rejectUnauthorized=false']) {
      expect(() => redisConnectionOptions({ ...local, REDIS_URL: url })).toThrow('Invalid REDIS_URL');
      try { redisConnectionOptions({ ...local, REDIS_URL: url }); } catch (error) { expect(String(error)).not.toContain('private'); }
    }
  });
});
it('exposes process liveness independently of dependency readiness', async () => {
  expect((await request(app).get('/livez')).body).toEqual({ status: 'alive' });
});
