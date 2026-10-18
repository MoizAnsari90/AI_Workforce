// Shared by API startup and the deployment CLI; never returns secret values.
function isOrigin(value, production = true) {
  try {
    const url = new URL(value);
    return (production ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)) &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
      (!production || !/^(localhost|127\.|\[::1\])|\.example\.com$|^example\.com$|ngrok/i.test(url.hostname));
  } catch { return false; }
}

function productionConfigurationFailures(source, { deployment = false, paidLaunch = false } = {}) {
  const failures = new Set();
  function required(name, check = () => true) {
    const value = source[name] || '';
    if (!value.trim() || /REPLACE|YOUR_|example\.com/i.test(value) || !check(value)) failures.add(name);
  }
  required('DATABASE_URL', value => { try { const url = new URL(value); return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname && url.username && url.password && url.pathname.length > 1); } catch { return false; } });
  required('JWT_SECRET', value => value.length >= 32);
  required('INTEGRATION_ENCRYPTION_KEY', value => value.length >= 32);
  required('MEDICAL_DATA_ENCRYPTION_KEY', value => /^[a-f0-9]{64}$/i.test(value));
  required('META_APP_SECRET');
  required('META_VERIFY_TOKEN');
  for (const name of ['WEB_APP_URL', 'PUBLIC_API_URL']) required(name, value => isOrigin(value));
  required('CORS_ORIGINS', value => value.split(',').every(origin => isOrigin(origin.trim())));
  const mode = source.BILLING_MODE || 'disabled';
  if (!['disabled', 'test', 'live'].includes(mode)) failures.add('BILLING_MODE');
  if (source.BILLING_ENFORCEMENT && !['true', 'false'].includes(source.BILLING_ENFORCEMENT)) failures.add('BILLING_ENFORCEMENT');
  if (source.BILLING_ENFORCEMENT === 'true' && mode === 'disabled') failures.add('BILLING_MODE');
  if (paidLaunch) {
    if (mode !== 'live') failures.add('BILLING_MODE');
    if (source.BILLING_ENFORCEMENT !== 'true') failures.add('BILLING_ENFORCEMENT');
  }
  if (mode !== 'disabled') {
    required('STRIPE_SECRET_KEY', value => (mode === 'live' ? /^sk_live_/ : /^sk_test_/).test(value));
    required('STRIPE_WEBHOOK_SECRET', value => /^whsec_/.test(value));
    required('BILLING_PLANS_JSON', value => {
      try {
        const plans = JSON.parse(value);
        return Array.isArray(plans) && plans.length > 0 && plans.length <= 10 &&
          plans.every(plan => plan && typeof plan.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(plan.id) && typeof plan.name === 'string' && plan.name.length > 0 && plan.name.length <= 80 &&
            typeof plan.priceId === 'string' && /^price_[A-Za-z0-9]+$/.test(plan.priceId) && Number.isInteger(plan.monthlyCredits) && plan.monthlyCredits > 0 && Number.isInteger(plan.maxAgents) && plan.maxAgents > 0 &&
            Object.keys(plan).every(key => ['id', 'name', 'priceId', 'monthlyCredits', 'maxAgents'].includes(key))) &&
          new Set(plans.map(plan => plan.id)).size === plans.length && new Set(plans.map(plan => plan.priceId)).size === plans.length;
      } catch { return false; }
    });
  }
  if (deployment) {
    required('POSTGRES_PASSWORD');
    required('BACKUP_AGE_RECIPIENT', value => /^age1[0-9a-z]+$|^ssh-(ed25519|rsa) /.test(value));
    required('BACKUP_S3_URI', value => /^s3:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(value));
    for (const name of ['APP_DOMAIN', 'API_DOMAIN']) required(name, value => isOrigin(`https://${value}`) && !/[/:]/.test(value));
    if (source.APP_DOMAIN && source.WEB_APP_URL !== `https://${source.APP_DOMAIN}`) failures.add('WEB_APP_URL');
    if (source.API_DOMAIN && source.PUBLIC_API_URL !== `https://${source.API_DOMAIN}`) failures.add('PUBLIC_API_URL');
  }
  return [...failures];
}

module.exports = { isOrigin, productionConfigurationFailures };
