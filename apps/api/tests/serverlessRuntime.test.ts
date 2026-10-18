import { afterEach, expect, it, vi } from 'vitest';
import http from 'http';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

it('exports the Express handler on Vercel without opening a server or starting consumers', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('BACKGROUND_WORKERS_ENABLED', 'false');
  const listener = vi.spyOn(http, 'createServer');
  const { queueService } = await import('../src/services/queueService');
  const { autonomyService } = await import('../src/services/autonomyService');
  const processor = vi.spyOn(queueService, 'registerProcessor');
  const scheduler = vi.spyOn(autonomyService, 'startScheduler');
  try {
    const { default: handler } = await import('../src/index');
    const { app } = await import('../src/app');
    expect(handler).toBe(app);
    expect(typeof handler).toBe('function');
    expect(listener).not.toHaveBeenCalled();
    expect(processor).not.toHaveBeenCalled();
    expect(scheduler).not.toHaveBeenCalled();
  } finally { await queueService.close(); }
}, 15000);

it('refuses continuous workers when explicitly enabled inside Vercel Functions', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('BACKGROUND_WORKERS_ENABLED', 'true');
  await expect(import('../src/config/env')).rejects.toThrow('Set BACKGROUND_WORKERS_ENABLED=false');
});
