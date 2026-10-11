import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { newMigration, oldMigration, repairMigrationRecord } from '../src/scripts/repairMigrationOrder';

const db = new PrismaClient();
const root = path.resolve(__dirname, '../prisma/migrations');
const prerequisite = '20261002100000_external_integration_account_id';
const folders = () => readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => item.name).sort();
const sql = (name: string) => readFileSync(path.join(root, name, 'migration.sql'), 'utf8');
const checksum = (name: string) => createHash('sha256').update(sql(name)).digest('hex');

async function isolated(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  const rollback = new Error('fixture rollback');
  // Transactional DDL guarantees cleanup even if an assertion fails. Only a fresh,
  // generated schema is used; the application's public schema is never changed.
  const schema = `migration_test_${randomUUID().replace(/-/g, '')}`;
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await run(tx);
      throw rollback;
    }, { timeout: 120_000, maxWait: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
}

async function replay(tx: Prisma.TransactionClient, order: string[]) {
  for (const name of order) {
    // Plain DDL only. The fixture owns its transaction: never execute migration
    // BEGIN/COMMIT statements that would commit its temporary schema.
    const source = sql(name).replace(/^\s*--[^\n]*/gm, '');
    const statements: string[] = [];
    let start = 0, dollarTag: string | null = null;
    for (let index = 0; index < source.length; index++) {
      if (source[index] === '$') {
        const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
        if (tag && (!dollarTag || tag === dollarTag)) { dollarTag = dollarTag ? null : tag; index += tag.length - 1; continue; }
      }
      if (source[index] === ';' && !dollarTag) { statements.push(source.slice(start, index).trim()); start = index + 1; }
    }
    statements.push(source.slice(start).trim());
    const plainStatements = statements.filter(value => value && !/^(BEGIN|COMMIT)$/i.test(value));
    for (const statement of plainStatements) await tx.$executeRawUnsafe(statement);
  }
}

async function historyFixture(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe('CREATE TABLE "_prisma_migrations" (id TEXT PRIMARY KEY, migration_name TEXT, checksum TEXT, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ, applied_steps_count INTEGER)');
  for (const name of [prerequisite, oldMigration]) await tx.$executeRaw`INSERT INTO "_prisma_migrations" VALUES (${name}, ${name}, ${checksum(name === oldMigration ? newMigration : name)}, now(), NULL, 1)`;
  await tx.$executeRawUnsafe('CREATE TABLE "external_integration_credentials" (provider TEXT, external_account_id TEXT)');
  await tx.$executeRawUnsafe('CREATE UNIQUE INDEX "external_integration_credentials_provider_external_account__key" ON "external_integration_credentials" (provider, external_account_id)');
  await tx.$executeRawUnsafe("INSERT INTO external_integration_credentials VALUES ('fixture', 'preserve-me')");
}

afterAll(() => db.$disconnect());
describe('Migration history order repair', () => {
  it('reproduces the missing-index failure in the original timestamp order', async () => {
    const originalOrder = folders().sort((a, b) => (a === newMigration ? oldMigration : a).localeCompare(b === newMigration ? oldMigration : b));
    await expect(isolated(tx => replay(tx, originalOrder))).rejects.toMatchObject({ code: 'P2010', meta: { code: '42P01' } });
  }, 120_000);

  it('replays the complete corrected history on an empty schema and creates the expected unique index', async () => {
    expect(folders().indexOf(newMigration)).toBeGreaterThan(folders().indexOf(prerequisite));
    await isolated(async tx => {
      await replay(tx, folders());
      const indexes = await tx.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'external_integration_credentials'`;
      expect(indexes.map(item => item.indexname)).toContain('external_integration_credentials_provider_external_account__key');
      const calendarIndexes = await tx.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'scheduled_appointments'`;
      expect(calendarIndexes.map(item => item.indexname)).toContain('scheduled_appointments_tenant_id_calendar_id_status_start_t_idx');
      const constraints = await tx.$queryRaw<{ update_rule: string }[]>`SELECT update_rule FROM information_schema.referential_constraints WHERE constraint_schema = current_schema() AND constraint_name IN ('clinic_services_tenant_id_resource_id_fkey', 'scheduled_appointments_tenant_id_resource_id_fkey', 'business_profiles_tenant_id_fkey')`;
      expect(constraints).toHaveLength(3); expect(constraints.every(item => item.update_rule === 'CASCADE')).toBe(true);
    });
  }, 120_000);

  it('backs up and renames only the known applied history record, and is idempotent', async () => {
    await isolated(async tx => {
      await historyFixture(tx); const backup = vi.fn();
      const before = await tx.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "_prisma_migrations" WHERE migration_name = ${oldMigration}`;
      expect(await repairMigrationRecord(tx, false, backup)).toBe('repair-required'); expect(backup).not.toHaveBeenCalled();
      expect(await repairMigrationRecord(tx, true, backup)).toBe('repaired'); expect(backup).toHaveBeenCalledWith(before[0]);
      const after = await tx.$queryRaw<Record<string, unknown>[]>`SELECT * FROM "_prisma_migrations" WHERE migration_name = ${newMigration}`;
      expect(after[0]).toEqual({ ...before[0], migration_name: newMigration });
      expect(await tx.$queryRawUnsafe('SELECT * FROM external_integration_credentials')).toEqual([{ provider: 'fixture', external_account_id: 'preserve-me' }]);
      expect(await repairMigrationRecord(tx, true, backup)).toBe('already-repaired'); expect(backup).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses to modify unexpected checksums or unverified migrations', async () => {
    await isolated(async tx => {
      await historyFixture(tx); const backup = vi.fn();
      await tx.$executeRaw`UPDATE "_prisma_migrations" SET checksum = 'unrecognized' WHERE migration_name = ${oldMigration}`;
      await expect(repairMigrationRecord(tx, true, backup)).rejects.toThrow('checksum'); expect(backup).not.toHaveBeenCalled();
      const rows = await tx.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ${oldMigration}`; expect(rows).toHaveLength(1);
    });
  });

  it('does not update metadata when its backup cannot be written', async () => {
    await isolated(async tx => {
      await historyFixture(tx);
      await expect(repairMigrationRecord(tx, true, () => { throw new Error('backup unavailable'); })).rejects.toThrow('backup unavailable');
      expect(await repairMigrationRecord(tx, false, vi.fn())).toBe('repair-required');
    });
  });
});
