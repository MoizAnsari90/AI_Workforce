import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import type { RedisOptions } from 'ioredis';

interface RedisConfig {
  REDIS_URL?: string; REDIS_HOST: string; REDIS_PORT: number; REDIS_DB: number;
  REDIS_PASSWORD?: string; REDIS_USERNAME?: string; REDIS_TLS_CA_FILE?: string;
}

export function redisConnectionOptions(config: RedisConfig): RedisOptions {
  if (!config.REDIS_URL) return {
    host: config.REDIS_HOST, port: config.REDIS_PORT, db: config.REDIS_DB,
    username: config.REDIS_USERNAME || undefined, password: config.REDIS_PASSWORD || undefined,
  };
  try {
    const url = new URL(config.REDIS_URL);
    const db = url.pathname === '' || url.pathname === '/' ? 0 : Number(url.pathname.slice(1));
    const port = url.port ? Number(url.port) : 6379;
    if (!['redis:', 'rediss:'].includes(url.protocol) || !url.hostname || url.search || url.hash ||
      !/^\/(?:\d+)?$/.test(url.pathname || '/') || !Number.isInteger(db) || db < 0 || db > 15 || port < 1 || port > 65535) throw new Error();
    if (config.REDIS_TLS_CA_FILE && url.protocol !== 'rediss:') throw new Error();
    // Upstash's BullMQ/ioredis endpoint is Redis TCP over TLS, not its REST URL.
    const upstash = url.hostname.endsWith('.upstash.io');
    if (upstash && (url.protocol !== 'rediss:' || db !== 0 || !url.password)) throw new Error();
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''), port, db,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      ...(url.protocol === 'rediss:' ? { tls: {
        rejectUnauthorized: true,
        ...(!isIP(url.hostname.replace(/^\[|\]$/g, '')) ? { servername: url.hostname } : {}),
        ...(config.REDIS_TLS_CA_FILE ? { ca: readFileSync(config.REDIS_TLS_CA_FILE, 'utf8') } : {}),
      } } : {}),
    };
  } catch {
    // URLs can contain credentials; never include them in configuration errors.
    throw new Error('Invalid REDIS_URL or Redis TLS CA configuration');
  }
}
