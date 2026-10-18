import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
const state = vi.hoisted(() => ({ held: false, drain: vi.fn(), niche: vi.fn(), reports: vi.fn(), autonomy: vi.fn(), release: vi.fn(), disconnect: vi.fn() }));
vi.mock('../src/config/env', () => ({ env: { BACKGROUND_WORKERS_ENABLED: 'false', REDIS_HOST: 'localhost', REDIS_PORT: 6379, REDIS_DB: 15 } }));
vi.mock('../src/services/queueService', () => ({ queueService: { drainOnce: state.drain } }));
vi.mock('../src/services/supportAgentService', () => ({ supportAgentService: { processInboundMessage: vi.fn() } }));
vi.mock('../src/services/nicheAutomationWorker', () => ({ tickNicheAutomation: state.niche }));
vi.mock('../src/services/storeReportScheduler', () => ({ tickStoreReports: state.reports }));
vi.mock('../src/services/autonomyService', () => ({ autonomyService: { tick: state.autonomy } }));
vi.mock('ioredis', () => ({ default: class {
  on() {} async connect() {} disconnect = state.disconnect;
  async set(_key: string, _value: string, ...args: unknown[]) { return args.includes('NX') && state.held ? null : 'OK'; }
  eval = state.release;
} }));
import { automationCallbackRouter } from '../src/routes/automationCallbackRoutes';
const app = express(); app.use('/internal/automation', express.raw({ type: 'application/json' }), automationCallbackRouter);
const target = 'https://api.example.test/internal/automation/tick';
const key = 'synthetic-current-signing-key'; const next = 'synthetic-next-signing-key';
const body = '{"cycle":"scheduled"}';
function signature(options: { url?: string; key?: string; expiresIn?: number } = {}) {
  return jwt.sign({ iss: 'Upstash', sub: options.url || target, body: createHash('sha256').update(body).digest('base64url') }, options.key || key, { algorithm: 'HS256', expiresIn: options.expiresIn ?? 60 });
}
const post = (sig?: string, payload = body) => { const req = request(app).post('/internal/automation/tick').set('Content-Type', 'application/json'); return (sig ? req.set('Upstash-Signature', sig) : req).send(payload); };
beforeEach(() => {
  vi.clearAllMocks(); state.held = false;
  state.drain.mockResolvedValue({ handled: 0 }); state.niche.mockResolvedValue(undefined); state.reports.mockResolvedValue(undefined); state.autonomy.mockResolvedValue([]); state.release.mockResolvedValue(1);
  vi.stubEnv('SERVERLESS_AUTOMATION_ENABLED', 'true'); vi.stubEnv('PUBLIC_API_URL', 'https://api.example.test');
  vi.stubEnv('QSTASH_CURRENT_SIGNING_KEY', key); vi.stubEnv('QSTASH_NEXT_SIGNING_KEY', next);
});
afterEach(() => vi.unstubAllEnvs());
it('rejects absent, expired, forged, body-tampered and wrong-destination signatures before work starts', async () => {
  for (const [sig, payload] of [[undefined, body], [signature({ expiresIn: -60 }), body], [signature({ key: 'forged' }), body], [signature(), '{}'], [signature({ url: 'https://other.test' }), body]] as const) expect((await post(sig, payload)).status).toBe(401);
  expect(state.drain).not.toHaveBeenCalled(); expect(state.niche).not.toHaveBeenCalled();
});
it('accepts a rotated signing key and processes bounded scheduler batches while releasing its lease', async () => {
  expect((await post(signature({ key: next }))).status).toBe(200);
  expect(state.drain).toHaveBeenCalledWith(expect.any(Function), 20000, 5);
  expect(state.niche).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  expect(state.reports).toHaveBeenCalledOnce(); expect(state.autonomy).toHaveBeenCalledOnce();
  expect(state.release).toHaveBeenCalledOnce(); expect(state.disconnect).toHaveBeenCalledOnce();
});
it('coalesces overlapping deliveries and refuses disabled processing', async () => {
  state.held = true; expect((await post(signature())).body.skipped).toBeDefined();
  expect(state.drain).not.toHaveBeenCalled(); expect(state.release).not.toHaveBeenCalled();
  vi.stubEnv('SERVERLESS_AUTOMATION_ENABLED', 'false'); expect((await post(signature())).status).toBe(503);
});
it('returns a retryable error and releases the lease after a failed cycle', async () => {
  state.drain.mockRejectedValueOnce(new Error('synthetic outage'));
  expect((await post(signature())).status).toBe(503);
  expect(state.release).toHaveBeenCalledOnce(); expect(state.autonomy).not.toHaveBeenCalled();
});
