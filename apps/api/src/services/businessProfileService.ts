import { z } from 'zod';
import { prisma } from '../lib/prisma';

export const markets = [
  { code: 'PK', name: 'Pakistan', currency: 'PKR', timezone: 'Asia/Karachi', languages: ['en', 'ur', 'ur-Latn'] },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai', languages: ['en', 'ar', 'ur'] },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York', languages: ['en', 'es'] },
] as const;
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const businessProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.enum(['PK', 'AE', 'US']),
  industry: z.enum(['ecommerce', 'real_estate', 'healthcare']),
  currency: z.enum(['PKR', 'AED', 'USD']),
  timezone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return value.includes('/'); } catch { return false; } }, 'Choose a valid IANA timezone.'),
  languages: z.array(z.enum(['en', 'ur', 'ur-Latn', 'ar', 'es'])).min(1).max(5).refine(values => new Set(values).size === values.length, 'Languages must be unique.'),
  primaryLanguage: z.enum(['en', 'ur', 'ur-Latn', 'ar', 'es']),
  workingHours: z.array(z.object({ day: z.number().int().min(0).max(6), enabled: z.boolean(), start: time, end: time }).strict()).length(7),
  slotMinutes: z.number().int().min(10).max(180),
  bufferMinutes: z.number().int().min(0).max(60),
}).strict().superRefine((value, context) => {
  if (!value.languages.includes(value.primaryLanguage)) context.addIssue({ code: 'custom', path: ['primaryLanguage'], message: 'Primary language must be one of the selected languages.' });
  if (new Set(value.workingHours.map(day => day.day)).size !== 7) context.addIssue({ code: 'custom', path: ['workingHours'], message: 'Provide each weekday exactly once.' });
  for (const [index, day] of value.workingHours.entries()) if (day.enabled && day.start >= day.end) context.addIssue({ code: 'custom', path: ['workingHours', index], message: 'Closing time must be after opening time. Overnight hours are not supported yet.' });
});
export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export async function getBusinessProfile(tenantId: string) {
  const stored = await prisma.businessProfile.findUnique({ where: { tenantId } });
  return stored ? { profile: businessProfileSchema.parse(stored.profile), updatedAt: stored.updatedAt.toISOString() } : { profile: null, updatedAt: null };
}

export async function saveBusinessProfile(tenantId: string, userId: string, input: unknown) {
  const profile = businessProfileSchema.parse(input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
    const stored = await tx.businessProfile.upsert({ where: { tenantId }, create: { tenantId, profile }, update: { profile } });
    await tx.auditLog.create({ data: { tenantId, actorType: 'user', actorId: userId, operation: 'business_profile_updated', entityType: 'business_profile', entityId: tenantId, newValue: JSON.stringify({ country: profile.country, industry: profile.industry, timezone: profile.timezone }) } });
    return { profile, updatedAt: stored.updatedAt.toISOString() };
  });
}
