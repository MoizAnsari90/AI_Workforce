import { env } from '../config/env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'passwordhash',
  'token',
  'jwt',
  'secret',
  'authorization',
  'access_token',
  'support_access_token',
  'cookie',
]);

function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const redactedObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      redactedObj[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redactedObj[key] = redact(value);
    } else {
      redactedObj[key] = value;
    }
  }
  return redactedObj;
}

export const logger = {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[env.LOG_LEVEL]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(meta ? { meta: redact(meta) } : {}),
    };

    const serialized = JSON.stringify(payload);
    if (level === 'error') {
      process.stderr.write(serialized + '\n');
    } else {
      process.stdout.write(serialized + '\n');
    }
  },

  debug(message: string, meta?: Record<string, unknown>) {
    this.log('debug', message, meta);
  },

  info(message: string, meta?: Record<string, unknown>) {
    this.log('info', message, meta);
  },

  warn(message: string, meta?: Record<string, unknown>) {
    this.log('warn', message, meta);
  },

  error(message: string, meta?: Record<string, unknown>) {
    this.log('error', message, meta);
  },
};
