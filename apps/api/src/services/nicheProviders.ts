import { z } from 'zod';
import { IntegrationService } from './integrationService';
import { env } from '../config/env';
import { ServiceUnavailableError, ValidationError } from '../errors/AppError';
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
