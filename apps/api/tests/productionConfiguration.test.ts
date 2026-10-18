import { describe, expect, it } from 'vitest';
const { productionConfigurationFailures: failures } = require('@ai-employee/shared/production-config.cjs');
const { assertTestDatabaseUrl } = require('@ai-employee/shared/test-database.cjs');

const valid = {
  DATABASE_URL: 'postgresql://workforce:private@postgres:5432/workforce',
  JWT_SECRET: 'a'.repeat(64), INTEGRATION_ENCRYPTION_KEY: 'b'.repeat(64), MEDICAL_DATA_ENCRYPTION_KEY: 'c'.repeat(64),
  META_APP_SECRET: 'private-meta-secret', META_VERIFY_TOKEN: 'private-verification-token',
  WEB_APP_URL: 'https://app.acme.test', PUBLIC_API_URL: 'https://api.acme.test', CORS_ORIGINS: 'https://app.acme.test',
  BILLING_MODE: 'disabled', BILLING_ENFORCEMENT: 'false', POSTGRES_PASSWORD: 'private-database-password',
  APP_DOMAIN: 'app.acme.test', API_DOMAIN: 'api.acme.test', BACKUP_AGE_RECIPIENT: 'age1fixture', BACKUP_S3_URI: 's3://acme-backups/db',
};
describe('Production release configuration', () => {
  it('allows a configured deployment with billing explicitly disabled', () => {
    expect(failures(valid, { deployment: true })).toEqual([]);
  });
  it('rejects weak secrets, placeholders, public HTTP URLs, and wildcard origins', () => {
    expect(failures({ ...valid, JWT_SECRET: 'short', INTEGRATION_ENCRYPTION_KEY: 'REPLACE'.repeat(8), MEDICAL_DATA_ENCRYPTION_KEY: '', PUBLIC_API_URL: 'http://api.acme.test', CORS_ORIGINS: '*' })).toEqual(expect.arrayContaining(['JWT_SECRET', 'INTEGRATION_ENCRYPTION_KEY', 'MEDICAL_DATA_ENCRYPTION_KEY', 'PUBLIC_API_URL', 'CORS_ORIGINS']));
  });
  it('blocks enabled billing without matching secrets and complete unique plans', () => {
    expect(failures({ ...valid, BILLING_MODE: 'live' })).toEqual(expect.arrayContaining(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'BILLING_PLANS_JSON']));
    const paid = { ...valid, BILLING_MODE: 'live', BILLING_ENFORCEMENT: 'true', STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', BILLING_PLANS_JSON: JSON.stringify([{ id: 'pro', name: 'Pro', priceId: 'price_fixture', monthlyCredits: 100, maxAgents: 2 }]) };
    expect(failures(paid, { paidLaunch: true, deployment: true })).toEqual([]);
    expect(failures({ ...paid, STRIPE_SECRET_KEY: 'sk_test_fixture' })).toContain('STRIPE_SECRET_KEY');
    expect(failures({ ...paid, BILLING_PLANS_JSON: '[{}]' })).toContain('BILLING_PLANS_JSON');
    expect(failures({ ...paid, BILLING_PLANS_JSON: JSON.stringify([{ name: 'Pro', priceId: 'price_fixture', monthlyCredits: 100, maxAgents: 2 }]) })).toContain('BILLING_PLANS_JSON');
    expect(failures(valid, { paidLaunch: true })).toEqual(expect.arrayContaining(['BILLING_MODE', 'BILLING_ENFORCEMENT']));
  });
  it('rejects invalid backup settings and mismatched deployment domains', () => {
    expect(failures({ ...valid, BACKUP_S3_URI: '/local/backups', APP_DOMAIN: 'different.acme.test' }, { deployment: true })).toEqual(expect.arrayContaining(['BACKUP_S3_URI', 'WEB_APP_URL']));
  });
});
describe('Test database safety', () => {
  it('rejects ordinary application databases and shared production targets', () => {
    expect(() => assertTestDatabaseUrl(valid.DATABASE_URL)).toThrow();
    expect(() => assertTestDatabaseUrl('postgresql://localhost/workforce_test', 'postgresql://localhost/workforce_test')).toThrow();
    expect(() => assertTestDatabaseUrl('postgresql://localhost/workforce_test?schema=public_data')).toThrow();
    expect(() => assertTestDatabaseUrl('postgresql://localhost/workforce_test')).not.toThrow();
  });
});
