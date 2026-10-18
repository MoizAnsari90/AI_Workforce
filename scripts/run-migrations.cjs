const { spawnSync } = require('node:child_process');
const path = require('node:path');

const databaseUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
try {
  const url = new URL(databaseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const cloudSql = (url.searchParams.get('host') || '').startsWith('/cloudsql/');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password ||
      (process.env.NODE_ENV === 'production' && local && !cloudSql)) throw new Error();
} catch {
  console.error('Set a cloud-accessible DATABASE_URL or DIRECT_DATABASE_URL for migrations. Cloud SQL sockets are supported.');
  process.exit(1);
}
const result = spawnSync(process.execPath, [path.resolve(__dirname, '../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.resolve(__dirname, '../apps/api/prisma/schema.prisma')], {
  env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit',
});
if (result.error) console.error('Prisma migration process could not start.');
process.exit(result.status === 0 ? 0 : 1);
