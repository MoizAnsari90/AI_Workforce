# Fixing P3006 / P1014 in the October integration index migration

The index rename was originally named `20261001205134_updated`, which sorts
before `20261002100000_external_integration_account_id`, the migration that
creates its index. The local database had applied them in the opposite order.
Prisma's shadow database correctly replays filenames in sorted order and failed
because the index did not exist yet.

The rename migration is now
`20261002100100_normalize_external_integration_index`. Its SQL is byte-for-byte
unchanged. Fresh databases can replay the history in dependency order.

## Existing database with the old applied name

Run from `D:\Agent\apps\api`:

```powershell
npm run prisma:repair-order
npm run prisma:repair-order -- --apply
npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate dev --skip-generate --skip-seed
```

The first command is a dry run. The apply command makes a narrowly scoped
migration-metadata repair: it changes only the old row's `migration_name` to the
new directory name in `_prisma_migrations`. It requires the old migration and
its prerequisite to be successfully applied, verifies their SQL checksums and
the expected unique index, and refuses unexpected states. It backs up the old
record under `.local/migration-repairs/` before updating it in a transaction.
That directory is gitignored. Rerunning after success makes no changes.

The separate `20261004130000_align_calendar_constraints` migration aligns the
calendar/reception foreign keys with Prisma's `ON UPDATE CASCADE` default and
normalizes the appointment index name. It runs in one transaction and changes
no application records. Older migration SQL is preserved.

This is an exceptional correction of a misordered historical filename, not a
general method for editing applied migrations or bypassing failed SQL. No
application table, customer record, migration checksum or completion timestamp
is changed. Do not delete migrations, run `migrate reset`, or accept a reset
prompt to work around this error. Do not use `migrate resolve --applied` to
pretend unexecuted SQL succeeded.

For another existing environment, inspect the dry run and keep the metadata
backup when applying this repair. Do not run migrations concurrently. A fresh
database without `_prisma_migrations` should simply use `prisma migrate deploy`;
it needs no metadata repair. The old migration name must not remain as a second
directory alongside the corrected name.

Client generation is separate. These changes don't alter the Prisma data model,
so they don't require regenerating a client that already matches the schema.
If generation is needed on Windows, stop this project's API first to release
the Prisma engine DLL, then run `npm run prisma:generate` and restart the API.

## Verification

`tests/migrationOrder.test.ts` reproduces the original missing-index failure in
a disposable transactional schema, replays all corrected migrations from empty,
and checks backup-before-update, record preservation, idempotency and rejection
of unexpected checksums. Test schemas are rolled back, including on failure.

Local verification on 4 October 2026:

- All five migration regression tests passed, including the complete fresh replay.
- `prisma migrate deploy` applied the constraint-alignment migration successfully.
- `prisma migrate dev --skip-generate --skip-seed`: already in sync, no pending migration.
- `prisma migrate status`: database schema is up to date (12 migrations).
- Live datasource-to-schema diff: no difference detected.
- API TypeScript build passed. No lint script is configured in this workspace.
- Full API regression suite: 41 files / 314 tests passed.
- Running API health check passed with PostgreSQL and Redis healthy.
