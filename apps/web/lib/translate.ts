import ur from '@/locales/ur.json';
import ar from '@/locales/ar.json';
import type { Locale } from './language';

const catalogs: Record<Exclude<Locale, 'en'>, Record<string, string>> = { ur, ar };
export type TranslationValues = Record<string, string | number>;
/** Exact catalog lookup only: never translate arbitrary customer content or protocol values. */
export function translate(locale: Locale, message: string, values?: TranslationValues): string {
  const template = locale === 'en' || !Object.hasOwn(catalogs[locale], message) ? message : catalogs[locale][message];
  if (!values) return template;
  return template.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
}
