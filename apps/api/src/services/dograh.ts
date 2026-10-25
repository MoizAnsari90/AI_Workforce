import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { IntegrationService } from './integrationService';
import { DispatchError } from './nicheProviders';
import { ServiceUnavailableError, ValidationError } from '../errors/AppError';

const credentialSchema = z.object({
  apiUrl: z.string().url().max(500).optional(),
  apiKey: z.string().min(8).max(2048).optional(),
  agentId: z.string().min(1).max(200),
  webhookSecret: z.string().min(32).max(256),
}).strict();

export type DograhCredential = z.infer<typeof credentialSchema> & { apiUrl: string; apiKey: string };

function baseUrl(raw: string) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase();
  const localDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const unsafeHost = isIP(hostname) !== 0 || /^\d+$/.test(hostname) || ['.localhost', '.local', '.internal'].some(suffix => hostname.endsWith(suffix));
  if (url.username || url.password || url.search || url.hash || (unsafeHost && !(process.env.NODE_ENV !== 'production' && localDevelopmentHost)) || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && localDevelopmentHost))) {
    throw new ValidationError('Dograh URL must use HTTPS (HTTP is allowed only for local development) and must not contain credentials, query, or hash values.');
  }
  return url.toString().replace(/\/$/, '');
}

export function dograhWebhookUrl(tenantId: string) {
  const origin = process.env.PUBLIC_API_URL;
  if (!origin) throw new ServiceUnavailableError('Set PUBLIC_API_URL to the public HTTPS API origin before configuring the Dograh webhook.');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ServiceUnavailableError('PUBLIC_API_URL must be a public HTTPS API origin.');
  return `${url.origin}/api/webhooks/dograh/${encodeURIComponent(tenantId)}`;
}

export async function getDograhCredential(tenantId: string): Promise<DograhCredential> {
  const saved = await IntegrationService.getCredential(tenantId, 'dograh');
  const parsed = credentialSchema.safeParse({
    apiUrl: (saved?.apiUrl ?? process.env.DOGRAH_API_URL) || 'https://app.dograh.com',
    apiKey: saved?.apiKey ?? process.env.DOGRAH_API_KEY,
    agentId: saved?.agentId ?? process.env.DOGRAH_AGENT_ID,
    webhookSecret: saved?.webhookSecret ?? process.env.DOGRAH_WEBHOOK_SECRET,
  });
  if (!parsed.success || !parsed.data.apiKey) throw new ServiceUnavailableError('Configure Dograh API URL, API key, Agent ID and a 32-character webhook secret for this workspace.');
  return { ...parsed.data, apiUrl: baseUrl(parsed.data.apiUrl!), apiKey: parsed.data.apiKey };
}

export async function connectDograh(tenantId: string, userId: string, raw: unknown) {
  const input = credentialSchema.parse(raw);
  if (!input.apiKey && !process.env.DOGRAH_API_KEY) throw new ValidationError('Dograh API key is required.');
  if (!input.agentId && !process.env.DOGRAH_AGENT_ID) throw new ValidationError('Dograh Agent ID is required.');
  const config = {
    apiUrl: baseUrl(input.apiUrl || process.env.DOGRAH_API_URL || 'https://app.dograh.com'),
    apiKey: input.apiKey || process.env.DOGRAH_API_KEY!,
    agentId: input.agentId || process.env.DOGRAH_AGENT_ID!,
    webhookSecret: input.webhookSecret,
  };
  await IntegrationService.storeCredential({ tenantId, userId, provider: 'dograh', config });
  return { connected: true, webhookUrl: dograhWebhookUrl(tenantId) };
}

export async function sendDograhCall(tenantId: string, phone: string, reference: string) {
  const credential = await getDograhCredential(tenantId);
  const url = `${credential.apiUrl}/api/v1/public/agent/workflow/${encodeURIComponent(credential.agentId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': credential.apiKey },
      body: JSON.stringify({ phone_number: phone, initial_context: { workforce_dispatch_id: reference, tenant_id: tenantId } }),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new DispatchError('Dograh call result is unknown. Check Dograh call activity before retrying.', true);
  }
  if (!response.ok) throw new DispatchError('Dograh rejected the call request. Check API key, Agent ID and telephony setup.', response.status >= 500);
  const result = z.object({ workflow_run_id: z.union([z.string().min(1), z.number().int().positive()]) }).safeParse(await response.json().catch(() => null));
  if (!result.success) throw new DispatchError('Dograh did not return a workflow_run_id; reconcile call activity before retrying.', true);
  return String(result.data.workflow_run_id);
}

export function verifyDograhWebhookSecret(tenantSecret: string, header: string | undefined) {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : header || '';
  const expected = Buffer.from(tenantSecret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
