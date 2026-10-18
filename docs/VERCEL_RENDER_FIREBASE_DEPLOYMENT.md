# AI Workforce deployment: Vercel, Render and Firebase Hosting

The current no-card datastore/API preparation is documented in [Neon + Upstash + API deployment](NEON_UPSTASH_API_DEPLOYMENT.md). Render requests returned HTTP 402 for this account. The Render setup below is retained as an optional alternative and is not the current no-card deployment path.

## Architecture and current status

The active deployment path needs no GCP billing account, Cloud Build, Artifact Registry or Secret Manager. Standard npm builds never call gcloud. The old Cloud Run commands remain an optional alternative, with their valid billing requirement intact; do not run them for this deployment.

| Component | Destination | Configuration |
| --- | --- | --- |
| Next.js dashboard, authentication cookies, API proxy and voice proxy | Vercel | `apps/web/vercel.json`; project Root Directory `apps/web` |
| Express, Socket.IO, Prisma and in-process BullMQ workers | Render Node web service | Root `render.yaml`, explicitly `plan: free` |
| PostgreSQL with pgvector | Hosted PostgreSQL provider | Private `DATABASE_URL`; optional `DIRECT_DATABASE_URL` for migrations |
| BullMQ queue | Compatible hosted Redis/Valkey TCP service | Private `REDIS_URL`; persistence and `noeviction` required for durable work |
| Static public entry page linking to dashboard | Firebase Hosting Spark | Root `firebase.json`; public directory `deploy/firebase/public` |
| AI generation, embeddings and voice transcription | Existing Gemini Developer API integration | Private API-side `GEMINI_API_KEY` |

The dashboard is **not a static export**. It depends on route handlers, request-time cookies, a route proxy and protected redirects. Neither `.next` nor `.next/standalone` is a Firebase static public directory. Firebase App Hosting/server frameworks would require a different, billing-enabled setup. The Spark configuration here contains only static HTML, no Functions, Cloud Run rewrites or App Hosting.

No provider URLs are fabricated. A successful local build does not mean these services are live. Hosting a Firebase entry page demonstrates Firebase Hosting usage; eligibility for a competition must be checked against the organizer's actual rules.

## 1. Prerequisites

- Vercel and Render accounts, access to the GitHub repository and an approved deployment revision. Current local changes must be reviewed and pushed before Git-based deployments can see them.
- A Firebase-enabled project, or permission to add Firebase to `gen-lang-client-0445651739`. Firebase CLI authentication is separate from gcloud login.
- A cloud-accessible PostgreSQL database whose provider supports the migrations' pgvector extension, and a compatible Redis TCP endpoint. Localhost URLs cannot be used from hosted services.
- Use provider-required TLS settings, URL-encode passwords and keep database/queue limits appropriate for the instance. A Redis REST API URL is insufficient.

Do not paste connection strings, tokens or keys into chat. Enter them in provider environment dashboards. Keep existing JWT/integration/medical keys stable when moving existing data; preserve `.local/predeployment/keys.json` privately. No secret payload is included in this guide, the Blueprint or Vercel configuration.

## 2. Reserve the frontend and API domains

Windows CLI helpers are available as `scripts/vercel-d-drive.cmd` and `scripts/render-d-drive.cmd`, with private provider configuration under ignored `.local/vercel-config` and `.local/render-config`. Vercel **64.5.0** and Render **2.29.0** were installed on D:; the Render archive's SHA256 matched the official GitHub release asset digest. Vercel CLI login as `moizansari90` is verified. Account authorization is distinct from creating or deploying a service. See [Vercel agent setup verification](../artifacts/VERCEL_AGENT_SETUP.md) for the installed Codex plugin and shared MCP configuration.

```powershell
.\scripts\vercel-d-drive.cmd whoami
.\scripts\render-d-drive.cmd login -o text
```

Create/import a Vercel project and create the Render web service from the repository before enabling real workflows. Record their **actual assigned domains**; service names alone do not guarantee a particular URL. Configure both sides with those stable production origins, then deploy/redeploy them. This resolves the frontend/backend origin dependency without opening CORS to wildcard preview domains.

## 3. Render API

Connect the repository in Render and create a Blueprint from root `render.yaml`. Select the free plan as declared; do not silently upgrade. The repository root must remain the working directory, because npm workspaces require its lockfile and shared package.

Build command:

```bash
npm ci --include=dev && npm run build --workspace=@ai-employee/shared && npm run prisma:generate --workspace=@ai-employee/api && npm run build --workspace=@ai-employee/api
```

