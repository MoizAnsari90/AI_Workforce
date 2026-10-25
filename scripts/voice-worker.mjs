// Local Docker lifecycle helper. Derives a voice-only key without writing secrets.
import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { root, sourceEnvironment } from './predeployment-config.mjs';

const actions = { build: ['build', 'voice-transcriber'], start: ['up', '-d', 'voice-gateway'], status: ['ps', 'voice-transcriber', 'voice-gateway'], test: [] };
const action = process.argv[2];
if (!Object.hasOwn(actions, action)) throw new Error('Use voice-worker.mjs build, start, status, or test');
const source = sourceEnvironment();
if (!source.VOICE_WORKER_AUTH_KEY && (!source.JWT_SECRET || source.JWT_SECRET.length < 16)) throw new Error('Configure the existing API JWT_SECRET before starting the private voice worker.');
const key = source.VOICE_WORKER_AUTH_KEY || createHmac('sha256', source.JWT_SECRET).update('ai-workforce:voice-worker:v1').digest('hex');
if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('Invalid VOICE_WORKER_AUTH_KEY; expected 64 hexadecimal characters.');
let result;
if (action === 'test') {
  const rootEnvFile = path.join(root, '.env');
  const rootEnv = fs.existsSync(rootEnvFile) ? dotenv.parse(fs.readFileSync(rootEnvFile)) : {};
  result = spawnSync(process.execPath, [path.join(root, 'scripts/run-api-tests.mjs'), 'tests/voiceWhisperLive.test.ts'], {
    cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env,
      TEST_VOICE_WORKER_URL: 'http://127.0.0.1:8091', TEST_VOICE_WORKER_AUTH_KEY: key,
      TEST_REDIS_PASSWORD: source.TEST_REDIS_PASSWORD || source.REDIS_PASSWORD || rootEnv.REDIS_PASSWORD || '' },
  });
} else {
  result = spawnSync('docker', ['compose', ...actions[action]], { cwd: root, windowsHide: true, stdio: 'inherit',
    env: { ...process.env, VOICE_WORKER_AUTH_KEY: key } });
}
if (result.error) throw new Error('Docker is unavailable; start Docker Desktop and retry.');
process.exitCode = result.status ?? 1;
