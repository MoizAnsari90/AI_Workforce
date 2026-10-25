import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

test('GitHub CI gates branch pushes and pull requests with isolated Postgres and Redis', () => {
  const source = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(source, /pull_request:\s*\n\s+branches:\s*\[main\]/);
  assert.match(source, /push:\s*\n\s+branches:\s*\['\*\*'\]/);
  assert.match(source, /permissions:\s*\n\s+contents:\s*read/);
  assert.match(source, /postgres:\s*\n\s+image:\s*postgres:16/);
  assert.match(source, /redis:\s*\n\s+image:\s*redis:7-alpine/);
  assert.match(source, /TEST_REDIS_DB:\s*15/);
  assert.match(source, /TEST_REDIS_PASSWORD:\s*''/);
  assert.match(source, /run:\s*npm test/);
  assert.match(source, /run:\s*npm run build/);
  assert.match(source, /run:\s*npm audit --omit=dev --audit-level=high/);
  assert.doesNotMatch(source, /DATABASE_URL:\s*\$\{\{\s*secrets\./);
});
