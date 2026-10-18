// Exercise the built Linux images with synthetic credentials on an isolated network.
// The script creates/removes only its own labelled containers and network.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const images = {
  api: process.env.SMOKE_API_IMAGE || 'ai-workforce-api:local-check',
  web: process.env.SMOKE_WEB_IMAGE || 'ai-workforce-web:local-check',
  migration: process.env.SMOKE_MIGRATION_IMAGE || 'ai-workforce-migration:local-check',
};
const prefix = `ai-workforce-check-${process.pid}-${Date.now()}`;
const label = `ai-workforce.smoke=${prefix}`;
const base = path.join(root, '.local/gcp-container-smoke');
mkdirSync(base, { recursive: true });
const directory = mkdtempSync(path.join(base, 'run-'));
if (!directory.startsWith(base + path.sep)) throw new Error('Unexpected fixture directory');
const files = [];
const containers = [];
let network;
let cleaning;
const report = { timestamp: new Date().toISOString(), passed: false, images: {}, checks: {}, cleanupErrors: [] };

function docker(args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Arguments contain paths/identifiers, never credential payloads.
        reject(new Error(`Docker ${args[0]} failed: ${stderr || error.message}`));
      } else resolve(stdout.trim());
    });
  });
}
function envFile(name, values) {
  const file = path.join(directory, name);
  writeFileSync(file, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  files.push(file);
  return file;
}
async function start(name, args) {
  const container = `${prefix}-${name}`;
  // Track before creation so failed starts also get cleaned up.
  containers.push(container);
  return docker(['run', '-d', '--name', container, '--label', label, '--network', network, '--network-alias', name, ...args]);
}
async function wait(name, command) {
  const deadline = Date.now() + 120000;
  let lastFailure;
  for (let attempt = 0; attempt < 40 && Date.now() < deadline; attempt++) {
    try { await command(); return; } catch (error) { lastFailure = error; await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  throw new Error(`${name} did not become ready: ${lastFailure?.message || 'timeout'}`);
}
async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    for (const container of [...containers].reverse()) {
      try {
        const owned = await docker(['inspect', '--format', '{{index .Config.Labels "ai-workforce.smoke"}}', container], 15000);
        if (owned !== prefix) throw new Error('Fixture ownership label mismatch');
        await docker(['rm', '--force', container], 30000);
      } catch (error) {
        if (!/No such (object|container)/i.test(error.message)) report.cleanupErrors.push(error.message);
      }
    }
    if (network) {
      try { await docker(['network', 'rm', network], 30000); }
      catch (error) { report.cleanupErrors.push(error.message); }
    }
    for (const file of files) unlinkSync(file);
    rmdirSync(directory);
  })();
  return cleaning;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await cleanup(); process.exit(130); });

