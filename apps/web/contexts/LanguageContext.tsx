'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { direction, isLocale, LANGUAGE_COOKIE, type Locale } from '@/lib/language';
import { translate, type TranslationValues } from '@/lib/translate';

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (message: string, values?: TranslationValues) => string;
};
const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setCurrentLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    // This non-sensitive preference must be readable by SSR. No authentication cookie is touched.
    try { document.cookie = `${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* Selection still works if storage is blocked. */ }
    setCurrentLocale(next);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
  }, [locale]);
  useEffect(() => {
    const sync = () => {
      try {
        const saved = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${LANGUAGE_COOKIE}=`))?.slice(LANGUAGE_COOKIE.length + 1);
        if (isLocale(saved)) setCurrentLocale(saved);
      } catch { /* Cookie access can be denied by browser policy. */ }
    };
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);
  const t = useCallback((message: string, values?: TranslationValues) => translate(locale, message, values), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useTranslation requires LanguageProvider');
  return context;
}
