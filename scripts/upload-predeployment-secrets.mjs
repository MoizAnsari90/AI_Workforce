// Run only after billing and hosted URLs are configured. Secret values use stdin.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, sourceEnvironment, prepareKeys } from './predeployment-config.mjs';

const source = sourceEnvironment();
const project = source.GCP_PROJECT_ID || 'gen-lang-client-0445651739';
const report = { timestamp: new Date().toISOString(), applied: false, results: [], errors: [] };
let stage = 'arguments';
try {
  if (!process.argv.includes('--apply')) throw new Error('This is a mutating command; run with --apply only after billing and hosted credentials are configured.');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) throw new Error('Invalid project identifier');
  stage = 'hosted credential validation';
  const values = { ...source, ...prepareKeys(), DATABASE_URL: source.DEPLOY_DATABASE_URL || source.DATABASE_URL, REDIS_URL: source.DEPLOY_REDIS_URL || source.REDIS_URL, DIRECT_DATABASE_URL: source.DEPLOY_DIRECT_DATABASE_URL || source.DIRECT_DATABASE_URL };
  for (const [name, protocols] of [['DATABASE_URL', ['postgres:', 'postgresql:']], ['REDIS_URL', ['redis:', 'rediss:']]]) {
    let url;
    try { url = new URL(values[name]); } catch { throw new Error(`${name} needs a hosted URL`); }
    const socket = name === 'DATABASE_URL' && (url.searchParams.get('host') || '').startsWith('/cloudsql/');
    if (!protocols.includes(url.protocol) || (['localhost', '127.0.0.1', '[::1]', 'postgres', 'redis'].includes(url.hostname) && !socket)) throw new Error(`${name} needs a hosted URL`);
  }
  const bindings = fs.readFileSync(path.join(root, 'deploy/gcp/api-secrets.local.txt'), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const match = /^([A-Z][A-Z0-9_]*)=([A-Za-z0-9_-]+):([1-9][0-9]*)$/.exec(line);
    if (!match) throw new Error('Invalid pinned secret binding');
    const [, key, name, version] = match;
    if (!values[key]?.trim() || /YOUR_|REPLACE/i.test(values[key])) throw new Error(`${key} is missing or a placeholder`);
    return { key, name, version };
  });
  const required = ['DATABASE_URL', 'REDIS_URL', 'GEMINI_API_KEY', 'JWT_SECRET', 'INTEGRATION_ENCRYPTION_KEY', 'MEDICAL_DATA_ENCRYPTION_KEY', 'META_APP_SECRET', 'META_VERIFY_TOKEN'];
  if (new Set(bindings.map(binding => binding.key)).size !== bindings.length || required.some(key => !bindings.some(binding => binding.key === key))) {
    throw new Error('Invalid or incomplete secret bindings');
  }
  const sdk = path.join(root, '.local/gcloud-cli/google-cloud-sdk');
  const executable = process.platform === 'win32' ? path.join(sdk, 'platform/bundledpython/python.exe') : 'gcloud';
  const prefix = process.platform === 'win32' ? [path.join(sdk, 'lib/gcloud.py')] : [];
  const runtime = { ...process.env, CLOUDSDK_CONFIG: path.join(root, '.local/gcloud-config'), CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: 'true', CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: 'true' };
  function gcloud(args, input) {
    return spawnSync(executable, [...prefix, ...args, `--project=${project}`, '--quiet', '--format=json'], { env: runtime, input, encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 1024 * 1024 });
  }
  function checked(args, input) {
    const result = gcloud(args, input);
    if (result.status !== 0) throw new Error('Google Cloud command failed; provider output suppressed');
    return result.stdout.trim() ? JSON.parse(result.stdout) : {};
  }
  stage = 'billing guard';
  if (!checked(['billing', 'projects', 'describe', project]).billingEnabled) throw new Error('Billing is not enabled; no cloud resources were changed');
  stage = 'Secret Manager API enablement';
  checked(['services', 'enable', 'secretmanager.googleapis.com']);
  for (const { key, name, version } of bindings) {
    stage = `secret reference ${key}`;
    const existing = gcloud(['secrets', 'versions', 'describe', version, `--secret=${name}`]);
    if (existing.status === 0) {
      if (JSON.parse(existing.stdout).state !== 'ENABLED') throw new Error('Pinned secret version is not enabled');
      report.results.push({ key, reference: `${name}:${version}`, action: 'preserved existing version; payload not compared' });
      continue;
    }
    const versions = gcloud(['secrets', 'versions', 'list', name]);
    let next = 1;
    if (versions.status === 0) next = Math.max(0, ...JSON.parse(versions.stdout).map(item => Number(item.name.split('/').at(-1)))) + 1;
    else {
      // Fail on permission/network errors instead of treating them as a missing secret.
      if (!/NOT_FOUND|not found/i.test(versions.stderr || '')) throw new Error('Cannot inspect secret versions');
      if (version !== '1') throw new Error('A new secret must pin version 1');
      checked(['secrets', 'create', name, '--replication-policy=automatic']);
    }
    if (Number(version) !== next) throw new Error('Pinned version does not match the next available version; update references first');
    const created = checked(['secrets', 'versions', 'add', name, '--data-file=-'], values[key]);
    if (created.name?.split('/').at(-1) !== version) throw new Error('Created version differs from the pinned reference');
    report.results.push({ key, reference: `${name}:${version}`, action: 'created via stdin; payload omitted' });
  }
  report.applied = true;
} catch (error) {
  report.errors.push({ stage, message: /^Google Cloud command failed|^Billing is not|^This is a mutating|^[A-Z_]+ (is missing|needs a hosted)|^Invalid |^Cannot inspect|^Pinned |^A new secret|^Created version/.test(error.message) ? error.message : 'Operation failed; credential-bearing details suppressed' });
} finally {
  fs.writeFileSync(path.join(root, 'artifacts/predeployment-secret-upload.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.applied ? 0 : 1;
}
