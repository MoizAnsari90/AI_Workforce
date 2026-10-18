export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'ur', name: 'اردو', dir: 'rtl' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
] as const;
export type Locale = typeof LANGUAGES[number]['code'];
export const LANGUAGE_COOKIE = 'ai-workforce-language';
export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ur' || value === 'ar';
}
export function direction(locale: Locale): 'rtl' | 'ltr' { return locale === 'en' ? 'ltr' : 'rtl'; }

/** An explicit cookie wins. Only allowlisted language tags can reach HTML attributes. */
export function selectLocale(cookie: unknown, acceptLanguage = ''): Locale {
  if (isLocale(cookie)) return cookie;
  const preferences = acceptLanguage.split(',').map((entry, index) => {
    const [tag, ...parameters] = entry.trim().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    const q = quality ? Number(quality.trim().slice(2)) : 1;
    return { code: tag.toLowerCase().split('-')[0], q, index };
  }).filter(entry => Number.isFinite(entry.q) && entry.q > 0 && entry.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return preferences.find(entry => isLocale(entry.code))?.code as Locale || 'en';
}