Start command:

```bash
node scripts/run-migrations.cjs && cd apps/api && node dist/index.js
```

The migration wrapper runs `prisma migrate deploy`, prefers `DIRECT_DATABASE_URL` when provided, and refuses an ordinary production localhost URL. A failed migration stops startup instead of serving an incompatible schema. Render Free does not support a separate pre-deploy command, so this prototype deliberately migrates at startup. Review migrations for compatibility with an old instance during rollout. Do not run `prisma migrate dev`, reset or seed commands against the hosted database.

Set every `sync: false` variable prompted by the Blueprint:

| Variable | Value/source |
| --- | --- |
| `DATABASE_URL` | Hosted PostgreSQL connection string with provider-required TLS |
| `REDIS_URL` | Hosted Redis TCP/TLS connection string |
| `GEMINI_API_KEY` | Existing private Gemini credential |
| `JWT_SECRET` | Stable random secret, minimum 32 characters |
| `INTEGRATION_ENCRYPTION_KEY` | Existing stable key, minimum 32 characters |
| `MEDICAL_DATA_ENCRYPTION_KEY` | Existing stable 64 hexadecimal characters |
| `META_APP_SECRET`, `META_VERIFY_TOKEN` | Private Meta configuration; required by current production startup |
| `WEB_APP_URL` | Actual Vercel HTTPS origin, no path |
| `PUBLIC_API_URL` | Actual Render HTTPS origin, no path |
| `CORS_ORIGINS` | Actual Vercel and Firebase HTTPS origins, comma-separated |

Optional `DIRECT_DATABASE_URL` must be omitted when unused, not filled with a placeholder. API port is supplied by Render; the existing server reads `process.env.PORT` through its environment schema and binds `0.0.0.0`. `/health` checks PostgreSQL and Redis; `/livez` checks process liveness.

The Blueprint leaves application Stripe billing disabled. That setting is unrelated to GCP billing. Optional Shopify/Calendar/Vapi/WhatsApp configuration must be added only for enabled integrations. Register exact production OAuth redirect and webhook URLs; do not retain localhost callbacks.

## 4. Vercel frontend

