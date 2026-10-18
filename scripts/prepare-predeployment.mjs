import fs from 'node:fs';
import path from 'node:path';
import { prepareKeys, sourceEnvironment, redisUrl, localDatabaseUrl, root } from './predeployment-config.mjs';

try {
  const keys = prepareKeys();
  const source = sourceEnvironment();
  const database = localDatabaseUrl(source);
  const redis = new URL(redisUrl(source));
  const report = {
    timestamp: new Date().toISOString(),
    check: 'billing-independent-preparation',
    keys: Object.fromEntries(Object.keys(keys).map(name => [name, 'configured; value omitted; preserved on rerun'])),
    secretFile: '.local/predeployment/keys.json (ignored; restricted to current OS identity and workspace owner)',
    rehearsalDatabase: database.pathname.slice(1),
    redis: { configured: true, local: ['localhost', '127.0.0.1', '[::1]'].includes(redis.hostname) },
    cloudDatabase: 'not provisioned; requires a chosen provider/account',
    cloudRedis: 'not provisioned; requires a chosen provider/account',
    cloudSecretManager: 'not accessed; GCP billing work excluded',
    note: 'No root .env files or existing application encryption keys were modified.',
  };
  fs.writeFileSync(path.join(root, 'artifacts/predeployment-preparation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error('Predeployment preparation failed. Verify local environment fields and secret-file permissions; no credential values were printed.');
  process.exitCode = 1;
}
