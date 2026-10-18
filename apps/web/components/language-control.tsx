'use client';

import { useId } from 'react';
import { Languages } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { LANGUAGES, type Locale } from '@/lib/language';

export function LanguageControl() {
  const { locale, setLocale, t } = useTranslation();
  const id = useId();
  return <div className="wf-language-control">
    <Languages size={17} aria-hidden="true" />
    <label className="sr-only" htmlFor={id}>{t('Interface language')}</label>
    <select id={id} aria-label={t('Interface language')} value={locale} onChange={event => setLocale(event.target.value as Locale)}>
      {LANGUAGES.map(language => <option key={language.code} value={language.code} lang={language.code}>{language.name}</option>)}
    </select>
  </div>;
}
