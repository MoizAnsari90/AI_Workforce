import { cookies } from 'next/headers';
import { backendUrl } from '@/lib/backend-url';

export const runtime = 'nodejs';
const MAX_BYTES = 5 * 1024 * 1024;
const fail = (message: string, status: number) => Response.json({ success: false, error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const token = (await cookies()).get('token')?.value;
  if (!token) return fail('Sign in before sending a voice question.', 401);
  const url = new URL(req.url);
  if (req.headers.get('origin') && req.headers.get('origin') !== url.origin) return fail('Voice upload origin is not allowed.', 403);
  const tenantId = url.searchParams.get('tenantId') || '';
  const requestId = req.headers.get('x-voice-request-id') || '';
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tenantId) || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestId)) return fail('Invalid voice request.', 400);
  if (req.headers.get('content-type') !== 'audio/wav') return fail('Only WAV voice recordings are accepted.', 415);
  if (Number(req.headers.get('content-length')) > MAX_BYTES) return fail('Recording is too large. Record up to 60 seconds.', 413);
  if (!req.body) return fail('Recording is empty.', 400);
  try {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) { await reader.cancel(); return fail('Recording is too large. Record up to 60 seconds.', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const response = await fetch(backendUrl(`/api/v1/tenants/${tenantId}/workforce/transcribe`), {
      method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.any([req.signal, AbortSignal.timeout(24000)]),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav', 'x-voice-request-id': requestId },
      body: Buffer.concat(chunks),
    });
    return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return fail('Voice upload could not be confirmed. Retry the same recording or type your question.', 502);
  }
}
