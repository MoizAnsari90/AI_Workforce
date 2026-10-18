import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { queueService } from '../src/services/queueService';

it('retains an accepted message in Redis after the accepting process disconnects', async () => {
  const payload = { tenantId: randomUUID(), message: { metaMessageId: randomUUID(), fromPhone: '15550000001', text: 'Persistence fixture', timestamp: new Date().toISOString() } };
  let acceptedId: string | undefined;
  let reader: Queue | undefined;
  const connection = new IORedis({ host: env.REDIS_HOST, port: env.REDIS_PORT, db: env.REDIS_DB, password: env.REDIS_PASSWORD || undefined, maxRetriesPerRequest: 1 });
  try {
    await vi.waitFor(() => expect(queueService.getRedisStatus()).toBe('ready'));
    await queueService.enqueue(payload);
    await queueService.close();
    // A separate client represents a replacement process reading persisted work.
    reader = new Queue('whatsapp-incoming-queue', { connection });
    const jobs = await reader.getJobs(['waiting']);
    const accepted = jobs.find(job => job.data.message.metaMessageId === payload.message.metaMessageId);
    acceptedId = accepted?.id;
    expect(accepted?.data).toEqual(payload);
    expect(await accepted!.getState()).toBe('waiting');
  } finally {
    if (acceptedId && reader) await reader.remove(acceptedId);
    if (reader) await reader.close();
    connection.disconnect();
    await queueService.close();
  }
}, 15000);
