// Direct Vitest invocation must provide a dedicated DB; npm test provisions it.
const { assertTestDatabaseUrl } = require('@ai-employee/shared/test-database.cjs');
import Redis from 'ioredis';
import { afterAll, afterEach, beforeAll } from 'vitest';

assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.META_VERIFY_TOKEN = 'test_verify_token';
process.env.META_APP_SECRET = 'test_webhook_secret';
process.env.META_ACCESS_TOKEN = 'test_access_token';
process.env.META_PHONE_NUMBER_ID = 'test_phone_number_id';
process.env.OPENAI_API_KEY = 'test_openai_key';
process.env.JWT_SECRET = 'test_jwt_secret_at_least_16_chars';
process.env.REDIS_HOST = process.env.TEST_REDIS_HOST || '127.0.0.1';
process.env.REDIS_PORT = process.env.TEST_REDIS_PORT || '6379';
process.env.REDIS_DB = process.env.TEST_REDIS_DB || '15';
if (!/^(?:[1-9]|1[0-5])$/.test(process.env.REDIS_DB)) throw new Error('Tests require a separate Redis database numbered 1 through 15');
process.env.REDIS_PASSWORD = process.env.TEST_REDIS_PASSWORD || '';
delete process.env.REDIS_URL;
delete process.env.REDIS_TLS_CA_FILE;
// Never inherit a live voice endpoint or its authentication key in integration tests.
delete process.env.VOICE_TRANSCRIBER_URL;
delete process.env.VOICE_WORKER_AUTH_KEY;
process.env.VOICE_TRANSCRIPTION_PROVIDER = 'self-hosted-whisper';
process.env.VOICE_PAYMENT_POLICY = 'free-only';
process.env.CORS_ORIGINS = 'http://localhost:3000,https://localhost:3000';
process.env.GEMINI_API_KEY = 'test_gemini_key';
process.env.BILLING_MODE = 'disabled';
process.env.BILLING_ENFORCEMENT = 'false';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
process.env.LOG_LEVEL = 'error';
process.env.INTEGRATION_ENCRYPTION_KEY = 'test-only-integration-key-not-for-production';
process.env.MEDICAL_DATA_ENCRYPTION_KEY = 'ab'.repeat(32);

// Auth limiter counters are shared by all suites using the dedicated test Redis
// database. Clear only this application's test limiter namespace between tests;
// queues and other integration fixtures remain intact.
const authRateLimitTestPrefix = 'ai-workforce:rate-limit:auth:';
const rateLimitTestRedis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  db: Number(process.env.REDIS_DB),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

async function clearAuthRateLimitTestKeys() {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await rateLimitTestRedis.scan(
      cursor,
      'MATCH',
      `${authRateLimitTestPrefix}*`,
      'COUNT',
      '100',
    );
    cursor = nextCursor;
    if (keys.length) await rateLimitTestRedis.del(...keys);
  } while (cursor !== '0');
}

beforeAll(async () => {
  if (process.env.GITHUB_ACTIONS === 'true') console.log('::notice title=Integration test stage::Connect to the isolated Redis test database');
  try {
    await rateLimitTestRedis.connect();
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === 'true') console.error('::error title=Redis test setup failed::Could not connect to the isolated Redis service');
    throw error;
  }
  await clearAuthRateLimitTestKeys();
});

afterEach(clearAuthRateLimitTestKeys);

afterAll(async () => {
  await rateLimitTestRedis.quit();
});
