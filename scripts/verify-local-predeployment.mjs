// Real PostgreSQL/Redis/API/Next.js rehearsal. No GCP calls, customer messaging or worker jobs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { io } from 'socket.io-client';
import { root, sourceEnvironment, prepareKeys, localDatabaseUrl, redisUrl } from './predeployment-config.mjs';

const report = { timestamp: new Date().toISOString(), passed: false, checks: {}, errors: [], cleanup: {} };
const source = sourceEnvironment();
const children = [];
let admin, redis, database, redisDatabase, ownsRedis = false;
const marker = `predeployment:owner:${randomBytes(12).toString('hex')}`;
const identity = randomBytes(10).toString('hex');
const advertisedWeb = 'https://web.predeployment.test';
const advertisedApi = 'https://api.predeployment.test';
let stage = 'configuration';

async function port() {
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return result;
}
function start(script, env, cwd) {
  const child = spawn(process.execPath, [script], { env, cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  child.on('error', () => {});
  children.push(child);
  return child;
}
async function request(url, options = {}) {
  return fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10000) });
}
async function ready(child, url, expected) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Process exited before readiness');
    try { if ((await request(url)).status === expected) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Readiness deadline exceeded');
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 10000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}
async function socketConnect(origin, browserOrigin, token) {
  return new Promise(resolve => {
    const socket = io(origin, { autoConnect: false, reconnection: false, timeout: 5000, transports: ['websocket'], extraHeaders: { Origin: browserOrigin }, auth: token ? { token } : {} });
    const timer = setTimeout(() => finish(false), 7000);
    function finish(connected) { clearTimeout(timer); socket.removeAllListeners(); socket.disconnect(); resolve(connected); }
    socket.once('connect', () => finish(true));
    socket.once('connect_error', () => finish(false));
    socket.connect();
  });
}

