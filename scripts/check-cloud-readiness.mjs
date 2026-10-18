// Validate credential structure without cloud API calls, payload output or mutations.
import fs from 'node:fs';
import path from 'node:path';
import { root, sourceEnvironment, prepareKeys } from './predeployment-config.mjs';

const source = sourceEnvironment();
const keys = prepareKeys();
const local = host => ['localhost', '127.0.0.1', '[::1]', 'postgres', 'redis'].includes(host);
function connection(value, type) {
  if (!value) return { ready: false, reason: 'missing' };
  try {
    const url = new URL(value);
    const socket = type === 'postgres' && (url.searchParams.get('host') || '').startsWith('/cloudsql/');
    if (!(type === 'postgres' ? ['postgres:', 'postgresql:'] : ['redis:', 'rediss:']).includes(url.protocol)) return { ready: false, reason: 'invalid protocol' };
    if (local(url.hostname) && !socket) return { ready: false, reason: 'local endpoint; hosted endpoint required' };
    if (type === 'postgres' && (!url.username || url.pathname.length < 2)) return { ready: false, reason: 'database/user missing' };
    const tls = type === 'redis' ? url.protocol === 'rediss:' : ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'));
    if (!tls && !socket) return { ready: false, reason: 'explicit TLS or approved private-network configuration required' };
    return { ready: true, tls, cloudSqlSocket: socket, connectivity: 'not tested' };
  } catch { return { ready: false, reason: 'invalid URL' }; }
}
const report = {
  timestamp: new Date().toISOString(),
  scope: 'structure only; no cloud services or credentials accessed',
  database: connection(source.DEPLOY_DATABASE_URL || source.DATABASE_URL, 'postgres'),
  redis: connection(source.DEPLOY_REDIS_URL || source.REDIS_URL, 'redis'),
  keys: Object.fromEntries(Object.keys(keys).map(name => [name, { ready: true, payloadOmitted: true }])),
  providerCredentials: Object.fromEntries(['GEMINI_API_KEY', 'META_APP_SECRET', 'META_VERIFY_TOKEN'].map(name => [name, { present: Boolean(source[name]), liveProviderAcceptance: 'not implied' }])),
  secretManager: 'deferred; GCP billing excluded by user',
  billingWorkPerformed: false,
};
report.hostedConfigurationReady = report.database.ready && report.redis.ready;
fs.writeFileSync(path.join(root, 'artifacts/predeployment-cloud-readiness.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.hostedConfigurationReady ? 0 : 2;
