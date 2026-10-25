import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../src/app';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { registerTenantAndAdmin } from '../src/services/authService';
import { VOICE_MODEL_REVISION } from '../src/services/voiceQuestionService';

const previousUrl = env.VOICE_TRANSCRIBER_URL;
let tenantId = '', token = '', calls = 0, workerStatus = 200;
const tenants: string[] = [];
let release: (() => void) | undefined;
let hold = false;
const audio = Buffer.alloc(44 + 32000);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(32000, 40);
for (let i = 44; i < audio.length; i += 2) audio.writeInt16LE(Math.round(Math.sin(i / 16) * 5000), i);

const worker = createServer(async (req, res) => {
  calls++;
  const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part));
  const bytes = Buffer.concat(parts);
  const key = createHmac('sha256', env.JWT_SECRET).update('ai-workforce:voice-worker:v1').digest();
  try {
    const claims = jwt.verify(String(req.headers.authorization).slice(7), key, { algorithms: ['HS256'], audience: 'voice-worker', issuer: 'ai-workforce-api' }) as jwt.JwtPayload;
    expect(claims.audioSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(req.headers['x-voice-payment-policy']).toBe('free-only');
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    res.writeHead(workerStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(workerStatus === 200 ? { transcript: 'Pending approvals?', question: 'Pending approvals?',
      engine: 'faster-whisper', engineVersion: '1.2.1', policy: 'free-only', billingRequired: false, protocolVersion: 1, modelRevision: VOICE_MODEL_REVISION } : { error: 'Fixture service unavailable' }));
  } catch { res.writeHead(401); res.end('{}'); }
});

beforeAll(async () => {
  await new Promise<void>(resolve => worker.listen(0, '127.0.0.1', resolve));
  env.VOICE_TRANSCRIBER_URL = `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
});
beforeEach(async () => {
  workerStatus = 200; hold = false; release = undefined;
  const account = await registerTenantAndAdmin({ tenantName: 'Voice isolated integration', email: `${randomUUID()}@voice.example.test`, password: 'FixturePassword123!' });
  tenantId = account.tenant.id; token = account.token;
  tenants.push(tenantId);
});
afterAll(async () => {
  release?.(); env.VOICE_TRANSCRIBER_URL = previousUrl;
  await new Promise<void>(resolve => worker.close(() => resolve()));
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
});
const upload = (id: string) => request(app).post(`/api/v1/tenants/${tenantId}/workforce/transcribe`)
  .set('Authorization', `Bearer ${token}`).set('Content-Type', 'audio/wav').set('x-voice-request-id', id).send(audio);

describe('Real Postgres voice idempotency and authenticated local HTTP worker', () => {
  it('replays a successful transcript without another worker call or stored audio', async () => {
    const id = randomUUID(), before = calls;
    const first = await upload(id); const replay = await upload(id);
    expect(first.status).toBe(200); expect(replay.body).toEqual(first.body);
    expect(calls - before).toBe(1);
    const row = await prisma.idempotencyLog.findFirstOrThrow({ where: { tenantId, targetResource: { endsWith: id } } });
    expect(row.status).toBe('succeeded');
    expect(JSON.stringify(row)).not.toContain(audio.toString('base64'));
  });
  it('allows the same recording to be retried explicitly after a local service outage', async () => {
    const id = randomUUID(), before = calls;
    workerStatus = 503;
    expect((await upload(id)).status).toBe(503);
    // A pre-upgrade hosted-provider failure can now be retried through the free engine.
    await prisma.idempotencyLog.updateMany({ where: { tenantId, targetResource: { endsWith: id } }, data: { errorMessage: 'Voice transcription failed' } });
    workerStatus = 200;
    hold = true;
    const retried = upload(id).then(response => response);
    const deadline = Date.now() + 5000;
    while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    expect(release).toBeDefined();
    const competing = await upload(id);
    hold = false; release?.();
    expect(competing.status).toBe(409);
    expect((await retried).status).toBe(200);
    expect(calls - before).toBe(2);
  });
  it('persists a payment block and never replays it through another provider', async () => {
    const id = randomUUID(), before = calls;
    workerStatus = 402;
    expect((await upload(id)).status).toBe(402);
    workerStatus = 200;
    const replay = await upload(id);
    expect(replay.status).toBe(402);
    expect(replay.body.error.code).toBe('VOICE_PAID_UPGRADE_BLOCKED');
    expect(calls - before).toBe(1);
  });
  it('blocks concurrent duplicate inference while the first request is pending', async () => {
    const id = randomUUID(), before = calls;
    hold = true; release = undefined;
    const first = upload(id).then(response => response);
    const deadline = Date.now() + 5000;
    while (!release && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    expect(release).toBeDefined();
    expect((await upload(id)).status).toBe(409);
    hold = false; release?.();
    expect((await first).status).toBe(200);
    expect(calls - before).toBe(1);
  });
});
