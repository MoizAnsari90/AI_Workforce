import dotenv from 'dotenv';
import path from 'node:path';
import config from '../packages/shared/production-config.cjs';

const args = process.argv.slice(2);
const fileIndex = args.indexOf('--env-file');
const explicit = fileIndex >= 0 ? args[fileIndex + 1] : args.find(value => value.startsWith('--env-file='))?.slice(11);
if (fileIndex >= 0 && (!explicit || explicit.startsWith('--'))) throw new Error('--env-file requires a file path');
const file = path.resolve(explicit || '.env.production');
const loaded = dotenv.config({ path: file, quiet: true });
if (loaded.error) {
  console.error('Production environment file could not be loaded. Use --env-file <path>.');
  process.exit(1);
}
const failures = config.productionConfigurationFailures(process.env, { deployment: true, paidLaunch: args.includes('--paid-launch') });
console.log(JSON.stringify({ check: 'production-configuration', environmentFile: file, passed: !failures.length, missingOrInvalid: failures, note: 'Configuration checks do not prove live delivery, payments, backups or isolation acceptance.' }, null, 2));
process.exitCode = failures.length ? 1 : 0;