try {
  for (const [name, image] of Object.entries(images)) {
    const [metadata] = JSON.parse(await docker(['image', 'inspect', image]));
    assert.equal(metadata.Os, 'linux');
    assert.equal(metadata.Architecture, 'amd64');
    assert.equal(metadata.Config.User, 'node');
    report.images[name] = { tag: image, id: metadata.Id, bytes: metadata.Size, os: metadata.Os, arch: metadata.Architecture, user: metadata.Config.User };
  }
  // Pull dependencies before creating the internal-only fixture network.
  await Promise.all(['postgres:17-alpine', 'redis:7-alpine'].map(image => docker(['pull', image], 600000)));
  network = await docker(['network', 'create', '--internal', '--label', label, prefix]);
  const password = randomBytes(24).toString('hex');
  const databaseUrl = `postgresql://workforce_fixture:${password}@db:5432/cloud_run_fixture`;
  const databaseEnv = envFile('database.env', { POSTGRES_USER: 'workforce_fixture', POSTGRES_PASSWORD: password, POSTGRES_DB: 'cloud_run_fixture' });
  const migrationEnv = envFile('migration.env', { NODE_ENV: 'production', DATABASE_URL: databaseUrl });
  const apiEnv = envFile('api.env', {
    NODE_ENV: 'production', PORT: '8087', DATABASE_URL: databaseUrl, REDIS_URL: 'redis://cache:6379/0',
    JWT_SECRET: randomBytes(32).toString('hex'), INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    MEDICAL_DATA_ENCRYPTION_KEY: randomBytes(32).toString('hex'), META_APP_SECRET: randomBytes(24).toString('hex'),
    META_VERIFY_TOKEN: randomBytes(24).toString('hex'), GEMINI_API_KEY: randomBytes(24).toString('hex'),
    WEB_APP_URL: 'https://web-smoke.run.app', PUBLIC_API_URL: 'https://api-smoke.run.app',
    CORS_ORIGINS: 'https://web-smoke.run.app', BACKGROUND_WORKERS_ENABLED: 'false',
    BILLING_MODE: 'disabled', BILLING_ENFORCEMENT: 'false', LOG_LEVEL: 'error',
  });
  const webEnv = envFile('web.env', { NODE_ENV: 'production', PORT: '8088', API_INTERNAL_URL: 'http://api:8087', API_URL: 'http://api:8087' });
  await start('db', ['--env-file', databaseEnv, 'postgres:17-alpine']);
  await start('cache', ['redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no']);
  await wait('PostgreSQL', () => docker(['exec', `${prefix}-db`, 'pg_isready', '-U', 'workforce_fixture', '-d', 'cloud_run_fixture'], 10000));
  await wait('Redis', () => docker(['exec', `${prefix}-cache`, 'redis-cli', 'ping'], 10000));
  const migration = `${prefix}-migration`;
  containers.push(migration);
  await docker(['run', '--name', migration, '--label', label, '--network', network, '--env-file', migrationEnv, images.migration]);
  report.checks.migrations = 'PASS';
  await start('api', ['--env-file', apiEnv, images.api]);
  await start('web', ['--env-file', webEnv, images.web]);
  const probe = `
    const assert=require('node:assert/strict');
    (async()=>{
      const get=(url,options={})=>fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(5000)});
      assert.equal((await get('http://api:8087/livez')).status,200);
      const health=await get('http://api:8087/health');assert.equal(health.status,200);
      assert.deepEqual((await health.json()).checks,{database:true,redis:true});
      assert.equal((await get('http://web:8088/api/health')).status,200);
      for(const url of ['http://api:8087/api/v1/auth/me','http://web:8088/api/auth/me','http://web:8088/api/v1/auth/me'])assert.equal((await get(url)).status,401);
      const cors=await get('http://api:8087/api/v1/auth/login',{method:'OPTIONS',headers:{Origin:'https://web-smoke.run.app','Access-Control-Request-Method':'POST'}});
      assert.equal(cors.status,204);assert.equal(cors.headers.get('access-control-allow-origin'),'https://web-smoke.run.app');
      assert.equal((await get('http://api:8087/api/v1/auth/me',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
      const redirect=await get('http://web:8088/dashboard');assert.equal(redirect.status,307);
      assert.equal(new URL(redirect.headers.get('location'),'http://web:8088').pathname,'/login');
      assert.equal(process.getuid(),1000);console.log('PASS');
    })().catch(error=>{console.error(error.message);process.exit(1);});
  `;
  await wait('API/web Linux HTTP checks', () => docker(['exec', `${prefix}-web`, 'node', '-e', probe], 45000));
  report.checks.dynamicPortsAndCrossContainerBinding = 'PASS';
  report.checks.apiDatabaseRedisHealth = 'PASS';
  report.checks.webHealthAndRuntimeProxy = 'PASS';
  report.checks.authenticationAndCors = 'PASS';
  const dependencies = `const fs=require('node:fs');const assert=require('node:assert/strict');assert.equal(process.getuid(),1000);for(const name of ['prisma','typescript','next','vitest','tsx'])assert.equal(fs.existsSync('/app/node_modules/'+name),false);for(const file of ['/app/.env','/app/apps/api/.env'])assert.equal(fs.existsSync(file),false);require('express');require('bullmq');require('@prisma/client');console.log('PASS');`;
  await docker(['exec', `${prefix}-api`, 'node', '-e', dependencies]);
  report.checks.nonRootAndProductionDependencies = 'PASS';
  report.passed = true;
} catch (error) {
  report.error = error.message;
} finally {
  await cleanup();
  if (report.cleanupErrors.length) report.passed = false;
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/gcp-container-smoke.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
