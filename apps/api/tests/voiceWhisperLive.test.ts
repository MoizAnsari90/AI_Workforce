import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { registerTenantAndAdmin } from '../src/services/authService';

// Opt in with the local lifecycle helper: real model, real Postgres, real Redis.
describe.skipIf(!process.env.TEST_VOICE_WORKER_URL)('Live offline Whisper through the active authenticated API', () => {
  const previousUrl = env.VOICE_TRANSCRIBER_URL, previousKey = env.VOICE_WORKER_AUTH_KEY;
  let tenantId = '', token = '';
  beforeAll(async () => {
    const workerUrl = new URL(process.env.TEST_VOICE_WORKER_URL!);
    if (!['127.0.0.1', 'localhost'].includes(workerUrl.hostname)) throw new Error('Live voice checks require a local isolated worker');
    if (!/^[a-f0-9]{64}$/i.test(process.env.TEST_VOICE_WORKER_AUTH_KEY || '')) throw new Error('Set the local test worker authentication key');
    env.VOICE_TRANSCRIBER_URL = workerUrl.origin;
    env.VOICE_WORKER_AUTH_KEY = process.env.TEST_VOICE_WORKER_AUTH_KEY;
    const account = await registerTenantAndAdmin({ tenantName: 'Real Whisper fixture', email: `${randomUUID()}@whisper.example.test`, password: 'FixturePassword123!' });
    tenantId = account.tenant.id; token = account.token;
  });
  afterAll(async () => {
    env.VOICE_TRANSCRIBER_URL = previousUrl; env.VOICE_WORKER_AUTH_KEY = previousKey;
    if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  });
  it('transcribes synthetic speech, persists the result, and replays it without new inference', async () => {
    const audio = readFileSync(path.resolve(process.cwd(), '../../.local/voice-fixture.wav'));
    const id = randomUUID();
    const upload = () => request(app).post(`/api/v1/tenants/${tenantId}/workforce/transcribe`)
      .set('Authorization', `Bearer ${token}`).set('Content-Type', 'audio/wav').set('x-voice-request-id', id).send(audio);
    const start = Date.now(), first = await upload();
    expect(first.status).toBe(200);
    expect(first.body.data.transcript).toMatch(/approvals?.*pending/i);
    expect(first.body.data.question).toMatch(/approvals?.*pending/i);
    const replay = await upload();
    expect(replay.status).toBe(200); expect(replay.body).toEqual(first.body);
    const row = await prisma.idempotencyLog.findFirstOrThrow({ where: { tenantId, targetResource: { endsWith: id } } });
    expect(row.status).toBe('succeeded');
    expect(JSON.stringify(row)).not.toContain(audio.toString('base64'));
    console.log(JSON.stringify({ check: 'real-free-whisper-active-api', elapsedMs: Date.now() - start, syntheticAudioOnly: true, paidFallback: false }));
  }, 120000);
});
