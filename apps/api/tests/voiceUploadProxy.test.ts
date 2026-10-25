import { beforeEach, expect, it, vi } from 'vitest';
import { encodeVoiceWav } from '../../web/lib/voice-audio';
import { validateVoiceWav } from '../src/services/voiceQuestionService';
const mocks = vi.hoisted(() => ({ token: 'test-session', fetch: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => mocks.token ? { value: mocks.token } : undefined }) }));
vi.mock('@/lib/backend-url', () => ({ backendUrl: (path: string) => `https://api.example.test${path}` }));
import { POST } from '../../web/app/api/voice/transcribe/route';
beforeEach(() => { mocks.token = 'test-session'; vi.stubGlobal('fetch', mocks.fetch); mocks.fetch.mockReset().mockResolvedValue(new Response('{"success":true,"data":{"transcript":"Hello","question":"Hello"}}')); });
const voiceRequest = (body: BodyInit = new Uint8Array([1, 2, 3]), headers: Record<string, string> = {}) => new Request('https://web.example.test/api/voice/transcribe?tenantId=tenant-a', { method: 'POST', headers: { origin: 'https://web.example.test', 'content-type': 'audio/wav', 'x-voice-request-id': 'c09a7740-9415-4937-9a24-478992966189', ...headers }, body });
it('produces browser PCM WAV that passes the independent server validator', async () => {
  const samples = Float32Array.from({ length: 32000 }, (_, i) => Math.sin(i / 20) * .2);
  const blob = encodeVoiceWav(samples);
  expect(blob.type).toBe('audio/wav');
  expect(validateVoiceWav(Buffer.from(await blob.arrayBuffer()))).toBe(2);
});
it('clamps clipping and non-finite samples safely', async () => {
  const buffer = Buffer.from(await encodeVoiceWav(new Float32Array([-2, 2, NaN])).arrayBuffer());
  expect(buffer.readInt16LE(44)).toBe(-32768); expect(buffer.readInt16LE(46)).toBe(32767); expect(buffer.readInt16LE(48)).toBe(0);
});
it('requires a session and rejects foreign origins before forwarding audio', async () => {
  mocks.token = ''; expect((await POST(voiceRequest())).status).toBe(401);
  mocks.token = 'test-session'; expect((await POST(voiceRequest(undefined, { origin: 'https://attacker.test' }))).status).toBe(403);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('validates MIME type, request IDs and advertised size before reading the body', async () => {
  expect((await POST(voiceRequest(undefined, { 'content-type': 'application/json' }))).status).toBe(415);
  expect((await POST(voiceRequest(undefined, { 'x-voice-request-id': 'bad' }))).status).toBe(400);
  expect((await POST(voiceRequest(undefined, { 'content-length': String(6 * 1024 * 1024) }))).status).toBe(413);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('enforces the streamed body limit even without a Content-Length header', async () => {
  expect((await POST(voiceRequest(new Uint8Array(5 * 1024 * 1024 + 1)))).status).toBe(413);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it('forwards unchanged binary audio with server session credentials and request identity', async () => {
  const result = await POST(voiceRequest()); expect(result.status).toBe(200);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  const [url, options] = mocks.fetch.mock.calls[0];
  expect(url).toBe('https://api.example.test/api/v1/tenants/tenant-a/workforce/transcribe');
  expect(options.headers.Authorization).toBe('Bearer test-session'); expect(options.body).toEqual(Buffer.from([1, 2, 3]));
  expect(result.headers.get('cache-control')).toBe('no-store');
});
it('hides internal proxy failures and preserves backend rejection status', async () => {
  mocks.fetch.mockRejectedValueOnce(new Error('private backend url and token'));
  const result = await POST(voiceRequest()); expect(result.status).toBe(502); expect(await result.text()).not.toContain('private');
  mocks.fetch.mockResolvedValueOnce(new Response('{"success":false}', { status: 403 }));
  expect((await POST(voiceRequest())).status).toBe(403);
});
it('shows the paid-upgrade block without forwarding a payment redirect', async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ success: false, error: { code: 'VOICE_PAID_UPGRADE_BLOCKED', message: 'Paid voice upgrades are disabled.' } }, { status: 402, headers: { Location: 'https://payment.example.test' } }));
  const response = await POST(voiceRequest());
  expect(response.status).toBe(402);
  expect(response.headers.has('location')).toBe(false);
  expect((await response.json()).error.code).toBe('VOICE_PAID_UPGRADE_BLOCKED');
});
