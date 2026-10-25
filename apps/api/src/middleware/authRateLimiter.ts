import rateLimit from 'express-rate-limit';
import Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env';
import { redisConnectionOptions } from '../config/redis';
import type { RedisOptions } from 'ioredis';

type RedisValue = boolean | number | string;
type RedisReply = RedisValue | RedisValue[];

export interface AuthRateLimiterOptions {
  redisOptions?: RedisOptions;
  prefix?: string;
  windowMs?: number;
  limit?: number;
}

function isRedisValue(value: unknown): value is RedisValue {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

export function createAuthRateLimiter(options: AuthRateLimiterOptions = {}) {
  const redis = new Redis(options.redisOptions ?? {
    ...redisConnectionOptions(env),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    commandTimeout: 5000,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});

  async function ensureRedisReady() {
    if (redis.status === 'wait') await redis.connect();
    if (redis.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { redis.off('ready', onReady); redis.off('error', onError); };
      const onReady = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      redis.once('ready', onReady);
      redis.once('error', onError);
    });
  }

  const store = new RedisStore({
    prefix: options.prefix ?? 'ai-workforce:rate-limit:auth:',
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      await ensureRedisReady();
      const [command, ...parameters] = args;
      if (!command) throw new Error('Redis rate-limit command is missing');
      const reply: unknown = await redis.call(command, parameters);
      if (isRedisValue(reply)) return reply;
      if (Array.isArray(reply) && reply.every(isRedisValue)) return reply;
      throw new Error('Unexpected Redis rate-limit response');
    },
  });

  return rateLimit({
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    limit: options.limit ?? 20,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: false,
    store,
    message: { error: 'Too many login attempts, please try again later.' },
    skip: req => req.originalUrl.startsWith('/api/v1/webhook'),
  });
}
