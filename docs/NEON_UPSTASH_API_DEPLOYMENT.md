# Neon + Upstash + Express deployment

Prepared for AI Workforce, 2026-10-18. This replaces the intended Render datastores; no Render database or Redis instance was actually created. Existing local PostgreSQL/Redis configuration remains usable.

## Selected architecture and cost boundary

| Workload | Target | Status |
| --- | --- | --- |
| Next.js dashboard | Existing Vercel `workforce` project | Already live at https://workforce-blue.vercel.app |
| Static entry page | Firebase Spark Hosting | Already live at https://gen-lang-client-0445651739.web.app |
| PostgreSQL + pgvector | Neon Free | Configuration prepared; account/database credentials needed |
| Redis TCP/TLS | Upstash Redis Free | Configuration prepared; account/database credentials needed |
| Express request/response API | Separate Vercel Express project, root `apps/api` | Configuration prepared, not deployed |
| BullMQ consumers and recurring schedulers | Separate persistent runtime | Still required for queued WhatsApp processing and scheduled automation |

Neon and Upstash offer free plans with limits. Select Free explicitly; do not add a payment method or enable paid upgrades. This is not unlimited free capacity. Upstash's Free plan currently includes 500K commands/month and 256MB; BullMQ can issue commands even when idle, so a continuously running worker can exhaust the allowance. Do not use an expiring anonymous database as the live application's storage.

Koyeb is **not a guaranteed no-card choice**: its current pricing FAQ requires card verification and describes a pre-authorization hold plus selected-plan charges. Under the user's no-card requirement, do not create a Koyeb account/service that requires payment information. The optional Koyeb build settings below are for an account already eligible to deploy without changing billing.

## Neon PostgreSQL / Prisma 6.4

Create a Free Neon project and obtain both URLs from Connect. Use a role that can apply this project's migrations, including `CREATE EXTENSION IF NOT EXISTS vector`. No Prisma major upgrade or Neon driver adapter is required for this repository's existing Prisma 6.4 TCP client.

The following are **formats only**, not working credentials. Set actual values privately in the API provider environment:

```dotenv
DATABASE_URL=postgresql://USER:URL_ENCODED_PASSWORD@ep-ENDPOINT-pooler.REGION.aws.neon.tech/neondb?sslmode=require&connection_limit=3&pool_timeout=20
DATABASE_URL_UNPOOLED=postgresql://USER:URL_ENCODED_PASSWORD@ep-ENDPOINT.REGION.aws.neon.tech/neondb?sslmode=require
```

`schema.prisma` continues to read `env("DATABASE_URL")`. Runtime uses the pooled URL. `scripts/run-migrations.cjs` selects `DIRECT_DATABASE_URL`, then Neon's `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`. Leave unused aliases unset; do not retain a stale Render/local direct URL. Use percent-encoded passwords, preserve TLS, and select the same Neon branch/database for runtime and migrations.

Do not copy Prisma 7 instructions into this Prisma 6.4 project. Never use `migrate dev`, reset, or test fixtures against the live database.

## Upstash Redis / BullMQ

Create an account-owned **Free Redis** database near the API. Copy its Redis TCP connection string (not the REST HTTPS URL/token):

```dotenv
REDIS_URL=rediss://default:URL_ENCODED_PASSWORD@ENDPOINT.upstash.io:6379/0
```

All connections go through `redisConnectionOptions`. The Upstash endpoint requires TLS with certificate verification and database zero. The worker connection uses `maxRetriesPerRequest: null`; producers have bounded retries and fail promptly on outages. Keep eviction disabled / `noeviction` for queue data. Check provider/BullMQ compatibility and connection/command limits before enabling continuous consumers.

The HTTP-only process does not connect an unused consumer client. Queue producers remain available, but **queued work will not execute without a separately running consumer**. Do not enable customer WhatsApp inbound processing until that consumer is available. Scheduled reports, niche automation and autonomy scheduling likewise need a persistent worker. This preparation does not move them to a durable serverless queue/workflow.

## Vercel Express API project

Keep the existing frontend project intact. Import the same GitHub repository into a **separate API project** using:

- Root Directory: `apps/api`; allow source files outside Root Directory for `packages/shared`.
- Framework Preset: Express; Node.js 22.x.
- Install: `cd ../.. && npm ci --include=dev`.
- Build: `cd ../.. && npm run build --workspace=@ai-employee/shared && npm run prisma:generate --workspace=@ai-employee/api && npm run build --workspace=@ai-employee/api`.
- Output Directory: framework default; do not set `.next` or static export output.
- `apps/api/vercel.json` stores these build settings without credentials.

