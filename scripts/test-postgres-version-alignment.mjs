import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const [developmentCompose, productionCompose, apiEnv] = await Promise.all([
  readFile(new URL('docker-compose.yml', root), 'utf8'),
  readFile(new URL('docker-compose.production.yml', root), 'utf8'),
  readFile(new URL('apps/api/.env', root), 'utf8'),
]);

test('database version comment matches both Compose images', () => {
  const commentVersion = apiEnv.match(/^# Database Configuration \(PostgreSQL (\d+) local \/ Docker\)$/m)?.[1];
  const developmentVersion = developmentCompose.match(/image: pgvector\/pgvector:pg(\d+)/)?.[1];
  const productionVersion = productionCompose.match(/image: pgvector\/pgvector:pg(\d+)/)?.[1];

  assert.ok(commentVersion, 'API env database comment must declare its PostgreSQL major version');
  assert.equal(commentVersion, developmentVersion);
  assert.equal(commentVersion, productionVersion);
});