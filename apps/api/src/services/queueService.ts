import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ParsedWhatsAppMessage } from './whatsappService';

export interface WhatsAppJobPayload {
  tenantId: string;
  message: ParsedWhatsAppMessage;
}

let redisConnection: IORedis | null = null;
let messageQueue: Queue | null = null;
let messageWorker: Worker | null = null;
let workerProcessor: ((data: WhatsAppJobPayload) => Promise<void>) | null = null;
let isRedisAvailable = false;

// Attempt Redis connection
try {
  redisConnection = new IORedis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  redisConnection.on('error', (err) => {
    logger.debug('Redis offline or unreachable, using in-memory async fallback queue', {
      error: err.message,
    });
    isRedisAvailable = false;
  });

  redisConnection.connect().then(() => {
    isRedisAvailable = true;
    logger.info('Connected to Redis for BullMQ processing');
    initBullMQ();
  }).catch(() => {
    isRedisAvailable = false;
  });
} catch {
  isRedisAvailable = false;
}

function initBullMQ() {
  if (!redisConnection || !isRedisAvailable) return;

  try {
    messageQueue = new Queue('whatsapp-incoming-queue', {
      connection: redisConnection,
    });

    if (workerProcessor) {
      messageWorker = new Worker(
        'whatsapp-incoming-queue',
        async (job: Job<WhatsAppJobPayload>) => {
          if (workerProcessor) {
            await workerProcessor(job.data);
          }
        },
        { connection: redisConnection }
      );
    }
  } catch (err) {
    logger.warn('Could not initialize BullMQ queue, continuing with asynchronous fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const queueService = {
  registerProcessor(processor: (data: WhatsAppJobPayload) => Promise<void>) {
    workerProcessor = processor;
    if (isRedisAvailable && !messageWorker && redisConnection) {
      initBullMQ();
    }
  },

  async enqueue(payload: WhatsAppJobPayload): Promise<void> {
    logger.info('Enqueueing incoming WhatsApp message', {
      tenantId: payload.tenantId,
      metaMessageId: payload.message.metaMessageId,
      redisAvailable: isRedisAvailable,
    });

    if (isRedisAvailable && messageQueue) {
      await messageQueue.add('process-whatsapp-message', payload, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
      });
      return;
    }

    // In-memory asynchronous queue fallback
    setImmediate(async () => {
      try {
        if (workerProcessor) {
          await workerProcessor(payload);
        } else {
          logger.warn('No worker processor registered for incoming queue job', {
            metaMessageId: payload.message.metaMessageId,
          });
        }
      } catch (err) {
        logger.error('Failed to process message in fallback queue', {
          error: err instanceof Error ? err.message : String(err),
          metaMessageId: payload.message.metaMessageId,
        });
      }
    });
  },

  getRedisStatus() {
    return redisConnection?.status || 'disconnected';
  },

  async close() {
    if (messageWorker) await messageWorker.close();
    if (messageQueue) await messageQueue.close();
    if (redisConnection) redisConnection.disconnect();
  },
};
