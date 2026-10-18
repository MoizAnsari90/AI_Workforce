#!/usr/bin/env bash
# Integration-test deployment ordering with local gcloud/curl fixtures. No cloud access.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
mkdir "$TMP/bin" "$TMP/state"
cleanup() {
  rm -f -- "$TMP/bin/gcloud" "$TMP/bin/curl" "$TMP/state/api" "$TMP/state/web" "$TMP/api.json" "$TMP/web.json" "$TMP/commands" "$TMP/output" "$TMP/failure" "$TMP/config.sh" "$TMP/bindings"
  rmdir -- "$TMP/bin" "$TMP/state" "$TMP"
}
trap cleanup EXIT
export GCP_FIXTURE_DIR="$TMP"
export PATH="$TMP/bin:$PATH"
cat > "$TMP/bin/gcloud" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GCP_FIXTURE_DIR/commands"
case "$*" in
  'auth list '*) echo operator@example.invalid ;;
  'billing projects describe '*) echo True ;;
  'secrets versions describe '*) echo ENABLED ;;
  'secrets versions access '*) echo 'Payload access is forbidden in this test' >&2; exit 99 ;;
  'run services describe ai-workforce-api '*) [[ -f "$GCP_FIXTURE_DIR/state/api" ]] || exit 1; echo https://api-fixture.run.app ;;
  'run services describe ai-workforce-web '*) [[ -f "$GCP_FIXTURE_DIR/state/web" ]] || exit 1; echo https://web-fixture.run.app ;;
  'run deploy ai-workforce-api '*|'run deploy ai-workforce-web '*)
    service="${3##ai-workforce-}"
    for arg in "$@"; do
      if [[ "$arg" == --env-vars-file=* ]]; then cp -- "${arg#*=}" "$GCP_FIXTURE_DIR/$service.json"; fi
    done
    touch "$GCP_FIXTURE_DIR/state/$service"
    ;;
  'run jobs execute '*) [[ "${GCP_FAIL_MIGRATION:-false}" != true ]] || exit 7 ;;
esac
SH
cat > "$TMP/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
status=200; output=false; header_file=; previous=
for arg in "$@"; do
  [[ "$previous" != -D ]] || header_file="$arg"
  [[ "$arg" != -w ]] || output=true
  [[ "$arg" != *'/auth/me' ]] || status=401
  [[ "$arg" != OPTIONS ]] || status=204
  [[ "$arg" != 'Origin: https://untrusted.invalid' ]] || status=403
  previous="$arg"
done
[[ -z "$header_file" ]] || printf 'Access-Control-Allow-Origin: https://web-fixture.run.app\r\n' > "$header_file"
if [[ "$output" == true ]]; then printf '%s' "$status"; else printf '{"status":"healthy"}'; fi
SH
chmod +x "$TMP/bin/gcloud" "$TMP/bin/curl"
cp deploy/gcp/config.example.sh "$TMP/config.sh"
cp deploy/gcp/api-secrets.example "$TMP/bindings"
printf '\nDIRECT_DATABASE_URL=ai-workforce-direct-database-url:1\n' >> "$TMP/bindings"
printf '\nSECRET_BINDINGS_FILE=%q\nREDIS_TLS_CA_SECRET=ai-workforce-redis-ca:1\nVPC_NETWORK=default\nVPC_SUBNET=prototype-subnet\nCLOUD_SQL_INSTANCE=fixture:us-central1:postgres\n' "$TMP/bindings" >> "$TMP/config.sh"
bash deploy-gcp.sh --config "$TMP/config.sh" > "$TMP/output"
"${PYTHON_BIN:-python3}" - "$TMP" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
lines = (p/'commands').read_text().splitlines()
api = json.loads((p/'api.json').read_text())
web = json.loads((p/'web.json').read_text())
assert api['PUBLIC_API_URL'] == 'https://api-fixture.run.app'
assert api['CORS_ORIGINS'] == 'https://web-fixture.run.app'
assert api['BACKGROUND_WORKERS_ENABLED'] == 'true'
assert api['REDIS_TLS_CA_FILE'] == '/etc/redis/ca.pem'
assert web['API_INTERNAL_URL'] == api['PUBLIC_API_URL']
assert all('secrets versions access' not in line and '\r' not in line for line in lines)
migration = next(i for i,s in enumerate(lines) if s.startswith('run jobs execute '))
deploys = [i for i,s in enumerate(lines) if s.startswith('run deploy ')]
assert migration < min(deploys)
assert len(deploys) == 4
assert any(line.startswith('services enable ') and 'generativelanguage.googleapis.com' in line for line in lines)
assert any('--no-cpu-throttling' in s and '--max=1' in s for s in lines if s.startswith('run deploy ai-workforce-api '))
assert any('--set-secrets=DATABASE_URL=ai-workforce-direct-database-url:1' in s and '--network=default' in s for s in lines if s.startswith('run jobs deploy '))
assert any('/etc/redis/ca.pem=ai-workforce-redis-ca:1' in s and 'DIRECT_DATABASE_URL=' not in s for s in lines if s.startswith('run deploy ai-workforce-api '))
for line in (s for s in lines if s.startswith('run deploy ai-workforce-api ')):
    assert '--startup-probe=httpGet.path=/health,' in line
    assert '--liveness-probe=httpGet.path=/livez,' in line
    assert '--readiness-probe=httpGet.path=/health,' in line
PY
# Repeated deployment must use discovered URLs and omit private bootstrap revisions.
: > "$TMP/commands"
bash deploy-gcp.sh --config "$TMP/config.sh" > "$TMP/output"
"${PYTHON_BIN:-python3}" - "$TMP/commands" <<'PY'
import sys
lines = open(sys.argv[1]).read().splitlines()
deploys = [s for s in lines if s.startswith('run deploy ')]
assert len(deploys) == 2 and all('--allow-unauthenticated' in s for s in deploys)
PY
# Migration failure must prevent every application deployment.
: > "$TMP/commands"
if GCP_FAIL_MIGRATION=true bash deploy-gcp.sh --config "$TMP/config.sh" > "$TMP/failure" 2>&1; then
  echo 'FAIL: deployment continued after a migration failure' >&2; exit 1
fi
"${PYTHON_BIN:-python3}" - "$TMP/commands" <<'PY'
import sys
assert not any(line.startswith('run deploy ') for line in open(sys.argv[1]))
PY
echo 'PASS: initial URL discovery, secret references, repeat deploy, verification flow, and migration failure gate (local fixtures only).'
