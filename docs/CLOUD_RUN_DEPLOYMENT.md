# AI Workforce: Google Cloud Run Deployment

**Project ID:** `gen-lang-client-0445651739`
**Default region:** `us-central1`
**Topology:** Public Next.js service + public authenticated Express API + one-shot Prisma migration job; external managed PostgreSQL and Redis.

This setup prepares a working prototype deployment. Cloud resources and live integrations must still be verified in the target project. It provisions deployment infrastructure, not a database or Redis server.

## 1. Architecture and resource choices

| Resource | Configuration | Purpose |
| --- | --- | --- |
| `ai-workforce-web` | 1 CPU, 512 MiB, 0–3 instances, port 8080 | Next.js standalone server; server-side backend proxy. |
| `ai-workforce-api` | 1 CPU, 1 GiB, minimum/maximum 1 instance, CPU always allocated | HTTP API, Socket.io, BullMQ worker, and existing in-process schedulers. |
| `ai-workforce-migrate` | 1 task, parallelism 1, no automatic retries, 10-minute timeout | Apply checked-in Prisma migrations before application deployment. |
| Artifact Registry | Regional Docker repository | API, frontend, and migration images. |
| Secret Manager | Pinned numeric secret versions | Database, Redis, Gemini, JWT, encryption, and connector credentials. |
| Cloud Build | Dedicated build service account and source bucket | Linux image builds without runtime secret payloads. |

