import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { queueService } from '../src/services/queueService';
import { env } from '../src/config/env';
import { redisConnectionOptions } from '../src/config/redis';
afterAll(() => queueService.close());
it('processes durable queued work in a bounded consumer and closes on drain', async () => {
  const name = `bounded-test-${randomUUID()}`;
  const queue = new Queue(name, { connection: redisConnectionOptions(env) });
  const payload = { tenantId: randomUUID(), message: { metaMessageId: randomUUID(), fromPhone: '15550000001', text: 'Bounded synthetic job', timestamp: new Date().toISOString() } };
  const job = await queue.add('synthetic', payload);
  const process = vi.fn(async () => {});
  try {
    const result = await queueService.drainOnce(process, 3000, 5, name);
    expect(process).toHaveBeenCalledWith(payload); expect(result.handled).toBe(1);
  } finally { await job.remove(); await queue.close(); }
}, 10000);
