import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let fixtureDirectory: string | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

describe('Environment configuration', () => {
  it('defaults empty voice placeholders to the free self-hosted policy', async () => {
    vi.stubEnv('VOICE_TRANSCRIPTION_PROVIDER', '');
    vi.stubEnv('VOICE_PAYMENT_POLICY', '');
    vi.resetModules();
    const { env } = await import('../src/config/env');
    expect(env.VOICE_TRANSCRIPTION_PROVIDER).toBe('self-hosted-whisper');
    expect(env.VOICE_PAYMENT_POLICY).toBe('free-only');
  });
  it.each([
    { description: 'uses the root Redis password when the API env file has an empty placeholder', apiPassword: '', runtimePassword: undefined, expected: 'fixture-redis-password' },
    { description: 'preserves a configured API Redis password', apiPassword: 'api-fixture-password', runtimePassword: undefined, expected: 'api-fixture-password' },
    { description: 'preserves an explicit runtime Redis password', apiPassword: '', runtimePassword: 'runtime-fixture-password', expected: 'runtime-fixture-password' },
    { description: 'preserves an explicit runtime passwordless Redis configuration', apiPassword: '', runtimePassword: '', expected: '' },
  ])('$description', async ({ apiPassword, runtimePassword, expected }) => {
    fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'api-env-regression-'));
    const apiDirectory = path.join(fixtureDirectory, 'apps', 'api');
    mkdirSync(apiDirectory, { recursive: true });
    writeFileSync(path.join(apiDirectory, '.env'), `REDIS_PASSWORD=${apiPassword}\n`);
    writeFileSync(path.join(fixtureDirectory, '.env'), 'REDIS_PASSWORD=fixture-redis-password\n');
    vi.spyOn(process, 'cwd').mockReturnValue(apiDirectory);
    vi.stubEnv('REDIS_PASSWORD', runtimePassword);
    vi.resetModules();

    const configuration = await import('../src/config/env');
    expect(configuration.env.REDIS_PASSWORD).toBe(expected);
  });

  it('does not expose an email-verification requirement without a verification flow', async () => {
    const configuration = await import('../src/config/env');
    expect(Object.hasOwn(configuration.env, 'EMAIL_VERIFICATION_REQUIRED')).toBe(false);
  });
});
