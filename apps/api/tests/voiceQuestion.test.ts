import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), logs: new Map<string, any>(), user: 0 }));
vi.mock('../src/config/env', () => ({ env: { JWT_SECRET: 'test-only-voice-worker-signing-key', VOICE_TRANSCRIBER_URL: 'http://127.0.0.1:8091', VOICE_TRANSCRIPTION_PROVIDER: 'self-hosted-whisper', VOICE_PAYMENT_POLICY: 'free-only' } }));
vi.mock('../src/services/idempotencyService', () => ({ IdempotencyService: {
  generateIdempotencyKey: vi.fn(async (input: any) => { const key = JSON.stringify(input); return { key, idempotencyLog: mocks.logs.get(key) }; }),
  createPendingLog: vi.fn(async (key: string) => { mocks.logs.set(key, { status: 'pending' }); }),
  checkIdempotency: vi.fn(async (key: string) => mocks.logs.get(key)),
  logSuccess: vi.fn(async (key: string, _resource: string, responseSnapshot: any) => { mocks.logs.set(key, { status: 'succeeded', responseSnapshot }); }),
  logFailure: vi.fn(async (key: string, errorMessage: string) => { mocks.logs.set(key, { status: 'failed', errorMessage }); }),
  retryVoiceTranscription: vi.fn(async (key: string) => { if (!['voice:retryable', 'Voice transcription failed'].includes(mocks.logs.get(key)?.errorMessage)) return false; mocks.logs.set(key, { status: 'pending' }); return true; }),
} }));
vi.mock('../src/middleware/authMiddleware', () => ({ authenticate: (req: any, res: any, next: any) => {
  if (!req.headers.authorization) return res.status(401).json({ error: 'Unauthorized' });
  req.tenantId = 'tenant-a'; req.user = { userId: `user-${mocks.user}`, tenantId: 'tenant-a', permissions: req.headers['x-no-permission'] ? [] : ['operations:read'] }; next();
} }));
import { voiceQuestionRouter } from '../src/routes/voiceQuestionRoutes';
import { recognizeVoice, transcribeVoiceQuestion, validateVoiceWav } from '../src/services/voiceQuestionService';
import { IdempotencyService } from '../src/services/idempotencyService';
const app = express(); app.use(express.json(), voiceQuestionRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } }));
export function wav(seconds = 1, silent = false) {
  const b = Buffer.alloc(44 + Math.round(seconds * 16000) * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40);
  if (!silent) for (let i = 44; i < b.length; i += 2) b.writeInt16LE(Math.round(Math.sin(i / 16) * 5000), i);
  return b;
}
beforeEach(() => { mocks.user++; mocks.logs.clear(); vi.clearAllMocks(); mocks.generate.mockResolvedValue({ text: JSON.stringify({ transcript: 'کتنی منظوریاں باقی ہیں؟', question: 'How many approvals are pending?' }) }); });
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
  const result = await mocks.generate(options);
  if (result instanceof Response) return result;
  return Response.json({ ...JSON.parse(result.text), engine: 'faster-whisper', engineVersion: '1.2.1', policy: 'free-only', billingRequired: false,
    protocolVersion: 1, modelRevision: 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66' });
})); });
afterEach(() => vi.unstubAllGlobals());
const upload = (body = wav(), requestId = crypto.randomUUID()) => request(app).post('/tenants/tenant-a/workforce/transcribe').set('Authorization', 'Bearer test').set('Content-Type', 'audio/wav').set('x-voice-request-id', requestId).send(body);

