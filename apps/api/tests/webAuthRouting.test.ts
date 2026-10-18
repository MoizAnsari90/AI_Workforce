import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const cookie = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => cookie }));
import { POST as login } from '../../web/app/api/auth/login/route';
import { POST as register } from '../../web/app/api/auth/register/route';
import { GET as me } from '../../web/app/api/auth/me/route';
import { backendUrl } from '../../web/lib/backend-url';

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('API_INTERNAL_URL', 'http://api:3001'); vi.stubEnv('NEXT_PUBLIC_API_URL', ''); cookie.get.mockReturnValue({ value: 'session-token' }); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('Web authentication backend routing', () => {
  for (const [endpoint, handler] of [['login', login], ['register', register]] as const) {
    it(`${endpoint} uses the container API and sets a secure session cookie`, async () => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: { token: 'new-token', user: { id: 'user' }, tenant: { id: 'tenant' } } }));
      vi.stubGlobal('fetch', fetch);
      const response = await handler(new Request(`https://app.acme.test/api/auth/${endpoint}`, { method: 'POST', body: JSON.stringify({ email: 'user@acme.test', password: 'secret' }) }));
      expect(response.status).toBe(200);
      expect(fetch).toHaveBeenCalledWith(`http://api:3001/api/v1/auth/${endpoint}`, expect.objectContaining({ method: 'POST', cache: 'no-store', redirect: 'error' }));
      expect(cookie.set).toHaveBeenCalledWith('token', 'new-token', expect.objectContaining({ secure: true, httpOnly: true, sameSite: 'lax' }));
      expect(await response.json()).not.toHaveProperty('data.token');
    });
  }
  it('checks sessions against the configured API and clears rejected credentials', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: false }, { status: 401 })); vi.stubGlobal('fetch', fetch);
    expect((await me()).status).toBe(401);
    expect(fetch).toHaveBeenCalledWith('http://api:3001/api/v1/auth/me', expect.objectContaining({ headers: { Authorization: 'Bearer session-token' } }));
    expect(cookie.delete).toHaveBeenCalledWith('token');
  });
  it('rejects missing and malformed backend configuration in production', () => {
    vi.stubEnv('API_INTERNAL_URL', ''); vi.stubEnv('API_URL', '');
    expect(() => backendUrl('/api/v1/auth/me')).toThrow('API_INTERNAL_URL');
    vi.stubEnv('API_INTERNAL_URL', 'https://user:password@api.acme.test');
    expect(() => backendUrl('/api/v1/auth/me')).toThrow('origin');
  });
  it('supports the public Render origin alias while preferring the server-only origin', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://workforce-demo.onrender.com');
    expect(backendUrl('/health')).toBe('http://api:3001/health');
    vi.stubEnv('API_INTERNAL_URL', ''); vi.stubEnv('API_URL', '');
    expect(backendUrl('/health')).toBe('https://workforce-demo.onrender.com/health');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://workforce-demo.onrender.com/?token=secret');
    expect(() => backendUrl('/health')).toThrow('origin');
  });
});
