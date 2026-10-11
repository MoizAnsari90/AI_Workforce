import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ServiceUnavailableError } from '../errors/AppError';

export const automationConfig = z.object({ kind: z.enum(['healthcare', 'real_estate']), whatsappEnabled: z.boolean(), voiceEnabled: z.boolean(), remindersEnabled: z.boolean(), reminderHours: z.number().int().min(1).max(72), templateName: z.string().regex(/^[a-z0-9_]*$/).max(100), templateLanguage: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/) }).strict();
export type AutomationConfig = z.infer<typeof automationConfig>;
export const defaultAutomation: AutomationConfig = { kind: 'healthcare', whatsappEnabled: false, voiceEnabled: false, remindersEnabled: false, reminderHours: 24, templateName: '', templateLanguage: 'en_US' };
export async function getAutomationConfig(tenantId: string) { const value = await prisma.nicheAutomation.findUnique({ where: { tenantId } }); return value ? automationConfig.parse(value.config) : null; }
function key() { const value = process.env.INTEGRATION_ENCRYPTION_KEY; if (!value || value.length < 32) throw new ServiceUnavailableError('Integration encryption must be configured.'); return crypto.createHash('sha256').update(`niche-automation:${value}`).digest(); }
export function sealAutomation(value: unknown, tenantId: string) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from(tenantId)); const content = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return [iv, cipher.getAuthTag(), content].map(part => part.toString('base64url')).join('.'); }
export function openAutomation<T>(value: string, tenantId: string): T { try { const [iv, tag, content] = value.split('.').map(part => Buffer.from(part, 'base64url')); const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv); decipher.setAAD(Buffer.from(tenantId)); decipher.setAuthTag(tag); return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString()) as T; } catch { throw new ServiceUnavailableError('Automation data could not be decrypted. Restore the original encryption key.'); } }
export function customerHash(phone: string) { return crypto.createHmac('sha256', key()).update(phone).digest('hex'); }
export function stableUuid(value: string) { const digest = crypto.createHash('sha256').update(value).digest('hex'); return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`; }
export const normalizePhone = (phone: string) => z.string().regex(/^\+[1-9]\d{7,14}$/).parse(phone.startsWith('+') ? phone : `+${phone}`);
export async function enqueueNicheDispatch(tenantId: string, dispatchKey: string, type: string, payload: unknown, dueAt = new Date()) {
  return prisma.nicheDispatch.upsert({ where: { tenantId_key: { tenantId, key: dispatchKey } }, create: { tenantId, key: dispatchKey, type, encryptedPayload: sealAutomation(payload, tenantId), dueAt }, update: {} });
}
