// Exercise built Next.js route handlers over HTTP against an isolated API fixture.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];
const api = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  calls.push({ path: req.url, method: req.method });
  res.setHeader('Content-Type', 'application/json');
  if (['/api/v1/auth/login', '/api/v1/auth/register'].includes(req.url)) {
    res.end(JSON.stringify({ success: true, data: { token: 'smoke-session', user: { id: 'smoke-user' }, tenant: { id: 'smoke-tenant' } } }));
  } else if (req.url === '/api/v1/auth/me' && req.headers.authorization === 'Bearer smoke-session') {
    res.end(JSON.stringify({ success: true, data: { userId: 'smoke-user', tenantId: 'smoke-tenant' } }));
  } else if (req.url === '/api/v1/fixture') {
    res.end(JSON.stringify({ bytes: Buffer.concat(chunks).toString('hex'), authorization: req.headers.authorization, signature: req.headers['x-hub-signature-256'], idempotency: req.headers['idempotency-key'] }));
  } else { res.statusCode = 401; res.end(JSON.stringify({ success: false })); }
});
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const apiPort = await listen(api);
const probe = http.createServer();
const webPort = await listen(probe);
await new Promise(resolve => probe.close(resolve));
let output = '';
const standalone = process.env.SMOKE_STANDALONE === '1';
const command = standalone
  ? [path.join(root, 'apps/web/.next/standalone/apps/web/server.js')]
  : [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(webPort), '-H', '127.0.0.1'];
const web = spawn(process.execPath, command, {
  cwd: path.join(root, 'apps/web'), windowsHide: true,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(webPort), HOSTNAME: '127.0.0.1', API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`, API_URL: `http://127.0.0.1:${apiPort}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
web.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); });
web.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
const origin = `http://127.0.0.1:${webPort}`;
async function request(route, options = {}) {
  return fetch(`${origin}${route}`, { ...options, redirect: 'manual', signal: AbortSignal.timeout(30000) });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (web.exitCode !== null) throw new Error(`Web server exited: ${output}`);
    try { if ((await request('/api/auth/me')).status === 401) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, `Web server did not become ready: ${output}`);
  for (const endpoint of ['register', 'login']) {
    const response = await request(`/api/auth/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantName: 'Smoke fixture', email: 'fixture@acme.test', password: 'fixture-only' }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /token=smoke-session/);
    for (const attribute of [/HttpOnly/i, /Secure/i, /SameSite=lax/i]) assert.match(cookie, attribute);
    assert.equal((await response.json()).data.token, undefined);
  }
  const session = await request('/api/auth/me', { headers: { Cookie: 'token=smoke-session' } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).data.userId, 'smoke-user');
  assert.equal((await request('/api/health')).status, 200);
  for (const route of ['/api/v1/auth/me', '/api/proxy/auth/me']) {
    const proxied = await request(route, { headers: { Cookie: 'token=smoke-session' } });
    assert.equal(proxied.status, 200);
    assert.equal((await proxied.json()).data.userId, 'smoke-user');
  }
  const transport = await request('/api/v1/fixture', { method: 'POST', headers: { Authorization: 'Bearer explicit-session', 'X-Hub-Signature-256': 'sha256=fixture', 'Idempotency-Key': 'fixture-id', 'Content-Type': 'application/octet-stream' }, body: new Uint8Array([0, 255, 17, 128]) });
  assert.equal(transport.status, 200);
  assert.deepEqual(await transport.json(), { bytes: '00ff1180', authorization: 'Bearer explicit-session', signature: 'sha256=fixture', idempotency: 'fixture-id' });
  const protectedPage = await request('/dashboard');
  assert.equal(protectedPage.status, 307);
  assert.equal(new URL(protectedPage.headers.get('location'), origin).pathname, '/login');
  assert.deepEqual(calls, [
    { path: '/api/v1/auth/register', method: 'POST' },
    { path: '/api/v1/auth/login', method: 'POST' },
    { path: '/api/v1/auth/me', method: 'GET' },
    { path: '/api/v1/auth/me', method: 'GET' },
    { path: '/api/v1/auth/me', method: 'GET' },
    { path: '/api/v1/fixture', method: 'POST' },
  ]);
  console.log(JSON.stringify({ passed: true, check: 'built-web-auth-http', standalone, registration: true, login: true, session: true, runtimeProxy: true, secureCookies: true, protectedPageRedirect: true, backend: 'isolated fixture on a non-default port' }, null, 2));
} finally {
  web.kill();
  await new Promise(resolve => api.close(resolve));
}
