// Checks supplied live endpoints only; never creates accounts or changes data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardOrigin } from './prepare-firebase-hosting.mjs';

export async function verifyHostedDeployment(source = process.env, fetcher = fetch) {
const report = { timestamp: new Date().toISOString(), passed: false, checks: {}, errors: [] };
let stage = 'public URLs';
try {
  const api = dashboardOrigin(source.DEPLOY_API_URL);
  const web = dashboardOrigin(source.DEPLOY_WEB_URL);
  const firebase = dashboardOrigin(source.DEPLOY_FIREBASE_URL);
  const get = (url, options = {}) => fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(90000), ...options });
  stage = 'API readiness';
  const health = await get(`${api}/health`);
  if (!health.ok) throw new Error();
  const data = await health.json();
  if (data.status !== 'healthy' || data.checks?.database !== true || data.checks?.redis !== true) throw new Error();
  report.checks.apiDatabaseAndRedis = true;
  stage = 'Vercel login';
  const login = await get(`${web}/login`);
  if (!login.ok || !(await login.text()).includes('AI Workforce')) throw new Error();
  report.checks.webLoginPage = true;
  stage = 'protected dashboard';
  const dashboard = await get(`${web}/dashboard`);
  const location = dashboard.headers.get('location');
  if (![302, 303, 307, 308].includes(dashboard.status) || !location || new URL(location, web).pathname !== '/login' || new URL(location, web).origin !== web) throw new Error();
  report.checks.unauthenticatedDashboardRedirect = true;
  stage = 'CORS';
  for (const origin of [web, firebase]) {
    const cors = await get(`${api}/api/v1/auth/login`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    if (cors.status !== 204 || cors.headers.get('access-control-allow-origin') !== origin) throw new Error();
  }
  const denied = await get(`${api}/api/v1/auth/me`, { headers: { Origin: 'https://untrusted.invalid' } });
  if (denied.status !== 403) throw new Error();
  report.checks.explicitCorsOrigins = true;
  stage = 'Firebase entry page';
  const entry = await get(firebase);
  if (!entry.ok || !(await entry.text()).includes(`href="${web}/dashboard"`)) throw new Error();
  report.checks.firebaseLinksToActualDashboard = true;
  report.urls = { api, web, firebase };
  report.passed = true;
} catch {
  report.errors.push({ stage, message: 'Verification failed or actual public URLs are missing. No response bodies or credentials logged.' });
}
report.note = 'Unauthenticated smoke only. Real browser login, tenant isolation, Gemini/voice, callbacks and enabled provider flows require separate live acceptance.';
return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const report = await verifyHostedDeployment();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts/hosted-deployment-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
}
