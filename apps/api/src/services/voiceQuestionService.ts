import { z } from 'zod';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { AppError, ServiceUnavailableError } from '../errors/AppError';
import { IdempotencyService } from './idempotencyService';

export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 60;
const resultSchema = z.object({ transcript: z.string().trim().min(1).max(2000), question: z.string().trim().min(1).max(2000) }).strict();
export const VOICE_MODEL_REVISION = 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66';
export const VOICE_ENGINE_VERSION = '1.2.1';
const workerPolicy = z.object({ engine: z.literal('faster-whisper'), policy: z.literal('free-only'),
  engineVersion: z.literal(VOICE_ENGINE_VERSION), billingRequired: z.literal(false), protocolVersion: z.literal(1), modelRevision: z.literal(VOICE_MODEL_REVISION) });
const paidBlocked = () => new AppError('Voice is locked to the free self-hosted engine. Paid providers and automatic upgrades are disabled.', 402, 'VOICE_PAID_UPGRADE_BLOCKED');

/** Accept only our canonical mono 16-bit 16kHz WAV, including a server-verified duration. */
export function validateVoiceWav(audio: Buffer): number {
  if (audio.length > VOICE_MAX_BYTES) throw new AppError('Recording is too large. Record up to 60 seconds.', 413, 'VOICE_TOO_LARGE');
  const invalid = () => new AppError('Recording is invalid. Please record again.', 400, 'INVALID_VOICE_AUDIO');
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE' ||
      audio.toString('ascii', 12, 16) !== 'fmt ' || audio.readUInt32LE(16) !== 16 || audio.readUInt16LE(20) !== 1 ||
      audio.readUInt16LE(22) !== 1 || audio.readUInt32LE(24) !== 16000 || audio.readUInt32LE(28) !== 32000 ||
      audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16 || audio.toString('ascii', 36, 40) !== 'data' ||
      audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(40) !== audio.length - 44 || (audio.length - 44) % 2) throw invalid();
  const seconds = (audio.length - 44) / 32000;
  if (seconds < 0.3 || seconds > VOICE_MAX_SECONDS + 0.25) throw new AppError('Record between 1 and 60 seconds.', 400, 'VOICE_DURATION');
  // Reject silent buffers before invoking the local speech engine.
  let energy = 0;
  for (let index = 44; index < audio.length; index += 2) energy += (audio.readInt16LE(index) / 32768) ** 2;
  if (Math.sqrt(energy / ((audio.length - 44) / 2)) < 0.0001) throw new AppError('No speech was detected. Please record again.', 422, 'VOICE_NO_SPEECH');
  return seconds;
}

export async function recognizeVoice(audio: Buffer) {
  if (env.VOICE_TRANSCRIPTION_PROVIDER !== 'self-hosted-whisper' || env.VOICE_PAYMENT_POLICY !== 'free-only') throw paidBlocked();
  try {
    const origin = new URL(env.VOICE_TRANSCRIBER_URL || (env.NODE_ENV !== 'production' ? 'http://127.0.0.1:8091' : ''));
    const local = ['127.0.0.1', 'localhost', '[::1]', 'voice-transcriber'].includes(origin.hostname);
    if ((!local && origin.protocol !== 'https:') || !['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      throw new ServiceUnavailableError('Configure a secure self-hosted voice service origin.');
    }
    const signingKey = env.VOICE_WORKER_AUTH_KEY ? Buffer.from(env.VOICE_WORKER_AUTH_KEY, 'hex')
      : crypto.createHmac('sha256', env.JWT_SECRET).update('ai-workforce:voice-worker:v1').digest();
    const token = jwt.sign({ policy: 'free-only', audioSha256: crypto.createHash('sha256').update(audio).digest('hex') }, signingKey,
      { algorithm: 'HS256', issuer: 'ai-workforce-api', audience: 'voice-worker', expiresIn: 60, jwtid: crypto.randomUUID() });
    const response = await fetch(`${origin.origin}/transcribe`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(110000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav', 'X-Voice-Payment-Policy': 'free-only' }, body: new Uint8Array(audio),
    });
    if (response.status === 402) throw paidBlocked();
    if (!response.ok) {
      if (response.status === 422) throw new AppError('No clear speech was detected. Please record again or type your question.', 422, 'VOICE_NO_SPEECH');
      throw new AppError('The free voice service is unavailable or busy. Please retry your recording or type your question.', 503, 'VOICE_UNAVAILABLE');
    }
    // Bound the response and validate the pinned free-only contract before accepting text.
    if (Number(response.headers.get('content-length')) > 32768) throw paidBlocked();
    const reader = response.body?.getReader();
    if (!reader) throw paidBlocked();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 32768) { await reader.cancel(); throw paidBlocked(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!workerPolicy.safeParse(parsed).success) throw paidBlocked();
    const result = resultSchema.safeParse({ transcript: parsed.transcript, question: parsed.question });
    if (!result.success) throw new AppError('No clear speech was detected. Please record again or type your question.', 422, 'VOICE_NO_SPEECH');
    return result.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    // No cloud-provider fallback, request details, credentials, or recorded audio.
    throw new AppError('The free voice service is unavailable. Please retry your recording or type your question.', 503, 'VOICE_UNAVAILABLE');
  }
}

export async function transcribeVoiceQuestion(tenantId: string, userId: string, requestId: string, audio: Buffer) {
  const seconds = validateVoiceWav(audio);
  const targetResource = `voice:${userId}:${requestId}`;
  const hash = crypto.createHash('sha256').update(audio).digest('hex');
  const generated = await IdempotencyService.generateIdempotencyKey({ tenantId, actionType: 'voice_transcription', targetResource, requestData: hash });
  const replay = (previous: Awaited<ReturnType<typeof IdempotencyService.checkIdempotency>>) => {
    if (previous?.status === 'succeeded' && previous.responseSnapshot) return previous.responseSnapshot;
    if (previous?.errorMessage === 'voice:paid-blocked') throw paidBlocked();
    if (previous?.status === 'failed') throw new AppError('This recording could not be transcribed. Record again or type your question.', 409, 'VOICE_FAILED');
    throw new AppError('This recording is still being transcribed. Please wait, then retry the same recording.', 409, 'VOICE_IN_PROGRESS');
  };
  let retryClaimed = false;
  if (generated.idempotencyLog) {
    if (generated.idempotencyLog.status !== 'failed' || !['voice:retryable', 'Voice transcription failed'].includes(generated.idempotencyLog.errorMessage || '')) return replay(generated.idempotencyLog);
    retryClaimed = await IdempotencyService.retryVoiceTranscription(generated.key);
    if (!retryClaimed) return replay(await IdempotencyService.checkIdempotency(generated.key));
  }
  try { if (!retryClaimed) await IdempotencyService.createPendingLog(generated.key, tenantId, 'voice_transcription', targetResource); }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    return replay(await IdempotencyService.checkIdempotency(generated.key));
  }
  try {
    const recognized = await recognizeVoice(audio);
    const result = { ...recognized, durationSeconds: Math.round(seconds * 10) / 10 };
    // Cache only the transcript/translation; never write the raw audio to disk or database.
    await IdempotencyService.logSuccess(generated.key, targetResource, result);
    return result;
  } catch (error) {
    const reason = error instanceof AppError && error.code === 'VOICE_UNAVAILABLE' ? 'voice:retryable'
      : error instanceof AppError && error.code === 'VOICE_PAID_UPGRADE_BLOCKED' ? 'voice:paid-blocked' : 'voice:rejected';
    await IdempotencyService.logFailure(generated.key, reason).catch(() => undefined);
    throw error;
  }
}
