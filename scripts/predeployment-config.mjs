import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const localDirectory = path.join(root, '.local/predeployment');
export const secretsFile = path.join(localDirectory, 'keys.json');

export function sourceEnvironment() {
  const values = {};
  // Match the API's API-directory-first dotenv precedence; injected values win.
  for (const name of ['apps/api/.env', '.env']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) {
      for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(file)))) {
        if (!(key in values)) values[key] = value;
      }
    }
  }
  return { ...values, ...process.env };
}

export function restrictSecretFile(file) {
  if (process.platform !== 'win32') { fs.chmodSync(file, 0o600); return; }
  const identity = execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
  const sid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error('Cannot resolve the current Windows identity for secret-file permissions');
  execFileSync('icacls', [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`, '/q'], { stdio: 'pipe', windowsHide: true });
  // Keep the actual workspace owner able to use keys created by an isolated tool account.
  const quotedRoot = root.replaceAll("'", "''");
  const owner = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `([System.Security.Principal.NTAccount]::new((Get-Acl -LiteralPath '${quotedRoot}').Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value`], { encoding: 'utf8', windowsHide: true }).trim();
  if (!/^S-1-\d+(?:-\d+)+$/.test(owner)) throw new Error('Cannot resolve workspace ownership for secret-file permissions');
  if (owner !== sid) execFileSync('icacls', [file, '/grant:r', `*${owner}:(F)`, '/q'], { stdio: 'pipe', windowsHide: true });
}

export function prepareKeys() {
  fs.mkdirSync(localDirectory, { recursive: true });
  const source = sourceEnvironment();
  const existing = fs.existsSync(secretsFile) ? JSON.parse(fs.readFileSync(secretsFile, 'utf8')) : {};
  const keys = { ...existing };
  for (const name of ['JWT_SECRET', 'INTEGRATION_ENCRYPTION_KEY', 'MEDICAL_DATA_ENCRYPTION_KEY']) {
    if (!keys[name]) keys[name] = source[name] || randomBytes(32).toString('hex');
    const valid = name === 'MEDICAL_DATA_ENCRYPTION_KEY' ? /^[a-f0-9]{64}$/i.test(keys[name]) : keys[name].length >= 32;
    if (!valid) throw new Error(`${name} exists but is invalid; refusing to rotate it automatically`);
  }
  if (!fs.existsSync(secretsFile)) fs.writeFileSync(secretsFile, JSON.stringify(keys, null, 2), { mode: 0o600, flag: 'wx' });
  else if (Object.keys(keys).some(key => keys[key] !== existing[key])) {
    restrictSecretFile(secretsFile);
    fs.writeFileSync(secretsFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
  }
  restrictSecretFile(secretsFile);
  return keys;
}

export function redisUrl(source) {
  if (source.REDIS_URL) return source.REDIS_URL;
  const url = new URL(`redis://${source.REDIS_HOST || 'localhost'}:${source.REDIS_PORT || '6379'}/${source.REDIS_DB || '0'}`);
  if (source.REDIS_PASSWORD) {
    url.username = source.REDIS_USERNAME || 'default';
    url.password = source.REDIS_PASSWORD;
  }
  return url.toString();
}

export function localDatabaseUrl(source) {
  let url;
  try { url = new URL(source.DATABASE_URL); } catch { throw new Error('A valid local DATABASE_URL is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Predeployment rehearsal is restricted to a loopback PostgreSQL server');
  }
  if (decodeURIComponent(url.pathname).replace(/^\//, '') === 'ai_workforce_predeployment') {
    throw new Error('Rehearsal database must differ from the configured application database');
  }
  url.pathname = '/ai_workforce_predeployment';
  url.search = '';
  return url;
}