Express exports its handler for Vercel. `VERCEL=1` prevents the persistent HTTP listener, Socket.IO initialization, shutdown signal hooks and scheduler startup. `BACKGROUND_WORKERS_ENABLED` defaults to false on Vercel; explicitly enabling it fails startup with an actionable error. This configuration does not provide the app's Socket.IO realtime service.

Set these **server-only** environment variables in the API project:

```dotenv
NODE_ENV=production
BACKGROUND_WORKERS_ENABLED=false
TRUST_PROXY_HOPS=1
BILLING_MODE=disabled
BILLING_ENFORCEMENT=false
DATABASE_URL=
DATABASE_URL_UNPOOLED=
REDIS_URL=
GEMINI_API_KEY=
JWT_SECRET=
INTEGRATION_ENCRYPTION_KEY=
MEDICAL_DATA_ENCRYPTION_KEY=
META_APP_SECRET=
META_VERIFY_TOKEN=
WEB_APP_URL=https://workforce-blue.vercel.app
PUBLIC_API_URL=
CORS_ORIGINS=https://workforce-blue.vercel.app,https://gen-lang-client-0445651739.web.app
```

Use the **actual assigned API origin** for `PUBLIC_API_URL`. Preserve the existing JWT/encryption keys; do not generate replacements just because the provider changed. `deploy/hosting/api.env.example` contains the full template. API startup requires these existing security/origin variables as well as DATABASE_URL, REDIS_URL and GEMINI_API_KEY. No private values belong in `NEXT_PUBLIC_*`, source files, shell arguments, or Git.

Apply migrations **once in a controlled release step before promoting API traffic**, with the actual Neon URLs injected into that shell/CI job:

```sh
npm ci --include=dev
npm run build --workspace=@ai-employee/shared
npm run prisma:generate --workspace=@ai-employee/api
node scripts/run-migrations.cjs
npm run build --workspace=@ai-employee/api
```

Migrations deliberately do not run per request or per cold start. The Vercel build does not mutate the database automatically. Configure deployment protection / preview access deliberately before connecting the production frontend; a protected API cannot receive ordinary server-to-server requests without an approved bypass configuration.

After the API deployment is healthy, set server-only `API_INTERNAL_URL` in the existing frontend `workforce` project to the actual API HTTPS origin. Redeploy the frontend. Keep production and preview secrets/databases separate when preview environments are enabled.

## Optional persistent Koyeb deployment

This path preserves the existing server/Socket.IO/worker behavior but may require a card. Do not use it as the no-card default. If the user's existing account is eligible, use the repository root build context, Node 22, the same build command as above, and:

```sh
node scripts/run-migrations.cjs && cd apps/api && node dist/index.js
```

Expose HTTP port 8080, set `PORT=8080`, health check `/health`, and use the same private Neon/Upstash variables. Set `BACKGROUND_WORKERS_ENABLED=true` only for an instance intended to run consumers/schedulers. Select the Free instance explicitly and verify its sleep/resource limits; scale-to-zero cannot guarantee timely recurring work. No optional provider provisioning is executed by these files.

## Verification and remaining work

```sh
node --test scripts/test-neon-migrations.mjs
node --test scripts/test-hosting-configuration.mjs
npm run build --workspace=@ai-employee/api
```

Once real services are configured, `/livez` checks process liveness; `/health` must report `status: healthy`, `checks.database: true`, and `checks.redis: true`. Verify exact CORS origins, frontend login, tenant isolation, a controlled Gemini question and voice upload. A green frontend page is not proof that those backend flows work.

No Neon or Upstash resource, API deployment, migration against Neon, or live AI acceptance has been claimed by this preparation. Actual account-owned credentials are still required and must be supplied privately.

## Official references

- [Neon connection formats](https://neon.com/docs/guides/prisma) (current examples use Prisma 7; this repository remains on Prisma 6.4).
- [Upstash BullMQ integration and command usage](https://upstash.com/docs/redis/integrations/bullmq).
- [Upstash Free pricing](https://upstash.com/pricing/redis).
- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express).
- [Koyeb card requirements](https://www.koyeb.com/docs/faqs/pricing).
