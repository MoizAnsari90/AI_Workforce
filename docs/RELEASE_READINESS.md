# AI Workforce hosted release preparation

The release includes the dashboard theme/accessibility controls, English/Urdu/Arabic interface, reviewed voice questions, animated AI companion, production authentication/proxy/CORS fixes, durable queue acceptance safeguards and hosted deployment configuration.

## Release checks

- Shared package, Express API and Vercel-mode Next.js production build: passed.
- Complete API suite against the isolated test database: **489/489 passed**.
- Interface language, appearance, companion and hosting verification scripts: **25/25 passed**.
- Current production dependency audit: **0 vulnerabilities**.
- Git-visible text review: **396 files**, no configured credential literals or selected provider/private-key patterns found. This is a bounded review, not a complete historical secret audit.
- Private `.env`, local credentials, CLI state, caches and generated Firebase files are excluded from Git.

## Verified deployment target

- Repository: `https://github.com/MoizAnsari90/AI_Workforce`.
- Branch: `main`; the remote base was fetched and compared before preparing the update.
- Existing Vercel project: `workforce`, in `moiz-ansaris-projects`.
- Its initial configuration had no Git repository link, no runtime environment entries, repository-root build selection and no framework preset. A connected GitHub account alone does not import this repository as a Vercel project.
- Frontend root must be `apps/web`, framework Next.js, Node.js 22.x; use the supplied monorepo install/build configuration.

## Live acceptance still required

GitHub publication and a successful frontend build do not establish API readiness. Render authentication, hosted PostgreSQL/Redis, stable runtime secrets and the actual API origin must be configured before login, Gemini/voice and business integrations can pass live acceptance. Do not inject a local API URL or invented production origin into Vercel.

See [the deployment guide](VERCEL_RENDER_FIREBASE_DEPLOYMENT.md) for configuration and verification. Generated test reports and local browser captures are development evidence, not application runtime inputs.
