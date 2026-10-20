import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { getCalendarStatus } from '../services/googleCalendarService';
import { billingMode, billingEnforced } from '../services/subscriptionService';
async function main() {
  const providers = await prisma.externalIntegrationCredential.findMany({ where: { isActive: true }, select: { tenantId: true, provider: true } });
  const calendars = await prisma.googleCalendarConnection.findMany({ select: { tenantId: true } });
  const calendarChecks = [];
  for (const item of calendars) {
    try { const result = await getCalendarStatus(item.tenantId); calendarChecks.push({ tenantId: item.tenantId, connected: result.connected, canBook: result.canBook, liveCreateCancelTest: 'not_run' }); }
    catch { calendarChecks.push({ tenantId: item.tenantId, connected: false, liveCreateCancelTest: 'blocked_connection' }); }
  }
  const names = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_PLANS_JSON', 'PUBLIC_API_URL', 'META_APP_ID', 'META_EMBEDDED_SIGNUP_CONFIG_ID', 'DOGRAH_API_URL', 'DOGRAH_API_KEY', 'DOGRAH_AGENT_ID', 'DOGRAH_WEBHOOK_SECRET'];
  console.log(JSON.stringify({ configurationPresent: Object.fromEntries(names.map(name => [name, Boolean(process.env[name])])), billing: { mode: billingMode(), enforced: billingEnforced() }, connectedProviders: providers, calendars: calendarChecks, voice: { configuredWorkspaces: providers.filter(p => p.provider === 'dograh').length, liveCallTest: 'requires_controlled_number_and_charge_consent' } }, null, 2));
}
main().catch(() => { console.error('Launch readiness inspection failed; verify database and provider access.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
