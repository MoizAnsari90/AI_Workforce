import rateLimit from 'express-rate-limit';
import Redis from 'ioredis';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env';
import { redisConnectionOptions } from '../config/redis';
import type { RedisOptions } from 'ioredis';
import { ServiceUnavailableError } from '../errors/AppError';

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

// Do not open sockets while a serverless module is being initialized. A failed
// SCRIPT LOAD must also be retryable by the next request, not cached forever.
class RecoverableRedisStore extends RedisStore {
  private configuration!: Parameters<RedisStore['init']>[0];
  private initialization?: Promise<void>;

  override async init(configuration: Parameters<RedisStore['init']>[0]) {
    this.configuration = configuration;
  }

  private async withReadyStore<T>(operation: () => Promise<T>): Promise<T> {
    try {
      this.initialization ??= super.init(this.configuration);
      await this.initialization;
      return await operation();
    } catch {
      this.initialization = undefined;
      // Never retry an increment with an ambiguous result, or bypass the limit.
      throw new ServiceUnavailableError('Authentication is temporarily unavailable. Please try again shortly.');
    }
  }

  override increment(key: string) {
    return this.withReadyStore(() => super.increment(key));
  }

  override get(key: string) {
    return this.withReadyStore(() => super.get(key));
  }
}

export function createAuthRateLimiter(options: AuthRateLimiterOptions = {}) {
  const redis = new Redis({
    ...redisConnectionOptions(env),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5000,
    commandTimeout: 5000,
    retryStrategy: () => null,
    ...options.redisOptions,
  });
  redis.on('error', () => {});
  let connecting: Promise<void> | undefined;

  async function ensureRedisReady() {
    if (redis.status === 'ready') return;
    if (!connecting) {
      connecting = new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          redis.off('ready', onReady);
          redis.off('error', onError);
          redis.off('end', onEnd);
        };
        const onReady = () => { if (settled) return; settled = true; cleanup(); resolve(); };
        const onError = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          redis.disconnect();
          reject(error);
        };
        const onEnd = () => onError(new Error('Redis connection ended'));
        const timer = setTimeout(() => onError(new Error('Redis connection timed out')), redis.options.connectTimeout || 5000);
        redis.once('ready', onReady);
        redis.once('error', onError);
        redis.once('end', onEnd);
        if (redis.status === 'wait' || redis.status === 'end') {
          void redis.connect().catch(onError);
        }
      }).finally(() => { connecting = undefined; });
    }
    await connecting;
  }

  const store = new RecoverableRedisStore({
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
