import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { localDatabaseUrl, redisUrl, prepareKeys, root } from './predeployment-config.mjs';

test('rehearsal cannot target a remote or application database', () => {
  assert.throws(() => localDatabaseUrl({ DATABASE_URL: 'postgresql://fixture:fixture@remote.test/app' }), /loopback/);
  assert.throws(() => localDatabaseUrl({ DATABASE_URL: 'postgresql://fixture:fixture@localhost/ai_workforce_predeployment' }), /must differ/);
  const original = 'postgresql://fixture:fixture@localhost:5432/application?schema=other';
  const result = localDatabaseUrl({ DATABASE_URL: original });
  assert.equal(result.pathname, '/ai_workforce_predeployment');
  assert.equal(result.search, '');
  assert.equal(original, 'postgresql://fixture:fixture@localhost:5432/application?schema=other');
});

test('Redis URL generation encodes passwords and retains explicit managed URLs', () => {
  const result = new URL(redisUrl({ REDIS_HOST: 'localhost', REDIS_PORT: '6379', REDIS_DB: '14', REDIS_PASSWORD: 'synthetic:@/pass' }));
  assert.equal(decodeURIComponent(result.password), 'synthetic:@/pass');
  assert.equal(result.pathname, '/14');
  const explicit = 'rediss://cache.test:6380/0';
  assert.equal(redisUrl({ REDIS_URL: explicit }), explicit);
});

test('prepared encryption/JWT keys are stable across reruns', () => {
  const before = prepareKeys();
  const after = prepareKeys();
  assert.deepEqual(after, before);
  assert.match(after.MEDICAL_DATA_ENCRYPTION_KEY, /^[a-f0-9]{64}$/i);
});

test('secret uploader performs no mutation without explicit apply', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/upload-predeployment-secrets.mjs')], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.applied, false);
  assert.equal(report.errors[0].stage, 'arguments');
  assert.deepEqual(report.results, []);
});

test('secret uploader rejects a local database before any cloud access', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/upload-predeployment-secrets.mjs'), '--apply'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, DEPLOY_DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/rehearsal' },
  });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.applied, false);
  assert.equal(report.errors[0].stage, 'hosted credential validation');
  assert.deepEqual(report.results, []);
  assert.ok(!result.stdout.includes('fixture:fixture'));
});
