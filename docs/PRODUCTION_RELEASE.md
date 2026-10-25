# Production configuration and verification

The code fixes are separate from deployment acceptance. Do not treat a successful build or test run as proof of live provider delivery.

## Local tests

Run `npm test` from the repository root. The runner loads the API development environment and derives a separate local database named `<development_database>_test`, creates it if necessary, applies migrations, then runs Vitest with one worker. It never migrates the development database. The database user needs permission to create the test database; alternatively, ask your database administrator to create it first.

For another server, explicitly set `TEST_DATABASE_URL`. The database name must end in `_test` or `_test_<suffix>`, use the public schema, and differ from the configured application database. Direct Vitest invocations also require `TEST_DATABASE_URL`.

Tests use Redis database 15 by default. Override with `TEST_REDIS_HOST`, `TEST_REDIS_PORT`, `TEST_REDIS_PASSWORD`, and `TEST_REDIS_DB` (1 through 15) when using a separate test Redis service. Reserve that database for tests. The suite deletes only its `ai-workforce:rate-limit:auth:*` counters between tests; it does not flush Redis or remove queue data. Integration fixture data stays in the isolated test database.

After `npm run build`, run `npm run test:web:smoke` to exercise the built frontend's registration, login, session cookies and protected-page redirect over HTTP. This starts temporary local Next.js/API fixture servers on non-default ports and shuts them down afterward. It does not create real accounts or contact external providers.

## Production environment

Copy `deploy/production.env.example` to `.env.production` and replace its placeholders with actual domains, secrets and backup settings. This populated file is ignored by Git. Keep existing integration and medical encryption keys stable so stored credentials and records remain readable.

Configure the app and API domains, matching HTTPS `WEB_APP_URL` and `PUBLIC_API_URL`, explicit comma-separated `CORS_ORIGINS`, database password/URL, JWT and encryption keys, Meta webhook settings, and the encrypted off-host backup destination. `CORS_ORIGINS` applies to both HTTP and Socket.io, including WebSocket upgrades. Server-to-server requests without an Origin remain supported.

Billing defaults to `disabled`. For Stripe test mode, provide test keys and approved test price IDs. For a paid launch, set `BILLING_MODE=live`, `BILLING_ENFORCEMENT=true`, matching live keys, the webhook signing secret, and complete approved plans. The preflight validates plan structure; live price availability is checked by the billing service.

Run:

```powershell
npm.cmd run production:preflight
# For a paid launch:
npm.cmd run production:preflight -- --paid-launch
# Compose needs --env-file for its own variable interpolation as well:
docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

For a differently named environment file, pass `--env-file <path>` to the preflight and set `PRODUCTION_ENV_FILE=<path>` for Compose, in addition to Compose's `--env-file <path>` option. Environment variables already supplied by the host take precedence over dotenv values. The Compose preflight service must pass before migrations and the API can start. Direct API production startup also validates core settings.

The web server requires `API_INTERNAL_URL`, or `API_URL`, containing the backend HTTP(S) origin. Compose supplies `http://api:3001`. Auth, session checks, proxies, and Calendar OAuth completion all resolve this value at request time.

## WhatsApp queue acceptance

Inbound support webhooks receive success only after Redis accepts their BullMQ job. Redis outages or write errors return a retryable HTTP 503. There is no process-memory fallback. Workers reconnect to recover persisted jobs, and duplicate deliveries share a tenant-scoped job ID. Completed IDs are retained for up to seven days, capped at 100,000 jobs. The production Redis service uses AOF, `appendfsync always`, and `noeviction`. A single Redis instance still needs operational monitoring and backups; infrastructure disaster recovery is not established by an application test.

## Release acceptance

After deployment, verify browser registration/login/session checks, `/health`, tenant permissions, controlled WhatsApp send/receive and delivery receipts, connected commerce reads, Google Calendar create/cancel, Gemini response generation, and the enabled voice/billing flows. Rehearse worker restart/Redis outages and encrypted backup restore into a disposable database. External credentials, real domains, recipient numbers, and provider accounts must be supplied by the deployment owner. No real calls, payments, or customer messages are sent by the automated regression suite.
