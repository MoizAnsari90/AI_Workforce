import 'dotenv/config';
const failures = [];
function required(name, check = value => Boolean(value)) {
  const value = process.env[name] || '';
  if (!value || /REPLACE|example\.com/i.test(value) || !check(value)) failures.push(name);
}
for (const key of ['DATABASE_URL', 'POSTGRES_PASSWORD', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'BACKUP_AGE_RECIPIENT', 'BACKUP_S3_URI']) required(key);
required('JWT_SECRET', value => value.length >= 32);
required('INTEGRATION_ENCRYPTION_KEY', value => value.length >= 32);
required('MEDICAL_DATA_ENCRYPTION_KEY', value => /^[a-f0-9]{64}$/i.test(value));
for (const key of ['WEB_APP_URL', 'PUBLIC_API_URL']) required(key, value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/localhost|ngrok|127\.0\.0\.1/.test(url.hostname); } catch { return false; } });
required('CORS_ORIGINS');
if (process.argv.includes('--paid-launch')) {
  required('BILLING_MODE', value => value === 'live');
  required('BILLING_ENFORCEMENT', value => value === 'true');
  required('STRIPE_SECRET_KEY', value => value.startsWith('sk_live_'));
  required('STRIPE_WEBHOOK_SECRET', value => value.startsWith('whsec_'));
  required('BILLING_PLANS_JSON', value => { try { const plans = JSON.parse(value); return Array.isArray(plans) && plans.length > 0; } catch { return false; } });
}
console.log(JSON.stringify({ check: 'production-configuration', passed: !failures.length, missingOrInvalid: failures, note: 'Configuration checks do not prove live delivery, payments, backups or isolation acceptance.' }, null, 2));
process.exitCode = failures.length ? 1 : 0;
