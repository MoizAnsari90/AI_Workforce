import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ run: null as null | ((job: any) => Promise<void>), connections: [] as any[], add: vi.fn() }));
vi.mock('ioredis', () => ({ default: class {
  status = 'ready'; handlers = new Map<string, () => void>();
  constructor() { state.connections.push(this); }
  on(event: string, callback: () => void) { this.handlers.set(event, callback); return this; }
  async connect() {} disconnect() {}
} }));
vi.mock('bullmq', async importOriginal => {
  const actual = await importOriginal<typeof import('bullmq')>();
  return {
    UnrecoverableError: actual.UnrecoverableError,
    Queue: class { add = state.add; on() { return this; } async close() {} },
    Worker: class { constructor(_name: string, run: typeof state.run) { state.run = run; } on() { return this; } async close() {} },
  };
});
import { UnrecoverableError } from 'bullmq';
import { queueService } from '../src/services/queueService';
import { WhatsAppDeliveryUncertainError } from '../src/services/whatsappService';
afterAll(() => queueService.close());
beforeEach(() => { state.add.mockReset().mockResolvedValue({}); state.connections.forEach(connection => { connection.status = 'ready'; }); });
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

const payload = { tenantId: 'tenant-a', message: { metaMessageId: 'wamid.inbound', fromPhone: '15550000001', text: 'Hello', timestamp: new Date().toISOString() } };
it('rejects during Redis outages and accepts deliveries after reconnecting', async () => {
  const process = vi.fn(); queueService.registerProcessor(process);
  state.connections[1].status = 'reconnecting';
  await expect(queueService.enqueue(payload)).rejects.toMatchObject({ statusCode: 503 });
  expect(state.add).not.toHaveBeenCalled(); expect(process).not.toHaveBeenCalled();
  state.connections[1].status = 'ready'; state.connections[1].handlers.get('ready')?.();
  await queueService.enqueue(payload);
  expect(state.add).toHaveBeenCalledTimes(1); expect(process).not.toHaveBeenCalled();
});
it('propagates failed persistence so the webhook can retry', async () => {
  state.add.mockRejectedValueOnce(new Error('Redis write failed'));
  await expect(queueService.enqueue(payload)).rejects.toThrow('Redis write failed');
});
it('waits for persistence and uses a tenant-scoped stable ID for duplicate deliveries', async () => {
  let persist!: () => void;
  state.add.mockReturnValueOnce(new Promise<void>(resolve => { persist = resolve; }));
  let acknowledged = false;
  const pending = queueService.enqueue(payload).then(() => { acknowledged = true; });
  await Promise.resolve(); expect(acknowledged).toBe(false);
  persist(); await pending; expect(acknowledged).toBe(true);
  await queueService.enqueue(payload);
  await queueService.enqueue({ ...payload, tenantId: 'tenant-b' });
  const options = state.add.mock.calls.map(call => call[2]);
  expect(options[0].jobId).toBe(options[1].jobId);
  expect(options[0].jobId).not.toBe(options[2].jobId);
  expect(options[0]).toMatchObject({ attempts: 3, backoff: { type: 'exponential' } });
});
