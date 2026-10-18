import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { dashboardOrigin, prepareFirebaseHosting } from './prepare-firebase-hosting.mjs';
import { verifyHostedDeployment } from './verify-hosted-deployment.mjs';
const require = createRequire(import.meta.url);
const YAML = require('yaml');

test('live verifier refuses a superficially healthy API with a failed database', async () => {
  const urls = { DEPLOY_API_URL: 'https://api.acme.test', DEPLOY_WEB_URL: 'https://web.acme.test', DEPLOY_FIREBASE_URL: 'https://entry.acme.test' };
  let requests = 0;
  const result = await verifyHostedDeployment(urls, async () => {
    requests++;
    return Response.json({ status: 'healthy', checks: { database: false, redis: true } });
  });
  assert.equal(result.passed, false);
  assert.equal(result.errors[0].stage, 'API readiness');
  assert.equal(requests, 1);
});

test('live verifier rejects login redirects to a different origin', async () => {
  const urls = { DEPLOY_API_URL: 'https://api.acme.test', DEPLOY_WEB_URL: 'https://web.acme.test', DEPLOY_FIREBASE_URL: 'https://entry.acme.test' };
  const result = await verifyHostedDeployment(urls, async url => {
    if (url.endsWith('/health')) return Response.json({ status: 'healthy', checks: { database: true, redis: true } });
    if (url.endsWith('/login')) return new Response('AI Workforce');
    return new Response(null, { status: 307, headers: { location: 'https://foreign.invalid/login' } });
  });
  assert.equal(result.passed, false);
  assert.equal(result.errors[0].stage, 'protected dashboard');
});

test('Render free service installs workspaces and migrates before starting API', () => {
  const { services } = YAML.parse(fs.readFileSync('render.yaml', 'utf8'));
  const api = services[0];
  assert.equal(api.plan, 'free');
  assert.equal(api.runtime, 'node');
  assert.match(api.buildCommand, /npm ci --include=dev/);
  assert.match(api.buildCommand, /prisma:generate/);
  assert.match(api.startCommand, /^node scripts\/run-migrations.cjs && cd apps\/api && node dist\/index.js$/);
  assert.equal(api.preDeployCommand, undefined);
  assert.equal(api.healthCheckPath, '/health');
  for (const name of ['DATABASE_URL', 'REDIS_URL', 'GEMINI_API_KEY', 'JWT_SECRET', 'INTEGRATION_ENCRYPTION_KEY', 'MEDICAL_DATA_ENCRYPTION_KEY']) {
    assert.deepEqual(api.envVars.find(item => item.key === name), { key: name, sync: false });
  }
  assert.doesNotMatch(api.buildCommand + api.startCommand, /gcloud|billingEnabled|cloudrun/i);
});
test('Firebase publishes only a dedicated static directory, without server rewrites', () => {
  const { hosting } = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
  assert.equal(hosting.public, 'deploy/firebase/public');
  assert.deepEqual(hosting.predeploy, ['node scripts/prepare-firebase-hosting.mjs']);
  assert.equal(hosting.rewrites, undefined);
  assert.equal(hosting.redirects, undefined);
});
test('Vercel builds Next.js server routes with room for bounded voice upstream calls', () => {
  const vercel = JSON.parse(fs.readFileSync('apps/web/vercel.json', 'utf8'));
  assert.equal(vercel.framework, 'nextjs');
  assert.equal(vercel.outputDirectory, '.next');
  assert.equal(vercel.functions['app/api/**/*'].maxDuration, 60);
  assert.doesNotMatch(vercel.buildCommand + vercel.installCommand, /gcloud|billingEnabled/);
});
test('Firebase entry page requires a real HTTPS origin and escapes it', () => {
  for (const value of [undefined, 'http://foo.vercel.app', 'https://user:secret@foo.vercel.app', 'https://foo.vercel.app/path', 'https://foo.vercel.app/?secret=abc', 'https://localhost']) {
    assert.throws(() => dashboardOrigin(value));
  }
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'workforce-static-'));
  try {
    prepareFirebaseHosting('https://workforce-demo.vercel.app', output);
    assert.deepEqual(fs.readdirSync(output).sort(), ['404.html', 'index.html']);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /href="https:\/\/workforce-demo.vercel.app\/dashboard"/);
    assert.doesNotMatch(html, /<script|GEMINI_API_KEY|DATABASE_URL|JWT_SECRET/);
  } finally {
    // Only the exact random temporary directory created above is removed.
    assert.equal(path.dirname(output), os.tmpdir());
    fs.rmSync(output, { recursive: true, force: true });
  }
});
