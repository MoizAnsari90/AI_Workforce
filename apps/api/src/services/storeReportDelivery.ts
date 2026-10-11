import { z } from 'zod';
import { env } from '../config/env';
import { ValidationError } from '../errors/AppError';
import { DispatchError, whatsappCredential } from './nicheProviders';
import type { StoreReport } from './storeReportService';

async function request(url: string, token: string, body?: unknown) {
  let response: Response;
  try { response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new DispatchError('The report provider response is unknown. Review delivery before retrying.', !!body); }
  if (!response.ok) throw new DispatchError('WhatsApp rejected the report request. Check your approved template and connection.', !!body && response.status >= 500);
  try { return await response.json(); } catch { throw new DispatchError('WhatsApp returned an incomplete response.', !!body); }
}
export async function verifyReportTemplate(tenantId: string, name: string, language: string) {
  const credentials = await whatsappCredential(tenantId);
  if (!credentials.wabaId) throw new ValidationError('Connect a WhatsApp Business account before enabling scheduled reports.');
  const raw = await request(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${credentials.wabaId}/message_templates?${new URLSearchParams({ name, fields: 'name,status,language,category,components', limit: '100' })}`, credentials.accessToken);
  const result = z.object({ data: z.array(z.object({ name: z.string(), language: z.string(), status: z.string(), category: z.string(), components: z.array(z.object({ type: z.string(), text: z.string().optional() })) })) }).parse(raw);
  const template = result.data.find(t => t.name === name && t.language === language && t.status === 'APPROVED' && t.category === 'UTILITY');
  const parameters = template?.components.find(c => c.type === 'BODY')?.text?.match(/\{\{[^}]+\}\}/g);
  if (!template || template.components.some(c => !['BODY', 'FOOTER'].includes(c.type)) || JSON.stringify(parameters) !== JSON.stringify(['{{1}}', '{{2}}', '{{3}}', '{{4}}', '{{5}}', '{{6}}', '{{7}}'])) throw new ValidationError('Choose an approved UTILITY report template with exactly seven numbered body parameters and no header or buttons. See Daily reports for the template example.');
}
export function reportTemplateParameters(report: StoreReport) {
  const clean = (value: string) => value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').slice(0, 350);
  return [report.period, String(report.orders), String(report.units), report.totals.map(t => `${t.orderValue} ${t.currency}`).join('; ') || 'No included orders', report.totals.map(t => `${t.paidOrderValue} ${t.currency}`).join('; ') || 'None', String(report.unfulfilledOrders), report.topProducts.slice(0, 3).map(p => `${p.title}: ${p.units}`).join('; ') || 'None'].map(clean);
}
export async function sendStoreReport(tenantId: string, recipient: string, templateName: string, language: string, report: StoreReport) {
  const credentials = await whatsappCredential(tenantId);
  if (recipient.replace(/^\+/, '') === credentials.phoneNumberId) throw new ValidationError('Enter the owner\'s WhatsApp phone number, not the connected number ID.');
  const result = z.object({ messages: z.array(z.object({ id: z.string().min(1) })).min(1) }).safeParse(await request(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`, credentials.accessToken, {
    messaging_product: 'whatsapp', to: recipient.replace(/^\+/, ''), type: 'template',
    template: { name: templateName, language: { code: language }, components: [{ type: 'body', parameters: reportTemplateParameters(report).map(text => ({ type: 'text', text })) }] },
  }));
  if (!result.success) throw new DispatchError('Report acceptance could not be confirmed. Check Meta delivery activity.', true);
  return result.data.messages[0].id;
}
