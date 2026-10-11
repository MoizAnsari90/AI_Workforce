#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${RESTORE_DATABASE_URL:?Set the disposable restore database URL}"
: "${BACKUP_FILE:?Set the encrypted backup file path}"
: "${AGE_IDENTITY_FILE:?Mount the age private key file read-only}"
[[ "${CONFIRM_DISPOSABLE_RESTORE:-}" == YES ]] || { echo 'Explicit disposable restore confirmation is required'; exit 1; }
[[ "${RESTORE_DATABASE_URL%%\?*}" == */*_restore ]] || { echo 'Target database name must end with _restore'; exit 1; }
[[ "$RESTORE_DATABASE_URL" != "${DATABASE_URL:-}" ]] || { echo 'Refusing to restore into the source database'; exit 1; }
test -r "$BACKUP_FILE" && test -r "$AGE_IDENTITY_FILE"
age -d -i "$AGE_IDENTITY_FILE" "$BACKUP_FILE" | pg_restore --dbname="$RESTORE_DATABASE_URL" --no-owner --no-acl --exit-on-error --single-transaction
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS tenants_restored FROM tenants;'
echo 'Disposable database restore completed. Verify migrations and tenant isolation before marking recovery accepted.'
