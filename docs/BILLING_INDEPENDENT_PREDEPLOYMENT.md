# AI Workforce: preparation without enabling GCP billing

This work leaves GCP billing, paid resources and Cloud Run deployment untouched. It verifies the existing application with real local PostgreSQL/Redis and the existing Gemini Developer API key. It does not claim that hosted databases or public services have been provisioned.

## What was prepared

- Added `DATABASE_URL`, JWT/runtime fields and optional deployment-only hosted URLs to `.env.example`; all credential fields remain empty.
- Prepared JWT, integration and medical encryption keys in `.local/predeployment/keys.json`. Existing source keys are reused; a missing key is generated with 32 cryptographically random bytes. Reruns preserve the saved values and reject invalid existing keys instead of silently rotating them. The root/API `.env` files are not modified.
- The local key file is ignored by Git and excluded from Docker/Cloud Build source contexts. On Windows its inherited ACL is removed and access is granted to the current tool identity and the actual workspace owner, so isolated tool accounts do not lock the owner out; on POSIX it uses owner-only mode. The file contains secrets: do not share it or publish its contents. Keep encryption keys stable when carrying encrypted records to a future deployment.
- Local Redis host/port/password settings are translated into an encoded runtime URL in memory. The rehearsal uses an empty non-default Redis database, excluding regression DB 15, and never flushes existing data.
- Prepared credential-structure checks and a future Secret Manager upload command. The uploader requires `--apply`, rejects loopback deployment database URLs before cloud access, checks billing, preserves enabled pinned versions, and sends new payloads through stdin rather than command arguments or files. Its cloud mutation path is **not executed or live-verified** in this phase.

## Executed local rehearsal

```powershell
.\scripts\with-d-drive.cmd npm.cmd run predeploy:prepare
.\scripts\with-d-drive.cmd npm.cmd run predeploy:local
.\scripts\with-d-drive.cmd npm.cmd run predeploy:test
```

The runtime rehearsal:

1. Restricts PostgreSQL to a loopback server and creates/uses `ai_workforce_predeployment`; it does not migrate the development application database.
2. Runs the real `prisma migrate deploy` wrapper. It deliberately uses development mode **for the loopback migration command only**, because the production migration guard correctly rejects ordinary localhost URLs. The application servers themselves run in production mode.
3. Starts compiled Express and the built standalone Next.js server on temporary ports, with new synthetic Meta verification credentials and all workers/schedulers disabled.
4. Verifies `/livez`, PostgreSQL+Redis `/health`, frontend health, actual database-backed account registration, password login/rejection, session cookies, runtime proxy and protected-page redirects.
5. Verifies two real tenants: own-tenant task access works; foreign-tenant read and write requests are rejected. Verifies authenticated Socket.IO WebSocket connectivity and rejection of missing tokens and foreign origins.
6. Stops its child servers and removes only its own empty-queue Redis metadata and ownership marker. Synthetic tenants/accounts/tasks remain only in the separate rehearsal database for inspection; no application data is deleted.

The advertised `.test` HTTPS origins are synthetic configuration values; requests use HTTP loopback. This validates server behavior and secure cookie attributes, not a public browser's HTTPS session or cloud routing. Existing source data is not sent to external providers. No customer WhatsApp messages, calendar actions, commerce changes or payments are issued.

## Gemini provider verification

```powershell
.\scripts\with-d-drive.cmd npm.cmd run predeploy:gemini
```

The command loads the existing `GEMINI_API_KEY` privately and sends two small synthetic requests: text generation and a 768-dimensional document embedding. It never prints the key, SDK error bodies, model output or vectors. It consumes the provider's available request quota; it does not enable billing. Restricted environments may require network permission.

The first text-generation attempt returned 504. A bounded 60-second diagnostic with LOW thinking for the Gemini 3.x model passed, and the final combined generation+embedding check passed. This is a connectivity/credential acceptance check, not a latency guarantee for all app workflows; the application's existing 15-second workforce-assistant limit and other per-flow settings are unchanged. Supported thinking levels are documented in [Google's model guide](https://ai.google.dev/gemini-api/docs/generate-content/whats-new-gemini-3.8).

## Hosted database and Redis remain separate

Creating hosted resources requires a chosen provider and account authorization. No external provider/account was supplied during this phase. Current application PostgreSQL remains local; `REDIS_URL` for a hosted service is not configured. Local rehearsal success is not hosted connectivity success.

If you later provision services outside GCP, inject these private environment variables through your shell, secret store or ignored local environment file:

- `DEPLOY_DATABASE_URL`: the provider-issued PostgreSQL URL, including its required TLS options.
- `DEPLOY_DIRECT_DATABASE_URL`: optional direct, non-transaction-pooled PostgreSQL URL for migrations; enable the matching binding when required.
- `DEPLOY_REDIS_URL`: a BullMQ-compatible Redis TCP/TLS URL (`rediss://` for public TLS endpoints). A provider's REST-only URL is insufficient.

Use the provider's connection details, connection limits, TLS CA requirements and supported Redis commands. Ensure Redis persistence and `noeviction` suitability for durable queues; do not assume every free cache tier meets these needs. Do not send connection passwords in chat or overwrite your development database URL merely to configure deployment.

```powershell
.\scripts\with-d-drive.cmd npm.cmd run predeploy:cloud-check
```

This is a structure-only check. Exit code 2 means hosted URLs still need input. It does not connect to a hosted service or prove that a Secret Manager reference exists. Public URLs require explicit TLS in this conservative checker; private networking needs a separate reviewed configuration.

## Deferred GCP work

The following commands are for later, once the account holder chooses to enable billing and hosted URLs are available:

```powershell
# Review pinned references in deploy/gcp/api-secrets.local.txt first.
.\scripts\with-d-drive.cmd node scripts/upload-predeployment-secrets.mjs --apply
.\scripts\deploy-cloudrun-windows.cmd --dry-run
.\scripts\deploy-cloudrun-windows.cmd
```

The Windows upload helper uses the project-local authenticated Google Cloud CLI installed on D:. It does not upgrade accounts, link a billing account, provision database/Redis, or replace existing secret payloads. Existing secret payloads are not compared, so matching reference names alone do not prove matching credentials. Review key continuity before using a pre-existing encrypted database.

Actual Secret Manager storage/IAM verification, Cloud Build Linux images, migrations in the cloud runtime network, Cloud Run services and public URL checks remain deferred. See [the Cloud Shell deployment guide](CLOUD_SHELL_SECURE_DEPLOYMENT.md).

## Evidence

- `artifacts/predeployment-preparation.json`
- `artifacts/predeployment-local-runtime.json`
- `artifacts/predeployment-gemini.json`
- `artifacts/predeployment-cloud-readiness.json`
- `artifacts/predeployment-secret-upload.json` (local guard checks only; no cloud upload)
- `artifacts/deployment-resume-tests.json` (the previous full 470-test application run)

No application-source, Prisma-schema or dependency-version changes were necessary for this phase. The package script additions expose the repeatable preparation/verification tools.
