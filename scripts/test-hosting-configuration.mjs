import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardOrigin, prepareFirebaseHosting } from './prepare-firebase-hosting.mjs';
import { verifyHostedDeployment } from './verify-hosted-deployment.mjs';

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
  const render = fs.readFileSync('render.yaml', 'utf8');
  assert.match(render, /^\s+plan: free$/m);
  assert.match(render, /^\s+runtime: node$/m);
  const buildCommand = render.match(/^\s+buildCommand: (.+)$/m)?.[1] ?? '';
  const startCommand = render.match(/^\s+startCommand: (.+)$/m)?.[1] ?? '';
  assert.match(buildCommand, /npm ci --include=dev/);
  assert.match(buildCommand, /prisma:generate/);
  assert.match(startCommand, /^node scripts\/run-migrations\.cjs && cd apps\/api && node dist\/index\.js$/);
  assert.doesNotMatch(render, /^\s+preDeployCommand:/m);
  assert.match(render, /^\s+healthCheckPath: \/health$/m);
  for (const name of ['DATABASE_URL', 'REDIS_URL', 'GEMINI_API_KEY', 'JWT_SECRET', 'INTEGRATION_ENCRYPTION_KEY', 'MEDICAL_DATA_ENCRYPTION_KEY']) {
    assert.match(render, new RegExp(`^\\s+- key: ${name}\\r?\\n\\s+sync: false$`, 'm'));
  }
  assert.doesNotMatch(buildCommand + startCommand, /gcloud|billingEnabled|cloudrun/i);
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
test('Vercel API builds do not migrate production; manual migrations require the protected GitHub environment', () => {
  const api = JSON.parse(fs.readFileSync('apps/api/vercel.json', 'utf8'));
  assert.doesNotMatch(api.buildCommand, /run-migrations/);
  const workflow = fs.readFileSync('.github/workflows/production-migration.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*production/);
  assert.match(workflow, /PRODUCTION_DATABASE_URL/);
  assert.match(workflow, /run: node scripts\/run-migrations\.cjs/);
  assert.match(workflow, /CONFIRM_PRODUCTION_MIGRATION.*inputs\.confirm_production_migration/);
  assert.match(workflow, /!= "yes"/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /pull_request_target|DATABASE_URL:\s*postgres/i);
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
