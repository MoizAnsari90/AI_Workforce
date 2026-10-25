import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Runtime settings take precedence, followed by the API and root env files.
// An empty Redis password placeholder must not hide the root Compose password.
for (const file of ['.env', '../../.env']) {
  const { parsed } = dotenv.config({ path: path.resolve(process.cwd(), file), processEnv: {}, quiet: true });
  for (const [name, value] of Object.entries(parsed ?? {})) {
    if (process.env[name] === undefined && !(name === 'REDIS_PASSWORD' && value === '')) {
      process.env[name] = value;
    }
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(isProduction ? 8080 : 3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_USERNAME: z.string().optional(),
  REDIS_URL: z.string().regex(/^rediss?:\/\//).optional(),
  REDIS_TLS_CA_FILE: z.string().optional(),
  BACKGROUND_WORKERS_ENABLED: z.enum(['true', 'false']).default(process.env.VERCEL === '1' ? 'false' : 'true'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,https://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  META_VERIFY_TOKEN: isProduction || isTest ? z.string().min(1, 'META_VERIFY_TOKEN is required') : z.string().optional(),
  META_APP_SECRET: isProduction || isTest ? z.string().min(1, 'META_APP_SECRET is required') : z.string().optional(),
  META_APP_ID: z.string().optional(),
  META_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.0$/).default('v26.0'),
  WOOCOMMERCE_CALLBACK_URL: z.string().url().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VOICE_TRANSCRIBER_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  VOICE_WORKER_AUTH_KEY: z.preprocess(value => value === '' ? undefined : value, z.string().regex(/^[a-f0-9]{64}$/i).optional()),
  VOICE_TRANSCRIPTION_PROVIDER: z.preprocess(value => value === '' ? undefined : value, z.string().default('self-hosted-whisper')),
  VOICE_PAYMENT_POLICY: z.preprocess(value => value === '' ? undefined : value, z.string().default('free-only')),
  DOGRAH_API_URL: z.preprocess(value => value === '' ? undefined : value, z.string().url().optional()),
  DOGRAH_API_KEY: z.preprocess(value => value === '' ? undefined : value, z.string().min(8).optional()),
  DOGRAH_AGENT_ID: z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional()),
  DOGRAH_WEBHOOK_SECRET: z.preprocess(value => value === '' ? undefined : value, z.string().min(32).optional()),
  MEDICAL_DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes encoded as 64 hexadecimal characters').optional(),
  MEDICAL_DATA_ENCRYPTION_KEY_PREVIOUS: z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 32 bytes encoded as 64 hexadecimal characters').optional(),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsed.data;

if (process.env.VERCEL === '1' && env.BACKGROUND_WORKERS_ENABLED === 'true') {
  throw new Error('Vercel Functions cannot host continuous BullMQ consumers or schedulers. Set BACKGROUND_WORKERS_ENABLED=false and deploy a separate worker.');
}

if (isProduction) {
  const { productionConfigurationFailures } = require('@ai-employee/shared/production-config.cjs');
  const failures: string[] = productionConfigurationFailures(process.env);
  if (failures.length) throw new Error(`Invalid production configuration: ${failures.join(', ')}`);
}
