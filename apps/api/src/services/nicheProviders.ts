import crypto from 'node:crypto';
import { assertSubscription } from './subscriptionService';
import { z } from 'zod';
import { IntegrationService } from './integrationService';
import { env } from '../config/env';
import { ConflictError, ServiceUnavailableError, ValidationError } from '../errors/AppError';
import type { AutomationConfig } from './nicheAutomationStore';

export class DispatchError extends Error { constructor(message: string, public readonly uncertain: boolean) { super(message); } }
async function request(url: string, token: string, method = 'GET', body?: unknown) {
  let response: Response;
  try { response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(12_000) }); }
  catch { throw new DispatchError('Provider response unknown. Check provider activity before sending again.', method !== 'GET'); }
  if (!response.ok) throw new DispatchError('Provider rejected or could not complete the request. Check account configuration.', method !== 'GET' && response.status >= 500);
  const data: unknown = await response.json().catch(() => null);
  if (!data) throw new DispatchError('Provider returned an incomplete response.', method !== 'GET');
  return data;
}
export async function whatsappCredential(tenantId: string) {
  const value = await IntegrationService.getCredential(tenantId, 'whatsapp');
  const result = z.object({ accessToken: z.string().min(1), phoneNumberId: z.string().regex(/^\d+$/), wabaId: z.string().regex(/^\d+$/).optional() }).safeParse(value);
  if (!result.success) throw new ServiceUnavailableError('Connect this workspace to WhatsApp through Embedded Signup first.');
  return result.data;
}
const graph = () => `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}`;
export async function verifyReminderTemplate(tenantId: string, config: AutomationConfig) {
  const credential = await whatsappCredential(tenantId);
  if (!credential.wabaId || !config.templateName) throw new ValidationError('Choose an approved WhatsApp utility reminder template.');
  const raw = await request(`${graph()}/${credential.wabaId}/message_templates?${new URLSearchParams({ name: config.templateName, fields: 'name,status,language,category,components', limit: '100' })}`, credential.accessToken);
  const result = z.object({ data: z.array(z.object({ name: z.string(), status: z.string(), language: z.string(), category: z.string(), components: z.array(z.object({ type: z.string(), text: z.string().optional() })) })) }).safeParse(raw);
  const template = result.success ? result.data.data.find(item => item.name === config.templateName && item.language === config.templateLanguage && item.status === 'APPROVED' && item.category === 'UTILITY') : undefined;
  const body = template?.components.find(item => item.type === 'BODY')?.text;
  if (!template || !body || template.components.some(item => !['BODY', 'FOOTER'].includes(item.type)) || JSON.stringify(body.match(/\{\{\d+\}\}/g)) !== JSON.stringify(['{{1}}'])) throw new ValidationError('Use an approved UTILITY template with a text body containing exactly one {{1}} date/time parameter and no header or buttons.');
  return { name: template.name, language: template.language, text: body };
}
export async function sendNicheWhatsApp(tenantId: string, phone: string, payload: { text: string } | { template: string; language: string; dateTime: string }) {
  const credential = await whatsappCredential(tenantId);
  const body = 'text' in payload ? { type: 'text', text: { body: payload.text } } : { type: 'template', template: { name: payload.template, language: { code: payload.language }, components: [{ type: 'body', parameters: [{ type: 'text', text: payload.dateTime }] }] } };
  const data = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) }).safeParse(await request(`${graph()}/${credential.phoneNumberId}/messages`, credential.accessToken, 'POST', { messaging_product: 'whatsapp', to: phone.replace(/^\+/, ''), ...body }));
  if (!data.success) throw new DispatchError('WhatsApp acceptance could not be verified.', true);
  return data.data.messages[0].id;
}