Import the same repository and set:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Framework | Next.js |
| Install Command | `cd ../.. && npm ci --include=dev` |
| Build Command | `npm run build` (runs the web package's Next.js build) |
| Output Directory | `.next` (Next.js framework output; not a static export) |
| Node.js | 22.x |

Allow files outside Root Directory if Vercel presents that monorepo setting. `outputFileTracingRoot` already points to the repository root. `next.config.ts` disables standalone packaging only when Vercel sets `VERCEL=1`; container/local builds retain standalone output.

Set **Production** `API_INTERNAL_URL` to the Render API's actual HTTPS origin, without `/api/v1`. The existing cookie-authenticated frontend proxy calls that origin at request time. Optional `NEXT_PUBLIC_API_URL` can contain the same public origin; it contains no credential. `NEXT_PUBLIC_*` values can be inlined into browser bundles at build time, so redeploy after changing them. Keep secrets and database URLs on Render, never in `NEXT_PUBLIC_*` variables.

No Vercel server holds Socket.IO or a queue worker; those stay on the persistent Express process. Keep the production deployment publicly accessible to judges, rather than protected by Vercel account login. Test using a signed-out browser.

`vercel.json` sets API function maximum duration to 60 seconds, allowing the existing bounded 15–28 second upstream request timeouts to finish even when Fluid compute is disabled. This does not remove those upstream timeouts or the need to warm a sleeping Render service.

## 5. Firebase Spark Hosting commands

Use ordinary Firebase Hosting, not Firebase App Hosting. Spark Hosting requires no payment method within its quotas. From Cloud Shell or a terminal at repository root:

```bash
npm install -g firebase-tools
firebase login --no-localhost
firebase projects:list
# Only if the existing GCP project is not yet Firebase-enabled:
firebase projects:addfirebase gen-lang-client-0445651739
firebase use gen-lang-client-0445651739

# Supply the ACTUAL Vercel origin, not an example or guessed URL:
read -r -p 'Vercel HTTPS origin: ' DEPLOY_WEB_URL
export DEPLOY_WEB_URL
npm run deploy:firebase:prepare
firebase deploy --only hosting --project gen-lang-client-0445651739
```

`firebase.json` and `.firebaserc` are already supplied, so **`firebase init hosting` is unnecessary**. If initializing a fresh checkout manually instead, run it before generating the entry page and choose: existing project; public directory `deploy/firebase/public`; single-page app **No**; GitHub deploy integration **No**; overwrite existing HTML **No**. Do not select `.next`, and do not configure server-side framework hosting. Keep the supplied security headers if the wizard rewrites configuration.

On this Windows workspace the CLI is installed on D: instead of the system-wide C: prefix:

```powershell
.\scripts\firebase-d-drive.cmd login --no-localhost
$env:DEPLOY_WEB_URL = Read-Host 'Actual Vercel HTTPS origin'
.\scripts\with-d-drive.cmd npm.cmd run deploy:firebase:prepare
.\scripts\firebase-d-drive.cmd deploy --only hosting --project gen-lang-client-0445651739
```

The Windows wrapper keeps Firebase CLI configuration/auth state in ignored `.local/firebase-config` on D: and disables the update notifier. Keep this directory private; it may contain login credentials. It is a separate Firebase login from the existing gcloud profile.

The generator refuses missing/malformed origins and publishes only `index.html`/`404.html`. A Hosting predeploy hook regenerates this page and requires `DEPLOY_WEB_URL` in the deployment shell, preventing accidental deployment of a stale entry page. It does not copy application source, `.env`, Firebase auth tokens or API credentials. Firebase prints the actual Hosting URL only after a successful deploy; use that result in the Render CORS allowlist.

## 6. Verification

```bash
npm run deploy:test
# Set all three to the actual URLs printed by successful provider deployments:
export DEPLOY_API_URL='https://ACTUAL_RENDER_HOST'
export DEPLOY_WEB_URL='https://ACTUAL_VERCEL_HOST'
export DEPLOY_FIREBASE_URL='https://ACTUAL_FIREBASE_HOST'
npm run deploy:verify
```

The verifier checks API database/Redis health, Vercel login HTML, unauthenticated dashboard redirect, both allowed CORS origins, rejection of a foreign origin and the Firebase dashboard link. It writes `artifacts/hosted-deployment-verification.json`. Placeholder domains in the example are not live URLs and must be replaced. Checks never submit customer messages, account registrations or payments.

Complete separate live browser acceptance: login/session/logout; cross-tenant access denial; Gemini question; microphone transcription and reviewed send; approved integration reads/callbacks; Socket.IO reconnect; and webhook signature verification. Warm the API with its `/health` endpoint before a demo; cold starts can exceed the frontend's bounded upstream timeouts.

## Free-tier limits and production sign-off

- Render Free sleeps after 15 idle minutes, may take about a minute to wake, and has limited instance hours. In-process workers and schedules stop while the service sleeps. This is suitable for a supervised prototype, not an always-on automation guarantee.
- Free Render Postgres expires after 30 days. Free Render Key Value has no persistence and can lose queue data on restart. Do not represent either as durable production storage. Select a suitable datastore provider and verify backups, restore, connection limits and Redis `noeviction` before real customer work.
- Vercel Functions have a 4.5 MB request/response limit. Normal 60-second mono 16 kHz PCM voice recordings are about 1.92 MB; other large document/proxy uploads need a separate direct-upload design. Check the chosen Vercel plan's allowed use, function duration and quotas; Hobby is for personal, noncommercial use.
- Firebase Spark Hosting has bounded free storage/transfer. Exceeding Spark quotas can block deploys or suspend serving. This setup does not enable Blaze or attach GCP billing.
- Free quotas do not establish production reliability. Actual provider account eligibility, datastore durability, delivery/retry behavior, monitoring and backup restore remain acceptance requirements.

## Primary references

- [Vercel monorepos](https://vercel.com/docs/monorepos), [build settings](https://vercel.com/docs/builds/configure-a-build), [function duration](https://vercel.com/docs/functions/configuring-functions/duration), [function limits](https://vercel.com/docs/functions/limitations), [Hobby plan](https://vercel.com/docs/plans/hobby).
- [Render Blueprint specification](https://render.com/docs/blueprint-spec), [free service limitations](https://render.com/docs/free), [Key Value persistence and queue configuration](https://render.com/docs/key-value).
- [Firebase Hosting quickstart](https://firebase.google.com/docs/hosting/quickstart), [CLI login and existing projects](https://firebase.google.com/docs/cli), [Spark pricing](https://firebase.google.com/pricing), [Hosting quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing), [App Hosting billing](https://firebase.google.com/docs/app-hosting/costs).
