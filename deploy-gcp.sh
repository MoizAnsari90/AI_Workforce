#!/usr/bin/env bash
# Run with Bash (also from zsh: bash deploy-gcp.sh). No secret payloads are read.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
DRY_RUN=false
CONFIG_FILE=deploy/gcp/config.local.sh
while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --config) CONFIG_FILE="${2:?--config requires a path}"; shift 2 ;;
    --help) echo 'bash deploy-gcp.sh [--config deploy/gcp/config.local.sh] [--dry-run]'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done
if [[ ! -f "$CONFIG_FILE" && "$DRY_RUN" == true ]]; then CONFIG_FILE=deploy/gcp/config.example.sh; fi
[[ -f "$CONFIG_FILE" ]] || { echo 'Copy deploy/gcp/config.example.sh to config.local.sh first.' >&2; exit 1; }
# This is an operator-owned shell configuration file, not downloaded input.
source "$CONFIG_FILE"
: "${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}" "${GCP_REGION:?Set GCP_REGION}"
: "${GEMINI_MODEL:?Select an accessible Gemini model}" "${GEMINI_EMBEDDING_MODEL:?Select an embedding model}"
[[ "$GCP_PROJECT_ID" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo 'Invalid project ID' >&2; exit 1; }
for value in "$GCP_REGION" "$ARTIFACT_REPOSITORY" "$API_SERVICE" "$WEB_SERVICE" "$MIGRATION_JOB"; do
  [[ "$value" =~ ^[a-z][a-z0-9-]*[a-z0-9]$ ]] || { echo 'Invalid region/resource identifier' >&2; exit 1; }
done
PYTHON_BIN="${PYTHON_BIN:-python3}"
command -v "$PYTHON_BIN" >/dev/null || { echo 'Install Python 3 (available in Cloud Shell).' >&2; exit 1; }
if [[ "$DRY_RUN" == false ]]; then
  command -v gcloud >/dev/null || { echo 'Install Google Cloud CLI, or run this script in Google Cloud Shell.' >&2; exit 1; }
  if [[ -z "$(gcloud auth list --filter=status:ACTIVE --format='value(account)')" ]]; then gcloud auth login; fi
fi
run() { printf '+ '; printf '%q ' "$@"; printf '\n'; if [[ "$DRY_RUN" == false ]]; then "$@"; fi; }
TMP_DIR="$(mktemp -d)"
# Remove only known generated files; never recursively delete a computed directory.
cleanup() { rm -f -- "$TMP_DIR/api.json" "$TMP_DIR/web.json" "$TMP_DIR/bindings"; rmdir -- "$TMP_DIR"; }
trap cleanup EXIT

# Validate bindings without accessing payloads; the file contains names and versions only.
"$PYTHON_BIN" - "$SECRET_BINDINGS_FILE" "$API_ENV_FILE" > "$TMP_DIR/bindings" <<'PY'
import json, re, sys
sys.stdout.reconfigure(newline='\n')
items = {}
for line in open(sys.argv[1], encoding='utf-8-sig'):
    line = line.strip()
    if not line or line.startswith('#'): continue
    if not re.fullmatch(r'[A-Z][A-Z0-9_]*=[A-Za-z0-9_-]+:[1-9][0-9]*', line):
        raise SystemExit('Invalid secret reference; use ENV=secret-name:numeric-version')
    key, value = line.split('=', 1)
    if key in items: raise SystemExit('Duplicate secret environment variable: ' + key)
    if key in ('PORT', 'NODE_ENV', 'WEB_APP_URL', 'PUBLIC_API_URL', 'CORS_ORIGINS', 'BACKGROUND_WORKERS_ENABLED'):
        raise SystemExit('Reserved variable in secret references: ' + key)
    items[key] = value
required = {'DATABASE_URL','REDIS_URL','GEMINI_API_KEY','JWT_SECRET','INTEGRATION_ENCRYPTION_KEY','MEDICAL_DATA_ENCRYPTION_KEY','META_APP_SECRET','META_VERIFY_TOKEN'}
missing = required - items.keys()
if missing: raise SystemExit('Missing secret references: ' + ', '.join(sorted(missing)))
data = json.load(open(sys.argv[2], encoding='utf-8-sig'))
if not isinstance(data, dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in data.items()):
    raise SystemExit('API_ENV_FILE must be a JSON object with string values')
if any(k in items or k in ('PORT','K_SERVICE','K_REVISION','K_CONFIGURATION','DIRECT_DATABASE_URL') or re.search(r'SECRET|PASSWORD|TOKEN|API_KEY', k) for k in data):
    raise SystemExit('Keep credentials/reserved Cloud Run variables out of API_ENV_FILE')
for key, value in items.items(): print(key + '=' + value)
PY
API_SECRETS=()
DATABASE_REF=
DIRECT_REF=
while IFS='=' read -r key ref; do
  [[ "$key" != DIRECT_DATABASE_URL ]] && API_SECRETS+=("$key=$ref")
  [[ "$key" == DATABASE_URL ]] && DATABASE_REF="$ref"
  [[ "$key" == DIRECT_DATABASE_URL ]] && DIRECT_REF="$ref"
done < "$TMP_DIR/bindings"
MIGRATION_REF="${DIRECT_REF:-$DATABASE_REF}"
API_SECRET_LIST="$(IFS=,; echo "${API_SECRETS[*]}")"
NETWORK_FLAGS=()
if [[ -n "${VPC_CONNECTOR:-}" ]]; then
  [[ -z "${VPC_NETWORK:-}${VPC_SUBNET:-}" ]] || { echo 'Choose Direct VPC or a connector, not both.' >&2; exit 1; }
  NETWORK_FLAGS=(--vpc-connector="$VPC_CONNECTOR" --vpc-egress=private-ranges-only)
elif [[ -n "${VPC_NETWORK:-}${VPC_SUBNET:-}" ]]; then
  : "${VPC_NETWORK:?Set VPC_NETWORK}" "${VPC_SUBNET:?Set VPC_SUBNET}"
  NETWORK_FLAGS=(--network="$VPC_NETWORK" --subnet="$VPC_SUBNET" --vpc-egress=private-ranges-only)
fi
SQL_FLAGS=()
[[ -n "${CLOUD_SQL_INSTANCE:-}" ]] && SQL_FLAGS=(--set-cloudsql-instances="$CLOUD_SQL_INSTANCE")

run gcloud config set project "$GCP_PROJECT_ID"
if [[ "$DRY_RUN" == false ]]; then
  billing="$(gcloud billing projects describe "$GCP_PROJECT_ID" --format='value(billingEnabled)')"
  if [[ "${billing,,}" != true ]]; then echo 'Link an active billing account to this project before deploying.' >&2; exit 1; fi
fi
APIS=(run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com iam.googleapis.com storage.googleapis.com logging.googleapis.com generativelanguage.googleapis.com)
[[ -n "${VPC_NETWORK:-}${VPC_CONNECTOR:-}" ]] && APIS+=(compute.googleapis.com)
[[ -n "${VPC_CONNECTOR:-}" ]] && APIS+=(vpcaccess.googleapis.com)
[[ -n "${CLOUD_SQL_INSTANCE:-}" ]] && APIS+=(sqladmin.googleapis.com)
run gcloud services enable "${APIS[@]}" --project="$GCP_PROJECT_ID"

API_SA="ai-workforce-api@$GCP_PROJECT_ID.iam.gserviceaccount.com"
WEB_SA="ai-workforce-web@$GCP_PROJECT_ID.iam.gserviceaccount.com"
MIGRATE_SA="ai-workforce-migrate@$GCP_PROJECT_ID.iam.gserviceaccount.com"
BUILD_SA="ai-workforce-build@$GCP_PROJECT_ID.iam.gserviceaccount.com"
for account in "$API_SA" "$WEB_SA" "$MIGRATE_SA" "$BUILD_SA"; do
  if [[ "$DRY_RUN" == true ]] || ! gcloud iam service-accounts describe "$account" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
    run gcloud iam service-accounts create "${account%%@*}" --project="$GCP_PROJECT_ID"
  fi
done
if [[ "$DRY_RUN" == true ]]; then OPERATOR=user:operator@example.invalid;
else
  account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)')"
  if [[ "$account" == *.gserviceaccount.com ]]; then OPERATOR="serviceAccount:$account"; else OPERATOR="user:$account"; fi