export const voiceCredentials = z.object({ apiKey: z.string().min(10).max(1024), assistantId: z.string().uuid(), phoneNumberId: z.string().uuid(), webhookSecret: z.string().min(32).max(256) }).strict();
export function voiceWebhookUrl(tenantId: string) {
  const origin = process.env.PUBLIC_API_URL;
  if (!origin) throw new ServiceUnavailableError('The platform administrator must configure PUBLIC_API_URL for voice webhooks.');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ServiceUnavailableError('PUBLIC_API_URL must be a public HTTPS API origin.');
  return `${url.origin}/api/v1/webhook/${tenantId}/niche-voice`;
}
export async function getVoiceCredential(tenantId: string) {
  const data = voiceCredentials.safeParse(await IntegrationService.getCredential(tenantId, 'vapi'));
  if (!data.success) throw new ServiceUnavailableError('Connect a verified Vapi assistant and phone number first.');
  return data.data;
}
export async function connectNicheVoice(tenantId: string, userId: string, raw: unknown) {
  const input = voiceCredentials.parse(raw); const expected = voiceWebhookUrl(tenantId);
  const [assistantRaw, phoneRaw] = await Promise.all([request(`https://api.vapi.ai/assistant/${input.assistantId}`, input.apiKey), request(`https://api.vapi.ai/phone-number/${input.phoneNumberId}`, input.apiKey)]);
  const serverSchema = z.object({ url: z.string(), credentialId: z.string().optional() });
  const assistant = z.object({ id: z.string(), server: serverSchema.optional(), model: z.object({ toolIds: z.array(z.string().uuid()).max(30).optional() }).optional() }).parse(assistantRaw);
  const phone = z.object({ id: z.string(), assistantId: z.string().optional() }).parse(phoneRaw);
  if (assistant.id !== input.assistantId || phone.id !== input.phoneNumberId || phone.assistantId !== input.assistantId || assistant.server?.url !== expected || !assistant.server.credentialId) throw new ConflictError('Assign the saved assistant to this phone number and configure its server URL and bearer credential before connecting.');
  let toolVerified = false;
  for (const toolId of assistant.model?.toolIds || []) {
    const tool = z.object({ type: z.string(), async: z.boolean().optional(), function: z.object({ name: z.string(), parameters: z.object({ type: z.string(), required: z.array(z.string()), properties: z.object({ text: z.object({ type: z.string() }) }) }).optional() }).optional(), server: serverSchema.optional() }).safeParse(await request(`https://api.vapi.ai/tool/${toolId}`, input.apiKey));
    if (!tool.success || tool.data.function?.name !== 'workforce_turn') continue;
    const parameters = tool.data.function.parameters;
    toolVerified = tool.data.type === 'function' && !tool.data.async && parameters?.type === 'object' && parameters.required.includes('text') && parameters.properties.text.type === 'string' && tool.data.server?.url === expected && tool.data.server.credentialId === assistant.server.credentialId;
    if (toolVerified) break;
  }
  if (!toolVerified) throw new ConflictError('Attach a saved synchronous workforce_turn function tool with a required text string, this server URL, and the same bearer credential as the assistant.');
  await IntegrationService.storeCredential({ tenantId, userId, provider: 'vapi', config: input });
  return { connected: true, webhookUrl: expected };
}
export async function verifyNicheVoiceRequest(tenantId: string, authorization: string | undefined, callId: string) {
  const credential = await getVoiceCredential(tenantId);
  const expected = Buffer.from(`Bearer ${credential.webhookSecret}`); const received = Buffer.from(authorization || '');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  const call = z.object({ id: z.string(), assistantId: z.string(), phoneNumberId: z.string(), customer: z.object({ number: z.string() }), status: z.string().optional() }).parse(await request(`https://api.vapi.ai/call/${z.string().uuid().parse(callId)}`, credential.apiKey));
  if (call.id !== callId || call.assistantId !== credential.assistantId || call.phoneNumberId !== credential.phoneNumberId) return null;
  return call;
}
export async function sendNicheVoiceCall(tenantId: string, phone: string, reference: string) {
  await assertSubscription(tenantId);
  const credential = await getVoiceCredential(tenantId);
  const result = z.object({ id: z.string().uuid() }).safeParse(await request('https://api.vapi.ai/call', credential.apiKey, 'POST', { assistantId: credential.assistantId, phoneNumberId: credential.phoneNumberId, customer: { number: phone }, metadata: { workforceDispatch: reference } }));
  if (!result.success) throw new DispatchError('Call acceptance could not be verified. Check Vapi before calling again.', true);
  return result.data.id;
}
