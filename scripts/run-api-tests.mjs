import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import testDatabase from '../packages/shared/test-database.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = path.join(root, 'apps/api');
if (process.env.NODE_ENV === 'production') throw new Error('Run integration tests outside the production environment');
dotenv.config({ path: path.join(api, '.env'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });
if (process.env.NODE_ENV === 'production') throw new Error('Run integration tests outside the production environment');
const applicationUrl = process.env.DATABASE_URL;
let target = process.env.TEST_DATABASE_URL;
if (!target) {
  if (!applicationUrl) throw new Error('Set TEST_DATABASE_URL or a local development DATABASE_URL');
  const local = new URL(applicationUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(local.hostname)) throw new Error('Remote test databases require explicit TEST_DATABASE_URL');
  local.pathname = `${local.pathname}_test`;
  local.search = '';
  target = local.toString();
}
const url = testDatabase.assertTestDatabaseUrl(target, applicationUrl);
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
adminUrl.search = '';
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
try {
  const name = decodeURIComponent(url.pathname.slice(1));
  const exists = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  // The guard restricts the identifier to letters, numbers and underscores.
  if (!exists.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  console.log(`Using isolated test database: ${name}`);
} finally { await admin.$disconnect(); }

const childEnv = { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: target, DATABASE_URL: target };
function run(relative, args) {
  const result = spawnSync(process.execPath, [path.join(root, relative), ...args], { cwd: api, env: childEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run('node_modules/typescript/bin/tsc', ['-p', path.join(root, 'packages/shared/tsconfig.json')]);
run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
run('node_modules/vitest/vitest.mjs', ['run', ...process.argv.slice(2)]);
