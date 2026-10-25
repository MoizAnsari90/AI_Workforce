import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(root, 'docker-compose.yml');
const productionComposeFile = path.join(root, 'docker-compose.production.yml');

test('development databases are loopback-bound and use environment passwords', () => {
  const environment = {
    ...process.env,
    POSTGRES_PASSWORD: 'compose-test-postgres-password',
    REDIS_PASSWORD: 'compose-test-redis-password',
    JWT_SECRET: 'compose-test-only-voice-authentication-key',
    VOICE_WORKER_AUTH_KEY: 'ab'.repeat(32),
  };
  const result = spawnSync('docker', ['compose', '-f', composeFile, 'config', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  for (const serviceName of ['postgres', 'redis']) {
    assert.ok(config.services[serviceName].ports.length > 0);
    assert.ok(config.services[serviceName].ports.every(port => port.host_ip === '127.0.0.1'));
  }
  assert.equal(config.services.postgres.environment.POSTGRES_PASSWORD, environment.POSTGRES_PASSWORD);
  assert.equal(config.services.redis.environment.REDIS_PASSWORD, environment.REDIS_PASSWORD);
  assert.ok(config.services.redis.command.includes('--requirepass'));
  const voice = config.services['voice-transcriber'];
  assert.equal(voice.environment.VOICE_PAYMENT_POLICY, 'free-only');
  assert.equal(voice.read_only, true);
  assert.equal(config.networks.voice_internal.internal, true);
  assert.equal(voice.ports, undefined);
  assert.ok(config.services['voice-gateway'].ports.every(port => port.host_ip === '127.0.0.1'));
  assert.equal(config.services['voice-gateway'].environment?.VOICE_WORKER_AUTH_KEY, undefined);
  assert.deepEqual(Object.keys(voice.networks), ['voice_internal']);
  assert.equal(voice.environment.JWT_SECRET, undefined);
  assert.equal(voice.environment.VOICE_WORKER_AUTH_KEY, environment.VOICE_WORKER_AUTH_KEY);
});

test('production Redis requires authentication and the API receives REDIS_URL', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ai-workforce-compose-'));
  const productionEnv = path.join(temporaryDirectory, 'production.env');
  await writeFile(productionEnv, 'NODE_ENV=production\n');
  const environment = {
    ...process.env,
    PRODUCTION_ENV_FILE: productionEnv,
    POSTGRES_PASSWORD: 'compose-production-test-postgres',
    REDIS_PASSWORD: 'compose-production-test-redis',
    REDIS_URL: 'redis://:compose-production-test-redis@redis:6379/0',
    APP_DOMAIN: 'app.example.invalid',
    API_DOMAIN: 'api.example.invalid',
    JWT_SECRET: 'compose-production-test-only-voice-authentication-key',
    VOICE_WORKER_AUTH_KEY: 'ab'.repeat(32),
  };

  try {
    const result = spawnSync('docker', ['compose', '-f', productionComposeFile, 'config', '--format', 'json'], {
      cwd: root,
      encoding: 'utf8',
      env: environment,
    });
    assert.equal(result.status, 0, 'production Compose configuration must validate');
    const config = JSON.parse(result.stdout);
    const redis = config.services.redis;
    const api = config.services.api;
    assert.equal(Boolean(redis.environment.REDIS_PASSWORD), true);
    assert.equal(redis.command.includes('--requirepass'), true);
    assert.equal(redis.command.includes(environment.REDIS_PASSWORD), true);
    assert.equal(redis.healthcheck.test.some(value => value.includes('REDISCLI_AUTH=$$REDIS_PASSWORD')), true);
    assert.equal(Boolean(api.environment.REDIS_URL), true);
    assert.equal(api.environment.REDIS_URL.includes(environment.REDIS_PASSWORD), true);
    const voice = config.services['voice-transcriber'];
    assert.equal(api.environment.BILLING_MODE, 'disabled');
    assert.equal(api.environment.BILLING_ENFORCEMENT, 'false');
    assert.equal(api.environment.VOICE_TRANSCRIPTION_PROVIDER, 'self-hosted-whisper');
    assert.equal(api.environment.VOICE_PAYMENT_POLICY, 'free-only');
    assert.equal(voice.environment.VOICE_PAYMENT_POLICY, 'free-only');
    assert.equal(voice.read_only, true);
    assert.equal(voice.ports, undefined);
    assert.equal(config.networks.voice_internal.internal, true);
    assert.deepEqual(Object.keys(voice.networks), ['voice_internal']);
    assert.equal(voice.environment.JWT_SECRET, undefined);
    assert.equal(voice.environment.VOICE_WORKER_AUTH_KEY, environment.VOICE_WORKER_AUTH_KEY);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
