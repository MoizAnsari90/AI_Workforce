import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { test } from 'node:test';

const source = fs.readFileSync(new URL('./run-migrations.cjs', import.meta.url), 'utf8');
function invoke(env) {
  let command;
  const exit = Symbol('exit');
  const sandbox = {
    URL, __dirname: path.resolve('scripts'), console: { error() {} },
    process: { env, execPath: process.execPath, exit(code) { throw { exit, code }; } },
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:child_process') return { spawnSync(exe, args, options) { command = { exe, args, options }; return { status: 0 }; } };
      throw Error('Unexpected dependency');
    },
  };
  try { vm.runInNewContext(source, sandbox); } catch (e) { if (e.exit !== exit) throw e; }
  return command;
}
const pooled = 'postgresql://owner:test-only@ep-unit-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require';
const direct = 'postgresql://owner:test-only@ep-unit.us-east-2.aws.neon.tech/neondb?sslmode=require';

test('Neon migrations select unpooled credentials while preserving the runtime URL', () => {
  const env = { NODE_ENV: 'production', DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: direct };
  const result = invoke(env);
  assert.equal(result.options.env.DATABASE_URL, direct);
  assert.equal(env.DATABASE_URL, pooled);
  assert.deepEqual(Array.from(result.args.slice(1, 3)), ['migrate', 'deploy']);
});
test('explicit migration URL retains precedence and ordinary PostgreSQL still works', () => {
  assert.equal(invoke({ DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: 'invalid', DIRECT_DATABASE_URL: direct }).options.env.DATABASE_URL, direct);
  assert.equal(invoke({ DATABASE_URL: pooled }).options.env.DATABASE_URL, pooled);
});
test('invalid direct connections fail closed before any migration process starts', () => {
  assert.equal(invoke({ NODE_ENV: 'production', DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: 'https://invalid.test' }), undefined);
  assert.equal(invoke({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://owner:test-only@localhost/db' }), undefined);
});
