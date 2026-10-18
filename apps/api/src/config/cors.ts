import { env } from './env';
import { ForbiddenError } from '../errors/AppError';

const { isOrigin } = require('@ai-employee/shared/production-config.cjs');
const origins = env.CORS_ORIGINS.split(',').map(value => value.trim());
if (!origins.length || origins.some(value => !isOrigin(value, env.NODE_ENV === 'production'))) {
  throw new Error('CORS_ORIGINS must contain explicit HTTP(S) origins');
}
const allowedOrigins = new Set(origins.map(value => new URL(value).origin));

export function isAllowedOrigin(origin?: string): boolean {
  // Provider webhooks and server-to-server requests do not carry browser Origin.
  return origin === undefined || allowedOrigins.has(origin);
}

export function corsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  if (isAllowedOrigin(origin)) callback(null, true);
  else callback(new ForbiddenError('Request origin is not allowed'));
}
