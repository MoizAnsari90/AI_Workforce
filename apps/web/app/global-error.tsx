'use client';
import './globals.css';
import { appearanceBootScript } from '@/lib/appearance';
import { useEffect, useState } from 'react';
import { direction, isLocale, LANGUAGE_COOKIE, type Locale } from '@/lib/language';
import { translate } from '@/lib/translate';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Root error boundaries replace the normal providers, so read only the locale preference.
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    try {
      const saved = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${LANGUAGE_COOKIE}=`))?.slice(LANGUAGE_COOKIE.length + 1);
      if (isLocale(saved)) setLocale(saved);
    } catch { /* English fallback if cookie access is blocked. */ }
  }, []);
  const t = (message: string) => translate(locale, message);
  return (
    <html lang={locale} dir={direction(locale)} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} /></head>
      <body>
        <main className="wf-error-page"><h2>{t('Something went wrong!')}</h2>
        <p>{t('Please try again to return to your workspace.')}</p>
        <button className="wf-error-action" onClick={() => reset()}>{t('Try again')}</button></main>
      </body>
    </html>
  );
}
