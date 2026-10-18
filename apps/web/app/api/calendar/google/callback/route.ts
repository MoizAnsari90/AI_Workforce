import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendUrl } from '@/lib/backend-url';

// Google returns to the frontend origin so the initiating user's HttpOnly session
// can authenticate completion. The API also checks the one-use state against that user.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const finish = (result: string) => {
    const response = NextResponse.redirect(new URL(`/dashboard/settings/business?calendar=${result}`, url.origin));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  if (url.searchParams.has('error')) return finish('cancelled');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || code.length > 4096 || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return finish('invalid');
  const token = (await cookies()).get('token')?.value;
  if (!token) return finish('session_expired');
  try {
    const result = await fetch(backendUrl('/api/v1/calendar/google/complete'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ code, state }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25_000) });
    return finish(result.ok ? 'connected' : 'failed');
  } catch { return finish('failed'); }
}
