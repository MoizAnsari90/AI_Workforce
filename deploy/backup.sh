#!/usr/bin/env bash
set -euo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?Set an age public encryption recipient}"
: "${BACKUP_S3_URI:?Set an off-host s3:// backup destination}"
[[ "$BACKUP_S3_URI" == s3://* ]] || { echo 'Invalid backup destination'; exit 1; }
mkdir -p /backups
name="workforce-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
temporary="$(mktemp /backups/.backup-XXXXXX)"
trap 'rm -f -- "$temporary"' EXIT
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl | age -r "$BACKUP_AGE_RECIPIENT" > "$temporary"
test -s "$temporary"
mv -- "$temporary" "/backups/$name"
sha256sum "/backups/$name" > "/backups/$name.sha256"
aws s3 cp "/backups/$name" "${BACKUP_S3_URI%/}/$name" --only-show-errors
aws s3 cp "/backups/$name.sha256" "${BACKUP_S3_URI%/}/$name.sha256" --only-show-errors
date -u +%FT%TZ > /backups/last-success.txt
echo 'Encrypted database backup uploaded successfully.'
