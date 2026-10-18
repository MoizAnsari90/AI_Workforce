# AI Workforce: secure Cloud Shell deployment

Project: `gen-lang-client-0445651739`; default region: `us-central1`.

## 1. Prepare the current source

Upload the current workspace to Cloud Shell, or clone a revision containing these deployment files. Uncommitted local changes do not appear in a GitHub clone. Run all commands from the repository root. Cloud Shell includes Bash, Python 3 and gcloud; no local Docker installation is needed.

```bash
gcloud auth list
gcloud config set project gen-lang-client-0445651739
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
cp -n deploy/gcp/config.example.sh deploy/gcp/config.local.sh
cp -n deploy/gcp/api-secrets.example deploy/gcp/api-secrets.local.txt
cp -n deploy/gcp/api-env.example.json deploy/gcp/api-env.local.json
```

Billing must be linked. The operator needs permission to enable APIs, create service accounts/repositories/buckets, grant the scoped IAM bindings used by the script, submit builds, deploy services/jobs and set public invocation. Organization policies can prohibit public access; do not override those policies automatically. The custom source-build account receives `roles/run.builder`; runtime accounts receive access only to their referenced secrets.

Edit `deploy/gcp/config.local.sh` to use:

```bash
SECRET_BINDINGS_FILE=deploy/gcp/api-secrets.local.txt
API_ENV_FILE=deploy/gcp/api-env.local.json
```

These files contain resource names, pinned secret versions and non-sensitive settings only. Never put credential values in them. Configure VPC/Cloud SQL options there if using private database or Redis endpoints. See [the full networking runbook](CLOUD_RUN_DEPLOYMENT.md).

## 2. Provision credentials without plaintext files

Use a real cloud-accessible PostgreSQL database and Redis instance. A placeholder or ordinary localhost URL cannot work on Cloud Run. Prisma already declares `url = env("DATABASE_URL")`. For a transaction pooler, additionally configure the optional `DIRECT_DATABASE_URL` secret for the migration job.

The following function prompts privately and streams each value to Secret Manager via stdin. Values are not command arguments, shell history entries, exported environment variables or plaintext files. Run in an ordinary Cloud Shell session without HTTP debugging/session recording; leave shell tracing disabled.

```bash
set +x
set -euo pipefail
create_secret() {
  local name="$1" value
  if ! gcloud secrets describe "$name" --project=gen-lang-client-0445651739 >/dev/null 2>&1; then
    gcloud secrets create "$name" --replication-policy=automatic --project=gen-lang-client-0445651739
  fi
  read -r -s -p "Value for $name: " value
  printf '\n' >&2
  if [[ -z "$value" ]]; then echo 'Empty secret rejected' >&2; return 1; fi
  printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project=gen-lang-client-0445651739
  unset value
}
create_secret ai-workforce-database-url
create_secret ai-workforce-redis-url
create_secret ai-workforce-gemini-key
create_secret ai-workforce-jwt-secret
create_secret ai-workforce-integration-key
create_secret ai-workforce-medical-key
create_secret ai-workforce-meta-app-secret
create_secret ai-workforce-meta-verify-token
```

Enter strong randomly generated credentials; both encryption keys require 32 bytes represented by 64 hexadecimal characters. Keep the medical key stable for existing encrypted data. Use PostgreSQL TLS and Redis TLS where required by your provider. Do not paste any secret into this document or chat.

The CLI prints the version number after each addition. Update the **references only** in `api-secrets.local.txt` to those exact numeric versions. New secrets usually start at `1`; rerunning the function adds a new version. Do not assume an existing secret is still version `1`.

The application currently names its optional WhatsApp environment credential `META_ACCESS_TOKEN`, rather than `META_WHATSAPP_TOKEN`. If using this environment credential, create `ai-workforce-meta-access-token` with the same function and uncomment `META_ACCESS_TOKEN=ai-workforce-meta-access-token:VERSION` in the bindings file. Tenant onboarding credentials continue to follow the application's encrypted integration storage flow. Creating a differently named environment variable does not configure a connector.

