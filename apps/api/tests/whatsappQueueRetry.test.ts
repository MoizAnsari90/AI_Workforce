import { afterAll, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ run: null as null | ((job: any) => Promise<void>) }));
vi.mock('ioredis', () => ({ default: class {
  status = 'ready'; on() { return this; } async connect() {} disconnect() {}
} }));
vi.mock('bullmq', async importOriginal => {
  const actual = await importOriginal<typeof import('bullmq')>();
  return {
    UnrecoverableError: actual.UnrecoverableError,
    Queue: class { async close() {} },
    Worker: class { constructor(_name: string, run: typeof state.run) { state.run = run; } async close() {} },
  };
});
import { UnrecoverableError } from 'bullmq';
import { queueService } from '../src/services/queueService';
import { WhatsAppDeliveryUncertainError } from '../src/services/whatsappService';
afterAll(() => queueService.close());
it('stops automatic queue retries after an uncertain provider send', async () => {
  queueService.registerProcessor(async () => { throw new WhatsAppDeliveryUncertainError(); });
  await vi.waitFor(() => expect(state.run).not.toBeNull());
  await expect(state.run!({ data: {} })).rejects.toBeInstanceOf(UnrecoverableError);
});
it('keeps normal pre-send failures eligible for the existing retry policy', async () => {
  const failure = new Error('Database unavailable before sending');
  queueService.registerProcessor(async () => { throw failure; });
  await expect(state.run!({ data: {} })).rejects.toBe(failure);
});
