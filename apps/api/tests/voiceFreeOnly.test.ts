import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), paid: vi.fn(), env: {
  JWT_SECRET: 'test-only-voice-worker-signing-key', GEMINI_API_KEY: 'must-never-be-used',
  VOICE_TRANSCRIBER_URL: 'http://127.0.0.1:8091',
  VOICE_TRANSCRIPTION_PROVIDER: 'self-hosted-whisper', VOICE_PAYMENT_POLICY: 'free-only',
  VOICE_WORKER_AUTH_KEY: undefined as string | undefined,
} }));
vi.mock('../src/config/env', () => ({ env: mocks.env }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { models = { generateContent: mocks.paid }; } }));
import { recognizeVoice } from '../src/services/voiceQuestionService';

const audio = Buffer.from('fixture-audio');
const localResponse = { transcript: 'Pending approvals?', question: 'Pending approvals?',
  engine: 'faster-whisper', engineVersion: '1.2.1', policy: 'free-only', billingRequired: false, protocolVersion: 1,
  modelRevision: 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.env.VOICE_TRANSCRIPTION_PROVIDER = 'self-hosted-whisper';
  mocks.env.VOICE_PAYMENT_POLICY = 'free-only';
  mocks.env.VOICE_TRANSCRIBER_URL = 'http://127.0.0.1:8091';
  mocks.env.VOICE_WORKER_AUTH_KEY = undefined;
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(Response.json(localResponse));
});
afterEach(() => vi.unstubAllGlobals());

describe('Self-hosted voice payment lock', () => {
  it('uses only the authenticated local worker and returns its transcript', async () => {
    await expect(recognizeVoice(audio)).resolves.toEqual({ transcript: localResponse.transcript, question: localResponse.question });
    expect(mocks.paid).not.toHaveBeenCalled();
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8091/transcribe');
    expect(Buffer.from(options.body)).toEqual(audio);
    expect(options.redirect).toBe('error');
    const key = createHmac('sha256', mocks.env.JWT_SECRET).update('ai-workforce:voice-worker:v1').digest();
    const claims = jwt.verify(options.headers.Authorization.slice(7), key, { audience: 'voice-worker', issuer: 'ai-workforce-api', algorithms: ['HS256'] }) as jwt.JwtPayload;
    expect(claims.audioSha256).toBe(createHash('sha256').update(audio).digest('hex'));
    expect(claims.policy).toBe('free-only');
  });
  it.each(['gemini', 'openai', 'auto', 'paid'])('blocks provider configuration %s before sending audio', async provider => {
    mocks.env.VOICE_TRANSCRIPTION_PROVIDER = provider;
    await expect(recognizeVoice(audio)).rejects.toMatchObject({ statusCode: 402, code: 'VOICE_PAID_UPGRADE_BLOCKED' });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.paid).not.toHaveBeenCalled();
  });
  it('supports a dedicated voice key without sharing the application signing key with the worker', async () => {
    mocks.env.VOICE_WORKER_AUTH_KEY = 'cd'.repeat(32);
    await recognizeVoice(audio);
    const token = mocks.fetch.mock.calls[0][1].headers.Authorization.slice(7);
    expect(() => jwt.verify(token, Buffer.from('cd'.repeat(32), 'hex'), { algorithms: ['HS256'], audience: 'voice-worker' })).not.toThrow();
  });
  it.each(['http://public.example.test', 'https://user:password@worker.example.test', 'https://worker.example.test/path', 'https://worker.example.test/?plan=paid'])('rejects unsafe worker origins before sending audio: %s', async origin => {
    mocks.env.VOICE_TRANSCRIBER_URL = origin;
    await expect(recognizeVoice(audio)).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('cannot enable paid voice by changing the policy setting', async () => {
    mocks.env.VOICE_PAYMENT_POLICY = 'paid';
    await expect(recognizeVoice(audio)).rejects.toMatchObject({ code: 'VOICE_PAID_UPGRADE_BLOCKED' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('blocks a worker payment-required response without a fallback', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: 'Private payment details' }, { status: 402 }));
    await expect(recognizeVoice(audio)).rejects.toMatchObject({ statusCode: 402, code: 'VOICE_PAID_UPGRADE_BLOCKED' });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.paid).not.toHaveBeenCalled();
  });
  it.each([
    { billingRequired: true }, { policy: 'paid' }, { engine: 'hosted-api' },
    { modelRevision: 'unreviewed-model-upgrade' }, { protocolVersion: 2 },
    { engineVersion: 'paid-version-upgrade' },
  ])('rejects a changed engine/payment/model contract: %j', async change => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ ...localResponse, ...change }));
    await expect(recognizeVoice(audio)).rejects.toMatchObject({ code: 'VOICE_PAID_UPGRADE_BLOCKED' });
    expect(mocks.paid).not.toHaveBeenCalled();
  });
  it('fails safely when the worker is unavailable instead of charging another provider', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('Private endpoint and credentials'));
    await expect(recognizeVoice(audio)).rejects.toMatchObject({ statusCode: 503, code: 'VOICE_UNAVAILABLE' });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.paid).not.toHaveBeenCalled();
  });
});