describe('voice upload trust boundary', () => {
  it('requires authentication, tenant isolation and read permission before transcription', async () => {
    expect((await request(app).post('/tenants/tenant-a/workforce/transcribe').send('x')).status).toBe(401);
    expect((await request(app).post('/tenants/tenant-b/workforce/transcribe').set('Authorization', 'Bearer test').send('x')).status).toBe(403);
    expect((await upload().set('x-no-permission', '1')).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('rejects incorrect types, absent IDs, malformed WAV, empty and silent audio', async () => {
    expect((await upload().set('Content-Type', 'audio/mp4')).status).toBe(415);
    expect((await upload().set('x-voice-request-id', 'bad')).status).toBe(400);
    expect((await upload(Buffer.from('not audio'))).status).toBe(400);
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
    expect((await upload(wav(1, true))).status).toBe(422);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('enforces bytes, canonical format, declared length and duration before the provider', async () => {
    expect((await upload(Buffer.alloc(5 * 1024 * 1024 + 1))).status).toBe(413);
    expect(() => validateVoiceWav(wav(61))).toThrow('between 1 and 60');
    expect(() => validateVoiceWav(wav(0.1))).toThrow('between 1 and 60');
    const mismatched = wav(); mismatched.writeUInt32LE(100, 40);
    expect(() => validateVoiceWav(mismatched)).toThrow('invalid');
    const stereo = wav(); stereo.writeUInt16LE(2, 22);
    expect(() => validateVoiceWav(stereo)).toThrow('invalid');
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('transcribes multilingual speech and supplies a reviewable English routing question', async () => {
    const result = await upload(); expect(result.status).toBe(200);
    expect(result.body.data).toEqual({ transcript: 'کتنی منظوریاں باقی ہیں؟', question: 'How many approvals are pending?', durationSeconds: 1 });
    expect(result.headers['cache-control']).toBe('no-store');
    const input = mocks.generate.mock.calls[0][0];
    expect(input.headers['Content-Type']).toBe('audio/wav');
    expect(input.headers['X-Voice-Payment-Policy']).toBe('free-only');
    expect(Buffer.from(input.body)).toEqual(wav());
    expect(input.redirect).toBe('error');
  });
  it('replays a successful upload without calling the local worker twice and does not store audio', async () => {
    const id = crypto.randomUUID(); const first = await upload(wav(), id); const second = await upload(wav(), id);
    expect(first.status).toBe(200); expect(second.body.data).toEqual(first.body.data); expect(mocks.generate).toHaveBeenCalledOnce();
    expect(JSON.stringify([...mocks.logs.values()])).not.toContain('base64');
    expect(vi.mocked(IdempotencyService.logSuccess).mock.calls[0][2]).toEqual(first.body.data);
  });
  it('rejects a retry while transcription is pending without running a second provider call', async () => {
    const id = crypto.randomUUID(); let complete!: (value: any) => void;
    mocks.generate.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = transcribeVoiceQuestion('tenant-a', 'user', id, wav());
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledOnce());
    await expect(transcribeVoiceQuestion('tenant-a', 'user', id, wav())).rejects.toMatchObject({ statusCode: 409, code: 'VOICE_IN_PROGRESS' });
    complete({ text: JSON.stringify({ transcript: 'Pending approvals?', question: 'Pending approvals?' }) }); await pending;
    expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it('returns a safe connection failure and allows an explicit retry of the same recording', async () => {
    mocks.generate.mockRejectedValueOnce(new Error('secret-key audio base64 private details'));
    const id = crypto.randomUUID(); const result = await upload(wav(), id);
    expect(result.status).toBe(503); expect(result.text).not.toContain('secret-key');
    expect((await upload(wav(), id)).status).toBe(200); expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  it('recovers from a busy worker only when the user explicitly retries', async () => {
    mocks.generate.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    const id = crypto.randomUUID();
    expect((await upload(wav(), id)).status).toBe(503);
    expect(mocks.generate).toHaveBeenCalledOnce();
    const result = await upload(wav(), id);
    expect(result.status).toBe(200); expect(result.body.data.question).toBe('How many approvals are pending?');
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  it('makes no automatic calls while the worker remains unavailable', async () => {
    mocks.generate.mockRejectedValue(Object.assign(new Error('Private provider details'), { status: 503 }));
    const result = await upload();
    expect(result.status).toBe(503);
    expect(result.text).not.toContain('Private provider details');
    expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it('keeps payment-required failures blocked on replay without another worker call', async () => {
    mocks.generate.mockResolvedValueOnce(Response.json({}, { status: 402 }));
    const id = crypto.randomUUID();
    const first = await upload(wav(), id), replay = await upload(wav(), id);
    expect(first.status).toBe(402); expect(replay.status).toBe(402);
    expect(replay.body.error.code).toBe('VOICE_PAID_UPGRADE_BLOCKED');
    expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it.each([400, 401, 403])('does not automatically retry a rejected worker request (%s)', async status => {
    mocks.generate.mockResolvedValueOnce(Response.json({ error: 'Private provider details' }, { status }));
    expect((await upload()).status).toBe(503);
    expect(mocks.generate).toHaveBeenCalledOnce();
  });
  it.each(['{}', '{"transcript":"","question":""}', JSON.stringify({ transcript: 'x'.repeat(2001), question: 'x' })])('rejects unusable model output', async text => {
    mocks.generate.mockResolvedValueOnce({ text }); await expect(recognizeVoice(wav())).rejects.toMatchObject({ statusCode: 422 });
  });
  it('limits transcription requests per signed-in user', async () => {
    for (let i = 0; i < 6; i++) expect((await upload()).status).toBe(200);
    expect((await upload()).status).toBe(429); expect(mocks.generate).toHaveBeenCalledTimes(6);
  });
});