The API uses instance-based billing and a minimum instance because BullMQ and timers must run without incoming HTTP requests. This incurs idle-instance charges. Instances can still restart; this configuration is not a process-lifetime guarantee. See [Cloud Run billing and background processing](https://cloud.google.com/run/docs/configuring/billing-settings).

The API cap deliberately limits steady-state replicas: Socket.io rooms are currently process-local, and schedulers are embedded in the API. Rolling revisions and infrastructure events can still overlap. Before horizontal scaling, implement shared Socket.io state, distributed scheduling coordination, and a separate worker deployment. WebSocket clients must reconnect; session affinity is best effort, and connections remain subject to request timeouts. See [Cloud Run WebSockets](https://cloud.google.com/run/docs/triggering/websockets).

## 2. Files included

| File | Responsibility |
| --- | --- |
| [`apps/api/Dockerfile`](../apps/api/Dockerfile) | Cached build stages, Prisma generation, production-only API dependencies, non-root runtime, and separate migration target. |
| [`apps/web/Dockerfile`](../apps/web/Dockerfile) | Standalone Next.js runtime with traced dependencies, static assets, and non-root execution. |
| [`.dockerignore`](../.dockerignore) / [`.gcloudignore`](../.gcloudignore) | Exclude local credentials, environment files, caches, and build outputs from image/source uploads. |
| [`deploy-gcp.sh`](../deploy-gcp.sh) | API enablement, IAM/resource setup, image builds, migrations, service deployment, and verification. |
| [`deploy/gcp`](../deploy/gcp/config.example.sh) | Operator configuration, secret-reference and nonsecret environment examples, and Cloud Build definitions. |
| [`scripts/run-migrations.cjs`](../scripts/run-migrations.cjs) | Select the migration connection and propagate Prisma failure as a nonzero job exit. |
| [`scripts/verify-gcp.sh`](../scripts/verify-gcp.sh) | Dependency health, frontend/proxy routing, unauthenticated guards, and CORS checks. |

Serving images exclude the development toolchain. The migration image additionally installs the pinned Prisma CLI and includes migration SQL/native engines. Secrets are neither Docker build arguments nor Cloud Build substitutions.

### Requirements mapped to this repository

| Requested deliverable | Implemented setup |
| --- | --- |
| API/web multi-stage containers | Separate Dockerfiles; the API has serving and migration targets. |
| Prisma generation and dependency pruning | Generate in the build stage; serving dependencies omit dev/optional tooling. |
| Project APIs, images and public service deployment | `deploy-gcp.sh` enables APIs, submits Cloud Build jobs and deploys both services. |
| Credentials and runtime configuration | Pinned Secret Manager references plus nonsecret environment JSON; no secret build arguments. |
| Clean migrations | A one-shot Cloud Run Job completes before either application is deployed. |
| Dynamic port and CORS | API uses validated `process.env.PORT` through `env.PORT`, binds `0.0.0.0`, and receives the discovered frontend origin. |
| Frontend API address | Server-side runtime proxy; `NEXT_PUBLIC_API_URL` is not needed by this frontend. |
| Deployment acceptance | `scripts/verify-gcp.sh` checks health, authentication rejection, API forwarding and CORS. |

The actual Next.js configuration file is `apps/web/next.config.ts`; this repository does not use `next.config.js`.

### Immediate pre-deployment checklist

- Confirm PostgreSQL is reachable from the selected Cloud Run network. A workstation `localhost` URL is unsuitable; a configured Cloud SQL Unix socket is the documented exception. Use a direct DDL URL when the application uses a transaction pooler.
- Confirm a BullMQ-compatible Redis endpoint is reachable from the API, with TLS/private networking and `noeviction` configured as appropriate.
- Populate the required Secret Manager versions and review the ignored local configuration files. Preserve existing encryption keys when moving existing records.
- The API's dynamic port binding is implemented; the script sets container port 8080 and supplies the real deployed frontend URL to CORS automatically.
- Confirm billing, operator IAM and a current gcloud CLI. Run the dry run, then deploy and require the verification script to pass before treating the prototype as live.

## 3. Project and operator prerequisites

Open [Cloud Shell for this project](https://shell.cloud.google.com/?project=gen-lang-client-0445651739), or install a current Google Cloud CLI locally. Cloud Shell provides Bash, Python 3, and gcloud. Upload the current source tree or commit/push these changes before cloning it there; cloning an older repository revision will not include this setup. Work from the directory containing the root `package.json`.

```bash
gcloud auth list
# Only if no active account is available:
gcloud auth login
gcloud config set project gen-lang-client-0445651739
gcloud billing projects describe gen-lang-client-0445651739
```

Link an active billing account in the console if necessary. The bootstrap operator needs permissions to enable services, create service accounts/repositories/buckets, assign the scoped IAM bindings, submit builds, deploy/manage Cloud Run services/jobs, and configure public invocation. An administrator can provide the relevant Service Usage Admin, Service Account Admin, Project IAM Admin, Artifact Registry Admin, Storage Admin, Cloud Build Editor, Cloud Run Admin, and Secret Manager administration permissions for bootstrap; runtime accounts do not receive these administrative roles.

The script creates separate API, web, migration, and build identities. API secret access is granted per referenced secret; the migration identity accesses only its selected database secret. The build identity gets source-bucket read, repository write, and project log-write access; the web identity gets no secret grants. The invoking account gets Service Account User on the four deployment identities. See [user-managed Cloud Build accounts](https://cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts).

Enable Secret Manager before creating payloads; the deployment script also enables its complete required API set:

```bash
gcloud services enable secretmanager.googleapis.com --project=gen-lang-client-0445651739
cp deploy/gcp/config.example.sh deploy/gcp/config.local.sh
cp deploy/gcp/api-secrets.example deploy/gcp/api-secrets.local.txt
cp deploy/gcp/api-env.example.json deploy/gcp/api-env.local.json
```

Edit `config.local.sh` to point `SECRET_BINDINGS_FILE` and `API_ENV_FILE` at those local copies. Select a Gemini model accessible to your key. These local configuration files are ignored by Git and cloud/image uploads.

## 4. Database and Redis connectivity

Use a cloud-accessible PostgreSQL endpoint. Local workstation addresses are unavailable to Cloud Run. For a public managed endpoint, use the provider's TLS connection string. A small Prisma pool, such as `connection_limit=5`, helps bound connections; choose the actual limit against your database capacity.

Use a direct connection for DDL when the runtime uses a transaction pooler. Add a `DIRECT_DATABASE_URL` secret reference to the bindings file; only the migration job receives that secret as its `DATABASE_URL`. Without it, the job uses the runtime database secret. The Prisma schema remains compatible with existing local development configuration.

For Cloud SQL, set `CLOUD_SQL_INSTANCE=PROJECT:REGION:INSTANCE`. The script enables its API, grants Cloud SQL Client to API/migration identities, and attaches the instance to both. A supported socket URL has this shape, with URL-encoded credentials:

```text
postgresql://USER:PASSWORD@localhost/DATABASE?host=/cloudsql/PROJECT:REGION:INSTANCE&connection_limit=5
```

For private-IP PostgreSQL or Redis, configure either `VPC_NETWORK` plus `VPC_SUBNET`, or `VPC_CONNECTOR`. The subnet/connector must be in the selected region, with firewall access to the managed services. The same network options are applied to the API and migration job. Public integration traffic remains on public egress with `private-ranges-only`. Shared VPC requires additional host-project permissions. See [Direct VPC setup](https://cloud.google.com/run/docs/configuring/vpc-direct-vpc).

Redis supports `redis://` for private plaintext transport and `rediss://` for TLS, including URL-encoded ACL credentials. Use a BullMQ-compatible Redis endpoint with required commands enabled and eviction disabled (`noeviction`). Prefer Redis persistence/high availability where offered; Cloud Run's ephemeral filesystem is not queue storage.

```text
rediss://default:URL_ENCODED_PASSWORD@PROVIDER_HOST:6380/0
redis://PRIVATE_IP:6379/0
```

If TLS requires a private certificate authority, create a CA secret and set `REDIS_TLS_CA_SECRET=secret-name:1`. The script mounts it at `/etc/redis/ca.pem` and configures `REDIS_TLS_CA_FILE`. Certificate verification remains enabled. Verify managed database backups and restore outside this deployment script.

## 5. Secure secret injection

The bindings file contains references such as `GEMINI_API_KEY=ai-workforce-gemini-key:1`, never payloads. Create the named secrets through Secret Manager or this interactive Cloud Shell helper; entered values do not appear in command arguments or shell history:

```bash
create_secret() {
  local value
  read -r -s -p "Value for $1: " value
  printf '\n'
  if [[ -z "$value" ]]; then echo 'Empty value rejected'; return 1; fi
  printf '%s' "$value" | gcloud secrets create "$1" \
    --project=gen-lang-client-0445651739 \
    --replication-policy=automatic --data-file=-
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

Preserve existing integration and medical encryption keys when moving encrypted records. JWT/integration keys require at least 32 characters; the medical key requires exactly 64 hexadecimal characters. For a new installation, `openssl rand -hex 32` generates a suitable random value; paste it without a trailing newline. Existing secrets should be reused or explicitly versioned, not silently recreated. Numeric versions are pinned for reproducible rollouts. See [Cloud Run Secret Manager binding](https://cloud.google.com/run/docs/configuring/secrets).

| Setting | Source / behavior |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL`, `GEMINI_API_KEY`, `JWT_SECRET` | Required Secret Manager references. |
| Encryption and Meta webhook secrets | Required references enforced by the existing production configuration policy. |
| `PORT` | Set by Cloud Run through `--port=8080`; never add it to env/secrets files. Express binds `0.0.0.0`. |
| `WEB_APP_URL`, `PUBLIC_API_URL`, `CORS_ORIGINS` | Generated from discovered service URLs. Optional additional HTTPS origins come from `EXTRA_CORS_ORIGINS`. |
| `API_INTERNAL_URL`, `API_URL` | Frontend server receives the actual HTTPS API origin at runtime. |
| `NEXT_PUBLIC_API_URL` | Unnecessary for the current frontend, which uses server-side proxies. Public-prefixed variables are build-time browser configuration; changing a Cloud Run runtime value alone does not rewrite a browser bundle. |
| Connector identifiers and feature settings | Put nonsecret values in `api-env.local.json`; add secret references for enabled connectors. |

The API-key Gemini integration is unchanged. The script enables `generativelanguage.googleapis.com` for Gemini Developer API access alongside the hosting APIs. Confirm that the supplied key belongs to the intended project and its API restrictions permit Gemini calls. Google Cloud service-account identities secure deployment/secrets; this setup does not convert Gemini calls to Vertex AI.

## 6. Build, migrate, and deploy

```bash
# Inspect planned commands without accessing or changing cloud resources:
bash deploy-gcp.sh --config deploy/gcp/config.local.sh --dry-run

# Build three images and deploy the prototype:
bash deploy-gcp.sh --config deploy/gcp/config.local.sh
```

The script performs these operations in order:

1. Validate identifiers, reference syntax, and nonsecret environment data; check billing and enable APIs.
2. Configure identities, scoped access, Artifact Registry, and a private build-source bucket.
3. Submit Linux API/migration and web image builds to Cloud Build using the dedicated build identity.
4. Deploy the migration job and run it with `gcloud run jobs execute ... --wait`. Failure stops the script before application deployment.
5. On first deployment, create private bootstrap services to discover their real URLs. The API bootstrap has workers disabled; the temporary frontend backend address is intentionally inactive.
6. Deploy the final API and web revisions with correct URLs and `--allow-unauthenticated`. Application JWT/RBAC and signed provider webhooks remain enforced.
7. Verify dependency readiness, runtime routing, authentication guards, and CORS; print the actual URLs and image tag.

Migrations run neither during Cloud Build nor on every service instance startup. The job uses the runtime network and exits after Prisma completes. Serialize deployments to a shared database and review migration compatibility/backups before release; automatic migration repair is deliberately absent. If a migration fails, inspect its job logs and Prisma history before retrying. See [Cloud Run job execution](https://cloud.google.com/run/docs/execute/jobs).

First deployment uses a short private bootstrap to resolve the two services' URL dependency. Subsequent runs reuse discovered URLs and skip bootstrap. Organization policies that prohibit `allUsers` invocation require an administrator-approved alternative; the script does not bypass those policies. IAM propagation delays can require a retry. Changing an existing service's networking topology may require explicitly clearing its old network/connector settings first.

## 7. Verification and integration callbacks

```bash
API_URL="$(gcloud run services describe ai-workforce-api --region=us-central1 --format='value(status.url)')"
WEB_URL="$(gcloud run services describe ai-workforce-web --region=us-central1 --format='value(status.url)')"
bash scripts/verify-gcp.sh "$API_URL" "$WEB_URL"

gcloud run services logs read ai-workforce-api --region=us-central1 --limit=50
gcloud run jobs executions list --job=ai-workforce-migrate --region=us-central1
```

`/livez` checks API process liveness; `/health` checks PostgreSQL and Redis. The startup probe checks `/health` before a new instance receives its first traffic, with a four-minute retry window. Liveness remains on `/livez`, so a later dependency outage does not itself trigger repeated process restarts. The readiness probe also checks `/health` and pauses new traffic during subsequent dependency failures. Use a current gcloud version supporting readiness probes. The web exposes `/api/health`. See [Cloud Run health checks](https://cloud.google.com/run/docs/configuring/healthchecks).

Register and log in through the deployed frontend; confirm secure cookies, dashboard access, and tenant boundaries. Register these exact callback URLs with the corresponding providers:

| Provider | Callback / configuration |
| --- | --- |
| Meta WhatsApp | `$API_URL/api/v1/webhook/whatsapp`; matching verify token and app secret, with tenant numbers connected through onboarding. |
| Google Calendar | `$WEB_URL/api/calendar/google/callback`; client ID in nonsecret config and client secret in Secret Manager. |
| Shopify | `$API_URL/api/v1/shopify/oauth/callback`; matching app allowlist/client credentials. |
| WooCommerce | `$API_URL/api/v1/woocommerce/oauth/callback`; set `WOOCOMMERCE_CALLBACK_URL` in nonsecret config if enabled. |
| Vapi | Use the workspace-specific webhook URL shown by the deployed dashboard; configure provider authentication. |

Complete controlled Gemini inference, WhatsApp send/receive/delivery, commerce reads, Calendar create/cancel, and any enabled voice flow before presenting the prototype. The automated deployment checks do not place calls, take payments, or send customer messages.

## 8. Local validation and operational limits

```bash
npm run build
npm test
SMOKE_STANDALONE=1 npm run test:web:smoke
bash scripts/test-gcp-deploy.sh
# Optional actual Linux image/runtime verification with isolated synthetic data:
docker build --target migration -f apps/api/Dockerfile -t ai-workforce-migration:local-check .
docker build --target runner -f apps/api/Dockerfile -t ai-workforce-api:local-check .
docker build -f apps/web/Dockerfile -t ai-workforce-web:local-check .
node scripts/smoke-gcp-containers.mjs
```

The deployment fixture test substitutes local `gcloud` and `curl` implementations. It checks bootstrap/redeploy behavior, environment routing, direct migration connections, private networking/TLS secret mounting, and the migration-failure gate; it is not proof of GCP IAM or image execution. Cloud Build validates the target project's image builds.

The optional container smoke test requires a running Linux/amd64 Docker engine. It pulls PostgreSQL/Redis fixture images, creates an internal-only labelled network, applies migrations, and starts the actual non-root API/web images with synthetic credentials. It verifies dynamic ports, cross-container binding, health, authentication rejection, CORS and dependency pruning, then removes its own resources and credential files. It does not use the developer's database, Redis, environment credentials or live providers. Results are written to `artifacts/gcp-container-smoke.json`.

Latest workstation build attempt (2026-10-17): the Linux Docker engine was reachable, but the API image stopped when Debian repository DNS resolution failed, and the web image stopped when BuildKit storage became read-only. The Windows C: volume reported zero free bytes during follow-up diagnostics. No application image or container runtime PASS is claimed. Free or relocate Docker storage through the operator's normal maintenance procedure, or use the documented Cloud Shell/Cloud Build path. Existing Docker data was not pruned and the engine was not restarted by this task. See [build-attempt evidence](../artifacts/gcp-linux-build-attempts.json).

For rollback, select a known-good compatible revision and restore traffic with `gcloud run services update-traffic SERVICE --to-revisions=REVISION=100 --region=us-central1`. Traffic rollback does not reverse schema changes or guarantee that warm background revisions have stopped. Because workers share the API process, inspect all active/minimum-instance revisions and queue state during rollback; use a controlled deployment window for consequential automation. Set billing budgets and maintain database/Redis recovery procedures before broader use.