Required deployment bindings also include the encryption and Meta webhook secrets above, beyond the five credentials listed in the request. The production preflight requires these.

## 3. Review and execute

```bash
bash deploy-cloudrun.sh --dry-run
bash deploy-cloudrun.sh
```

`deploy-cloudrun.sh` reuses the existing deployment orchestrator with source deployment enabled. It:

1. Validates reference syntax and non-secret settings, enables the correct APIs (Cloud Build is **`cloudbuild.googleapis.com`**, not `build.googleapis.com`), and configures separate identities.
2. Builds the API/migration images through the existing Cloud Build configuration. The migration image runs `prisma migrate deploy` once as a Cloud Run Job in the runtime network; any failure stops deployment before services change. The additional API image is retained by this shared build configuration but source mode deploys the API from source.
3. Stages an isolated monorepo context for each service, selecting `apps/api/Dockerfile` or `apps/web/Dockerfile` as its root Dockerfile. Runs `gcloud run deploy SERVICE --source . --build-service-account=...` there. This preserves root lockfile/shared packages, which would be missing from `--source apps/api`. Temporary contexts exclude environment files, credential filenames, private-key formats, dependencies and build output; only application build directories and root manifests are copied.
4. Discovers service URLs through initial private bootstrap revisions, then configures the exact frontend CORS origin, runtime API proxy and OAuth callback URLs. First deployment performs additional source builds for those bootstrap revisions.
5. Deploys the final API and web revisions with `--allow-unauthenticated`. Application JWT and tenant authorization remain required for protected endpoints.
6. Injects credentials using `--set-secrets=ENV=secret:VERSION`. Temporary environment JSON files contain **only non-secret settings**. Secret payloads are never fetched by the deploy script or written into source contexts.
7. Checks readiness, liveness, frontend health, authentication rejection and CORS, then prints the real HTTPS URLs. Failures return nonzero.

Cloud Run supplies `PORT`; the API validates it, binds `0.0.0.0`, and defaults to `8080` in production (`3001` in development). API startup/readiness use `/health`, which checks PostgreSQL and Redis; liveness uses `/livez`. The prototype keeps embedded workers at one API instance with always allocated CPU. This does not certify multi-instance scheduling or provider acceptance.

## 4. Verify and collect submission URLs

```bash
API_URL="$(gcloud run services describe ai-workforce-api --region=us-central1 --project=gen-lang-client-0445651739 --format='value(status.url)')"
WEB_URL="$(gcloud run services describe ai-workforce-web --region=us-central1 --project=gen-lang-client-0445651739 --format='value(status.url)')"
curl --fail --show-error --silent "$API_URL/health"
bash scripts/verify-gcp.sh "$API_URL" "$WEB_URL"
printf '\nSubmission dashboard: %s\nProduction API: %s\n' "$WEB_URL" "$API_URL"
```

Test an actual Gemini request and each connector used in the demo with authorized test accounts before submitting. Health checks do not verify Gemini quota, model access, WhatsApp approval or other external-provider credentials.

## Security review scope and references

The repository `.gitignore` covers `.env` variants at all directory levels, private-key files, credential filename patterns and `secrets/`, while allowing `.env.example` templates. Docker/Cloud Build upload ignores also exclude local environment files and credential files. Ignore rules do not remove already tracked files or scrub Git history: review any reported tracked credential files before publishing. Filename filters cannot identify an arbitrary secret pasted into an ordinary source file; keep code review and repository secret scanning enabled.

Official references: [source deployment and build identities](https://docs.cloud.google.com/run/docs/deploying-source-code), [gcloud deployment flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy), [Secret Manager integration](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

This runbook contains execution steps, not a live deployment success claim. Production URLs are available only after an authenticated deployment completes.