try {
  const keys = prepareKeys();
  const target = localDatabaseUrl(source);
  const adminUrl = new URL(target); adminUrl.pathname = '/postgres';
  admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } }, log: [] });
  stage = 'database provisioning';
  const exists = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = 'ai_workforce_predeployment'`;
  if (!exists.length) await admin.$executeRawUnsafe('CREATE DATABASE "ai_workforce_predeployment"');
  report.checks.databaseIsolation = { passed: true, database: 'ai_workforce_predeployment', applicationDatabaseUntouched: true };

  stage = 'Redis readiness/isolation';
  const redisTarget = new URL(redisUrl(source));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(redisTarget.hostname), 'Only local Redis is allowed for this rehearsal');
  redis = new Redis(redisTarget.toString(), { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null, connectTimeout: 5000 });
  redis.on('error', () => {});
  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');
  // Use only an entirely empty non-default DB, excluding the regression-suite DB (15).
  for (let candidate = 14; candidate >= 1; candidate--) {
    await redis.select(candidate);
    if (await redis.dbsize() === 0) { redisDatabase = candidate; break; }
  }
  assert.ok(redisDatabase, 'No empty isolated Redis database is available');
  await redis.set(marker, identity);
  ownsRedis = true;
  redisTarget.pathname = `/${redisDatabase}`;
  report.checks.redis = { passed: true, isolatedDatabase: redisDatabase, ping: true, existingDataNotFlushed: true };

  stage = 'Prisma migration deployment';
  const migrationEnv = { ...source, ...keys, DATABASE_URL: target.toString(), NODE_ENV: 'development' };
  const migration = spawnSync(process.execPath, [path.join(root, 'scripts/run-migrations.cjs')], { env: migrationEnv, cwd: root, encoding: 'utf8', timeout: 180000, windowsHide: true });
  assert.equal(migration.status, 0, 'Prisma migration command failed (credential-bearing output suppressed)');
  database = new PrismaClient({ datasources: { db: { url: target.toString() } }, log: [] });
  const migrations = await database.$queryRaw`SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  report.checks.migrations = { passed: true, applied: migrations[0].count };

  const apiPort = await port(); const webPort = await port();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const runtime = {
    ...source, ...keys, NODE_ENV: 'production', DATABASE_URL: target.toString(), DIRECT_DATABASE_URL: '',
    REDIS_URL: redisTarget.toString(), REDIS_DB: String(redisDatabase), PORT: String(apiPort),
    WEB_APP_URL: advertisedWeb, PUBLIC_API_URL: advertisedApi, CORS_ORIGINS: advertisedWeb,
    META_APP_SECRET: randomBytes(32).toString('hex'), META_VERIFY_TOKEN: randomBytes(32).toString('hex'),
    BACKGROUND_WORKERS_ENABLED: 'false', BILLING_MODE: 'disabled', BILLING_ENFORCEMENT: 'false',
    TRUST_PROXY_HOPS: '', LOG_LEVEL: 'error',
  };
  stage = 'production API readiness';
  const api = start(path.join(root, 'apps/api/dist/index.js'), runtime, path.join(root, 'apps/api'));
  await ready(api, `${apiOrigin}/health`, 200);
  const health = await (await request(`${apiOrigin}/health`)).json();
  assert.equal(health.checks.database, true); assert.equal(health.checks.redis, true);
  assert.equal((await request(`${apiOrigin}/livez`)).status, 200);
  report.checks.health = { passed: true, database: true, redis: true, liveness: true, dynamicPort: true, productionMode: true };

  stage = 'production frontend readiness';
  // Match the Docker runner: Next standalone tracing does not copy browser assets.
  const standaloneWeb = path.join(root, 'apps/web/.next/standalone/apps/web');
  for (const [from, to] of [['apps/web/.next/static', '.next/static'], ['apps/web/public', 'public']]) {
    const assets = path.join(root, from);
    if (fs.existsSync(assets)) fs.cpSync(assets, path.join(standaloneWeb, to), { recursive: true });
  }
  const web = start(path.join(root, 'apps/web/.next/standalone/apps/web/server.js'), { ...runtime, PORT: String(webPort), HOSTNAME: '127.0.0.1', API_INTERNAL_URL: apiOrigin, API_URL: apiOrigin }, path.join(root, 'apps/web'));
  await ready(web, `${webOrigin}/api/health`, 200);
  assert.equal((await request(`${webOrigin}/dashboard`)).status, 307);
  for (const url of [`${apiOrigin}/api/v1/auth/me`, `${webOrigin}/api/auth/me`]) assert.equal((await request(url)).status, 401);

  stage = 'real registration/login/session';
  const account = { tenantName: `Predeployment ${identity}`, email: `predeployment-${identity}@example.test`, password: randomBytes(24).toString('base64url') };
  const json = { 'Content-Type': 'application/json' };
  const registered = await request(`${webOrigin}/api/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(account) });
  assert.equal(registered.status, 200);
  const data = await registered.json();
  assert.equal(data.data.token, undefined);
  const cookie = registered.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=lax/i);
  const login = await request(`${webOrigin}/api/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(login.status, 200);
  const loginCookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(loginCookie);
  const session = await request(`${webOrigin}/api/auth/me`, { headers: { Cookie: loginCookie } });
  assert.equal(session.status, 200);
  assert.equal((await request(`${webOrigin}/api/v1/auth/me`, { headers: { Cookie: loginCookie } })).status, 200);
  assert.equal((await request(`${apiOrigin}/api/v1/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: account.email, password: randomBytes(24).toString('hex') }) })).status, 401);
  report.checks.auth = { passed: true, actualDatabaseBackedRegistration: true, login: true, session: true, runtimeProxy: true, invalidPasswordRejected: true, secureCookieAttributes: true, protectedRedirect: true };

  stage = 'tenant isolation';
  const ownTenant = data.data.tenant.id;
  const otherAccount = { tenantName: `Other rehearsal ${identity}`, email: `other-${identity}@example.test`, password: randomBytes(24).toString('base64url') };
  const otherRegistered = await request(`${webOrigin}/api/auth/register`, { method: 'POST', headers: json, body: JSON.stringify(otherAccount) });
  assert.equal(otherRegistered.status, 200);
  const otherTenant = (await otherRegistered.json()).data.tenant.id;
  const ownHeaders = { ...json, Cookie: loginCookie };
  assert.equal((await request(`${webOrigin}/api/v1/tenants/${ownTenant}/tasks`, { headers: ownHeaders })).status, 200);
  const ownTask = await request(`${webOrigin}/api/v1/tenants/${ownTenant}/tasks`, { method: 'POST', headers: ownHeaders, body: JSON.stringify({ title: `Synthetic rehearsal ${identity}` }) });
  assert.equal(ownTask.status, 201);
  assert.equal((await request(`${webOrigin}/api/v1/tenants/${otherTenant}/tasks`, { headers: ownHeaders })).status, 403);
  assert.equal((await request(`${webOrigin}/api/v1/tenants/${otherTenant}/tasks`, { method: 'POST', headers: ownHeaders, body: JSON.stringify({ title: 'Rejected cross-tenant rehearsal task' }) })).status, 403);
  report.checks.tenantIsolation = { passed: true, ownReadAndWrite: true, foreignReadRejected: true, foreignWriteRejected: true, twoActualTenants: true };

  stage = 'Socket.IO authentication and origin enforcement';
  const socketToken = decodeURIComponent(loginCookie.slice(loginCookie.indexOf('=') + 1));
  assert.equal(await socketConnect(apiOrigin, advertisedWeb, socketToken), true);
  assert.equal(await socketConnect(apiOrigin, advertisedWeb), false);
  assert.equal(await socketConnect(apiOrigin, 'https://untrusted.invalid', socketToken), false);
  report.checks.socketIO = { passed: true, authenticatedWebSocket: true, missingTokenRejected: true, foreignOriginRejected: true };

  stage = 'CORS';
  const cors = await request(`${apiOrigin}/api/v1/auth/login`, { method: 'OPTIONS', headers: { Origin: advertisedWeb, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(cors.status, 204); assert.equal(cors.headers.get('access-control-allow-origin'), advertisedWeb);
  assert.equal((await request(`${apiOrigin}/api/v1/auth/me`, { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
  report.checks.cors = { passed: true, allowedOrigin: true, rejectedOrigin: true };
  if (process.argv.includes('--appearance-browser') || process.argv.includes('--language-browser') || process.argv.includes('--voice-browser') || process.argv.includes('--companion-browser')) {
    stage = 'appearance browser verification';
    const { checkAppearanceBrowser } = await import('./check-appearance-browser.mjs');
    const browser = await checkAppearanceBrowser({ origin: webOrigin, cookie: loginCookie, session: await session.json() });
    report.checks.appearanceBrowser = { passed: browser.passed, report: 'artifacts/appearance-browser.json' };
    assert.ok(browser.passed, 'Appearance browser checks failed');
  }
  report.passed = true;
} catch {
  // Do not log SDK/Prisma/process error objects, environment values or response bodies.
  report.errors.push({ stage, message: 'Verification failed; inspect this stage without exposing credentials.' });
} finally {
  for (const child of [...children].reverse()) await stop(child);
  if (redis) {
    try {
      if (ownsRedis && await redis.get(marker) === identity) {
        // Only metadata of the empty queue created by this rehearsal; never flush a DB.
        await redis.del('bull:whatsapp-incoming-queue:meta', marker);
        report.cleanup.redisMetadataRemoved = true;
      }
      await redis.quit();
    } catch { redis.disconnect(); report.cleanup.redisMetadataRemoved = false; }
  }
  await database?.$disconnect(); await admin?.$disconnect();
  report.cleanup.childProcessesStopped = true;
  report.note = 'Local rehearsal only: synthetic accounts retained in the isolated rehearsal database; workers disabled; no external connector actions. HTTP loopback does not certify public HTTPS/browser operation.';
  fs.writeFileSync(path.join(root, 'artifacts/predeployment-local-runtime.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
