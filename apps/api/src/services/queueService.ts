import { Queue, Worker, Job, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import { createHash } from 'node:crypto';
import { env } from '../config/env';
import { redisConnectionOptions } from '../config/redis';
import { logger } from '../utils/logger';
import { ParsedWhatsAppMessage, WhatsAppDeliveryUncertainError } from './whatsappService';
import { ServiceUnavailableError } from '../errors/AppError';

export interface WhatsAppJobPayload {
  tenantId: string;
  message: ParsedWhatsAppMessage;
}

let redisConnection: IORedis | null = null;
let producerConnection: IORedis | null = null;
let messageQueue: Queue | null = null;
let messageWorker: Worker | null = null;
let workerProcessor: ((data: WhatsAppJobPayload) => Promise<void>) | null = null;

// Attempt Redis connection
try {
  const connectionOptions = {
    ...redisConnectionOptions(env),
    lazyConnect: true,
  };
  redisConnection = new IORedis({
    ...connectionOptions,
    maxRetriesPerRequest: null,
  });
  // Producers fail promptly during outages. Workers keep reconnecting to recover
  // persisted jobs; their blocking Redis commands must not have a command timeout.
  producerConnection = new IORedis({
    ...connectionOptions,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 5000,
  });

  redisConnection.on('error', (err) => {
    logger.debug('WhatsApp worker Redis unavailable; reconnecting', {
      error: err.message,
    });
  });
  producerConnection.on('error', (err) => {
    logger.debug('WhatsApp queue unavailable; webhook delivery must retry', { error: err.message });
  });
  redisConnection.on('ready', initBullMQ);
  producerConnection.on('ready', initBullMQ);
  void producerConnection.connect().then(initBullMQ).catch(() => {});
} catch {
  logger.error('Could not create WhatsApp Redis connections');
}

function initBullMQ() {
  if (!redisConnection || !producerConnection) return;

  try {
    if (!messageQueue && producerConnection.status === 'ready') {
      messageQueue = new Queue('whatsapp-incoming-queue', { connection: producerConnection });
      messageQueue.on('error', error => logger.error('WhatsApp queue error', { error: error.message }));
    }

    if (workerProcessor && !messageWorker && redisConnection.status === 'ready') {
      messageWorker = new Worker(
        'whatsapp-incoming-queue',
        async (job: Job<WhatsAppJobPayload>) => {
          if (workerProcessor) {
            try { await workerProcessor(job.data); }
            catch (error) {
              // Meta may have accepted the send before the connection timed out.
              // BullMQ retries must not send a second customer reply.
              if (error instanceof WhatsAppDeliveryUncertainError) throw new UnrecoverableError(error.message);
              throw error;
            }
          }
        },
        { connection: redisConnection }
      );
      messageWorker.on('error', error => logger.error('WhatsApp worker error', { error: error.message }));
    }
  } catch (err) {
    logger.error('Could not initialize durable WhatsApp queue', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const queueService = {
  async drainOnce(processor: (data: WhatsAppJobPayload) => Promise<void>, windowMs = 20000, maxJobs = 5, queueName = 'whatsapp-incoming-queue') {
    // A callback owns this consumer only until its bounded batch ends. BullMQ
    // retains delayed jobs and renews locks while active jobs execute.
    const worker = new Worker<WhatsAppJobPayload>(queueName, async job => {
      try { await processor(job.data); }
      catch (error) {
        if (error instanceof WhatsAppDeliveryUncertainError) throw new UnrecoverableError(error.message);
        throw error;
      }
    }, { connection: { ...redisConnectionOptions(env), maxRetriesPerRequest: null, connectTimeout: 5000, retryStrategy: attempt => attempt < 3 ? 250 : null }, autorun: false, concurrency: 1 });
    let completed = 0;
    let stop!: () => void;
    let fail!: (error: Error) => void;
    const finished = new Promise<void>((resolve, reject) => { stop = resolve; fail = reject; });
    worker.on('drained', stop);
    worker.on('error', fail);
    const count = () => { completed++; if (completed >= maxJobs) stop(); };
    worker.on('completed', count);
    worker.on('failed', count);
    const timer = setTimeout(stop, windowMs);
    const running = worker.run();
    void running.catch(fail);
    try { await finished; }
    finally { clearTimeout(timer); await worker.close(); await running; }
    return { handled: completed };
  },

  registerProcessor(processor: (data: WhatsAppJobPayload) => Promise<void>) {
    workerProcessor = processor;
    // HTTP-only/serverless processes do not need a consumer connection.
    if (redisConnection?.status === 'wait') void redisConnection.connect().then(initBullMQ).catch(() => {});
    initBullMQ();
  },

  async enqueue(payload: WhatsAppJobPayload): Promise<void> {
    logger.info('Enqueueing incoming WhatsApp message', {
      tenantId: payload.tenantId,
      metaMessageId: payload.message.metaMessageId,
      redisAvailable: producerConnection?.status === 'ready',
    });

    if (producerConnection?.status === 'ready' && messageQueue) {
      await messageQueue.add('process-whatsapp-message', payload, {
        jobId: createHash('sha256').update(JSON.stringify([payload.tenantId, payload.message.metaMessageId])).digest('hex'),
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        // Retain completed IDs for provider redeliveries, with bounded storage.
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100000 },
      });
      return;
    }

    throw new ServiceUnavailableError('WhatsApp queue unavailable. Retry webhook delivery.');
  },

  getRedisStatus() {
    return messageQueue ? producerConnection?.status || 'disconnected' : 'disconnected';
  },

  async close() {
    if (messageWorker) await messageWorker.close();
    if (messageQueue) await messageQueue.close();
    if (producerConnection) producerConnection.disconnect();
    if (redisConnection) redisConnection.disconnect();
  },
};
