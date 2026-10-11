import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import dotenv from 'dotenv';

export const oldMigration = '20261001205134_updated';
export const newMigration = '20261002100100_normalize_external_integration_index';
const prerequisite = '20261002100000_external_integration_account_id';
const migrationRoot = path.resolve(__dirname, '../../prisma/migrations');
type MigrationRecord = { id: string; migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; applied_steps_count: number };
type Backup = (record: MigrationRecord) => void;

function matchesSql(record: MigrationRecord, folder: string) {
  const sql = readFileSync(path.join(migrationRoot, folder, 'migration.sql'), 'utf8');
  // Prisma tolerates checkout-only LF/CRLF changes when checking migration history.
  return [sql, sql.replace(/\r\n/g, '\n'), sql.replace(/\r?\n/g, '\r\n')].some(value => createHash('sha256').update(value).digest('hex') === record.checksum);
}

// Run inside a transaction. This repair changes a filename reference only, never
// migration SQL, checksums, completion timestamps, indexes or application records.
export async function repairMigrationRecord(tx: Prisma.TransactionClient, apply: boolean, backup: Backup) {
  await tx.$executeRawUnsafe('LOCK TABLE "_prisma_migrations" IN SHARE ROW EXCLUSIVE MODE');
  const records = await tx.$queryRaw<MigrationRecord[]>`SELECT id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" WHERE migration_name IN (${oldMigration}, ${newMigration}, ${prerequisite})`;
  const old = records.filter(item => item.migration_name === oldMigration);
  const renamed = records.filter(item => item.migration_name === newMigration);
  if (!old.length) return renamed.length ? 'already-repaired' : 'not-needed';
  const parent = records.filter(item => item.migration_name === prerequisite);
  if (old.length !== 1 || renamed.length || parent.length !== 1) throw new Error('Unexpected migration history; no metadata was changed.');
  for (const row of [old[0], parent[0]]) {
    if (!row.finished_at || row.rolled_back_at || row.applied_steps_count !== 1 || !matchesSql(row, row === old[0] ? newMigration : prerequisite)) throw new Error('Migration state or checksum does not match the known repair; no metadata was changed.');
  }
  const indexes = await tx.$queryRaw<{ valid: boolean; unique: boolean; columns: string[] }[]>`
    SELECT i.indisvalid AS valid, i.indisunique AS unique,
      ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, n)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.n) AS columns
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    WHERE ns.nspname = current_schema() AND t.relname = 'external_integration_credentials'
      AND c.relname = 'external_integration_credentials_provider_external_account__key'`;
  const index = indexes[0];
  if (indexes.length !== 1 || !index.valid || !index.unique || index.columns.join(',') !== 'provider,external_account_id') throw new Error('Expected integration index is missing or different; no metadata was changed.');
  if (!apply) return 'repair-required';
  // Backup must succeed before the transaction can modify even migration metadata.
  backup(old[0]);
  const changed = await tx.$executeRaw`UPDATE "_prisma_migrations" SET migration_name = ${newMigration} WHERE id = ${old[0].id} AND migration_name = ${oldMigration} AND checksum = ${old[0].checksum}`;
  if (changed !== 1) throw new Error('Migration changed concurrently; repair rolled back.');
  return 'repaired';
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Usage: npm run prisma:repair-order -- [--apply]');
  dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
  const db = new PrismaClient();
  try {
    const status = await db.$transaction(tx => repairMigrationRecord(tx, process.argv.includes('--apply'), record => {
      const dir = path.resolve(__dirname, '../../../../.local/migration-repairs');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${oldMigration}-${Date.now()}.json`), JSON.stringify({ oldName: oldMigration, newName: newMigration, record }, null, 2), { flag: 'wx', mode: 0o600 });
    }));
    console.log(`Migration order: ${status}.`);
    if (status === 'repair-required') console.log('Run again with --apply to back up and rename the verified migration record.');
  } finally { await db.$disconnect(); }
}

if (require.main === module) main().catch(error => {
  // Prisma connection errors can include connection details; never print them.
  console.error(error instanceof Error && !('code' in error) ? error.message : 'Migration order repair failed. Check database access and migration state.');
  process.exitCode = 1;
});