fi
for account in "$API_SA" "$WEB_SA" "$MIGRATE_SA" "$BUILD_SA"; do
  run gcloud iam service-accounts add-iam-policy-binding "$account" --project="$GCP_PROJECT_ID" --member="$OPERATOR" --role=roles/iam.serviceAccountUser --quiet
done
while IFS='=' read -r key ref; do
  secret="${ref%:*}"; version="${ref##*:}"
  if [[ "$DRY_RUN" == false && "$(gcloud secrets versions describe "$version" --secret="$secret" --project="$GCP_PROJECT_ID" --format='value(state)')" != ENABLED ]]; then
    echo "Secret version is unavailable: $secret:$version" >&2; exit 1
  fi
  if [[ "$key" != DIRECT_DATABASE_URL ]]; then
    run gcloud secrets add-iam-policy-binding "$secret" --project="$GCP_PROJECT_ID" --member="serviceAccount:$API_SA" --role=roles/secretmanager.secretAccessor --quiet
  fi
done < "$TMP_DIR/bindings"
if [[ -n "${REDIS_TLS_CA_SECRET:-}" ]]; then
  [[ "$REDIS_TLS_CA_SECRET" =~ ^[A-Za-z0-9_-]+:[1-9][0-9]*$ ]] || { echo 'Invalid Redis CA secret reference' >&2; exit 1; }
  if [[ "$DRY_RUN" == false && "$(gcloud secrets versions describe "${REDIS_TLS_CA_SECRET##*:}" --secret="${REDIS_TLS_CA_SECRET%:*}" --project="$GCP_PROJECT_ID" --format='value(state)')" != ENABLED ]]; then
    echo 'Redis CA secret version is unavailable' >&2; exit 1
  fi
  run gcloud secrets add-iam-policy-binding "${REDIS_TLS_CA_SECRET%:*}" --project="$GCP_PROJECT_ID" --member="serviceAccount:$API_SA" --role=roles/secretmanager.secretAccessor --quiet
  API_SECRET_LIST+=",/etc/redis/ca.pem=$REDIS_TLS_CA_SECRET"
fi
run gcloud secrets add-iam-policy-binding "${MIGRATION_REF%:*}" --project="$GCP_PROJECT_ID" --member="serviceAccount:$MIGRATE_SA" --role=roles/secretmanager.secretAccessor --quiet
if [[ -n "${CLOUD_SQL_INSTANCE:-}" ]]; then
  for account in "$API_SA" "$MIGRATE_SA"; do
    run gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$account" --role=roles/cloudsql.client --quiet
  done
fi
if [[ "$DRY_RUN" == true ]] || ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
  run gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" --repository-format=docker --location="$GCP_REGION" --project="$GCP_PROJECT_ID"
fi
BUILD_BUCKET="gs://$GCP_PROJECT_ID-ai-workforce-builds"
if [[ "$DRY_RUN" == true ]] || ! gcloud storage buckets describe "$BUILD_BUCKET" >/dev/null 2>&1; then
  run gcloud storage buckets create "$BUILD_BUCKET" --location="$GCP_REGION" --uniform-bucket-level-access --project="$GCP_PROJECT_ID"
fi
run gcloud storage buckets add-iam-policy-binding "$BUILD_BUCKET" --member="serviceAccount:$BUILD_SA" --role=roles/storage.objectViewer --quiet
run gcloud artifacts repositories add-iam-policy-binding "$ARTIFACT_REPOSITORY" --location="$GCP_REGION" --project="$GCP_PROJECT_ID" --member="serviceAccount:$BUILD_SA" --role=roles/artifactregistry.writer --quiet
run gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$BUILD_SA" --role=roles/logging.logWriter --quiet
if [[ "${GCP_DEPLOY_FROM_SOURCE:-false}" == true ]]; then
  run gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" --member="serviceAccount:$BUILD_SA" --role=roles/run.builder --quiet
fi

TAG="${IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"
[[ "$TAG" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || { echo 'Invalid image tag' >&2; exit 1; }
IMAGE_ROOT="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT_ID/$ARTIFACT_REPOSITORY"
API_IMAGE="$IMAGE_ROOT/api:$TAG"; MIGRATION_IMAGE="$IMAGE_ROOT/migration:$TAG"; WEB_IMAGE="$IMAGE_ROOT/web:$TAG"
BUILD_FLAGS=(--project="$GCP_PROJECT_ID" --region="$GCP_REGION" --service-account="projects/$GCP_PROJECT_ID/serviceAccounts/$BUILD_SA" --gcs-source-staging-dir="$BUILD_BUCKET/source" --timeout=1800s)
run gcloud builds submit . --config=deploy/gcp/cloudbuild-api.yaml --substitutions="_API_IMAGE=$API_IMAGE,_MIGRATION_IMAGE=$MIGRATION_IMAGE" "${BUILD_FLAGS[@]}"
if [[ "${GCP_DEPLOY_FROM_SOURCE:-false}" != true ]]; then
  run gcloud builds submit . --config=deploy/gcp/cloudbuild-web.yaml --substitutions="_WEB_IMAGE=$WEB_IMAGE" "${BUILD_FLAGS[@]}"
fi

# Run DDL once, in the runtime network, before deploying either application revision.
run gcloud run jobs deploy "$MIGRATION_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --image="$MIGRATION_IMAGE" --service-account="$MIGRATE_SA" --set-secrets="DATABASE_URL=$MIGRATION_REF" --set-env-vars=NODE_ENV=production --tasks=1 --parallelism=1 --max-retries=0 --task-timeout=600s --cpu=1 --memory=512Mi "${NETWORK_FLAGS[@]}" "${SQL_FLAGS[@]}" --quiet
run gcloud run jobs execute "$MIGRATION_JOB" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --wait --quiet

write_web_env() {
  "$PYTHON_BIN" - "$TMP_DIR/web.json" "$1" <<'PY'
import json, sys
json.dump({'NODE_ENV':'production','API_INTERNAL_URL':sys.argv[2],'API_URL':sys.argv[2]}, open(sys.argv[1], 'w'))
PY
}
write_api_env() {
  "$PYTHON_BIN" - "$TMP_DIR/api.json" "$API_ENV_FILE" "$1" "$2" "$3" "$GEMINI_MODEL" "$GEMINI_EMBEDDING_MODEL" "${EXTRA_CORS_ORIGINS:-}" "$TMP_DIR/bindings" <<'PY'
import json, re, sys
target, source, api, web, workers, model, embedding, extra, bindings = sys.argv[1:]
data = json.load(open(source, encoding='utf-8-sig'))
secrets = {line.split('=',1)[0] for line in open(bindings)}
if not isinstance(data, dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in data.items()):
    raise SystemExit('API_ENV_FILE must be a JSON object with string values')
if any(k in secrets or k in ('PORT','K_SERVICE','K_REVISION','K_CONFIGURATION','DIRECT_DATABASE_URL') or re.search(r'SECRET|PASSWORD|TOKEN|API_KEY', k) for k in data):
    raise SystemExit('Keep credentials/reserved Cloud Run variables out of API_ENV_FILE')
data.update(NODE_ENV='production', PUBLIC_API_URL=api, WEB_APP_URL=web, CORS_ORIGINS=','.join(filter(None,[web,extra])), TRUST_PROXY_HOPS='1', BACKGROUND_WORKERS_ENABLED=workers, GEMINI_MODEL=model, GEMINI_EMBEDDING_MODEL=embedding, GOOGLE_CALENDAR_REDIRECT_URI=web+'/api/calendar/google/callback', SHOPIFY_REDIRECT_URI=api+'/api/v1/shopify/oauth/callback')
json.dump(data, open(target,'w'))
PY
  if [[ -n "${REDIS_TLS_CA_SECRET:-}" ]]; then
    "$PYTHON_BIN" - "$TMP_DIR/api.json" <<'PY'
import json,sys
p=sys.argv[1]; data=json.load(open(p)); data['REDIS_TLS_CA_FILE']='/etc/redis/ca.pem'; json.dump(data,open(p,'w'))
PY
  fi
}
service_url() {
  if [[ "$DRY_RUN" == true ]]; then echo "https://$1-dry-run.run.app";
  else gcloud run services describe "$1" --project="$GCP_PROJECT_ID" --region="$GCP_REGION" --format='value(status.url)'; fi
}
WEB_FLAGS=(--project="$GCP_PROJECT_ID" --region="$GCP_REGION" --image="$WEB_IMAGE" --service-account="$WEB_SA" --port=8080 --cpu=1 --memory=512Mi --min=0 --max=3 --concurrency=40 --timeout=60s --env-vars-file="$TMP_DIR/web.json" --quiet)
API_FLAGS=(--project="$GCP_PROJECT_ID" --region="$GCP_REGION" --image="$API_IMAGE" --service-account="$API_SA" --port=8080 --cpu=1 --memory=1Gi --no-cpu-throttling --min=1 --max=1 --max-instances=1 --concurrency=40 --timeout=3600s --session-affinity --env-vars-file="$TMP_DIR/api.json" --set-secrets="$API_SECRET_LIST" --startup-probe=httpGet.path=/health,httpGet.port=8080,periodSeconds=10,timeoutSeconds=5,failureThreshold=24 --liveness-probe=httpGet.path=/livez,httpGet.port=8080,periodSeconds=30,timeoutSeconds=2,failureThreshold=3 --readiness-probe=httpGet.path=/health,httpGet.port=8080,periodSeconds=10,timeoutSeconds=5,failureThreshold=3,successThreshold=1 "${NETWORK_FLAGS[@]}" "${SQL_FLAGS[@]}" --quiet)
WEB_URL=
API_URL=
deploy_service() {
  local service="$1"; shift
  if [[ "${GCP_DEPLOY_FROM_SOURCE:-false}" == true ]]; then
    local flags=() flag
    for flag in "$@"; do [[ "$flag" == --image=* ]] || flags+=("$flag"); done
    if [[ "$DRY_RUN" == true ]]; then
      echo "# Source deployment from an isolated monorepo context using apps/${service##ai-workforce-}/Dockerfile"
      run gcloud run deploy "$service" --source . --build-service-account="projects/$GCP_PROJECT_ID/serviceAccounts/$BUILD_SA" "${flags[@]}"
    else
      local app=web
      [[ "$service" != "$API_SERVICE" ]] || app=api
      "$PYTHON_BIN" scripts/deploy-cloudrun-source.py "$app" "$service" --build-service-account="projects/$GCP_PROJECT_ID/serviceAccounts/$BUILD_SA" "${flags[@]}"
    fi
  else
    run gcloud run deploy "$service" "$@"
  fi
}
if [[ "$DRY_RUN" == false ]]; then
  WEB_URL="$(service_url "$WEB_SERVICE" 2>/dev/null || true)"
  API_URL="$(service_url "$API_SERVICE" 2>/dev/null || true)"
fi
# Initial private bootstrap discovers URLs without guessing project numbers or hashes.
if [[ -z "$WEB_URL" ]]; then
  write_web_env https://bootstrap.invalid
  deploy_service "$WEB_SERVICE" "${WEB_FLAGS[@]}" --no-allow-unauthenticated
  WEB_URL="$(service_url "$WEB_SERVICE")"
fi
if [[ -z "$API_URL" ]]; then
  write_api_env "$WEB_URL" "$WEB_URL" false
  deploy_service "$API_SERVICE" "${API_FLAGS[@]}" --no-allow-unauthenticated
  API_URL="$(service_url "$API_SERVICE")"
fi
[[ "$WEB_URL" == https://* && "$API_URL" == https://* ]] || { echo 'Cloud Run service URL discovery failed' >&2; exit 1; }
write_api_env "$API_URL" "$WEB_URL" true
deploy_service "$API_SERVICE" "${API_FLAGS[@]}" --allow-unauthenticated
write_web_env "$API_URL"
deploy_service "$WEB_SERVICE" "${WEB_FLAGS[@]}" --allow-unauthenticated
if [[ "$DRY_RUN" == false ]]; then bash scripts/verify-gcp.sh "$API_URL" "$WEB_URL"; fi
printf '\nAPI: %s\nWeb: %s\nImage tag: %s\n' "$API_URL" "$WEB_URL" "$TAG"
if [[ "$DRY_RUN" == true ]]; then echo 'DRY RUN: no cloud resources were accessed or changed; displayed URLs are illustrative.'; fi
