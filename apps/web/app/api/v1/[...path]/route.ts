import { cookies } from 'next/headers';
import { backendUrl } from '@/lib/backend-url';
import { isSameOriginRequest } from '@/lib/csrf';

type Context = { params: Promise<{ path: string[] }> };

// Preserve the previous rewrite's HTTP contract while selecting the backend at runtime.
async function proxy(request: Request, context: Context) {
  try {
    const { path } = await context.params;
    const target = backendUrl(`/api/v1/${path.map(encodeURIComponent).join('/')}${new URL(request.url).search}`);
    const headers = new Headers();
    for (const name of ['content-type', 'authorization', 'origin', 'idempotency-key', 'x-idempotency-key', 'x-tenant-id', 'x-hub-signature-256', 'stripe-signature', 'x-shopify-hmac-sha256']) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    if (!headers.has('authorization')) {
      const token = (await cookies()).get('token')?.value;
      if (token && !['GET', 'HEAD'].includes(request.method) && !isSameOriginRequest(request)) {
        return Response.json({ success: false }, { status: 403 });
      }
      if (token) headers.set('authorization', `Bearer ${token}`);
    }
    const response = await fetch(target, {
      method: request.method, headers,
      ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}),
      cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(25000),
    });
    const outgoing = new Headers(response.headers);
    // Node fetch decompresses response bodies; do not forward stale encoding/length.
    for (const name of ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-encoding', 'content-length']) outgoing.delete(name);
    outgoing.set('Cache-Control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: outgoing });
  } catch {
    return Response.json({ success: false, error: { message: 'Backend service is unavailable' } }, { status: 502 });
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
