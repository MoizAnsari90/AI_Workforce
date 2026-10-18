'use client';

import Image from 'next/image';
import { useState } from 'react';
import { ArrowUpRight, AudioLines, Check, CircleAlert, Pause, Play, Sparkles } from 'lucide-react';
import { useCompanion } from '@/contexts/CompanionContext';
import { useTranslation } from '@/contexts/LanguageContext';
import './agent-companion.css';

export function AgentCompanion() {
  const { state } = useCompanion();
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const Icon = state === 'error' ? CircleAlert : state === 'answered' ? Check : state === 'listening' ? AudioLines : Sparkles;
  const message = state === 'listening' ? t('Recording your voice…') : state === 'thinking' ? t('Processing your question…') : state === 'answered' ? t('Your answer is ready.') : state === 'error' ? t('Check the chat message.') : t('Ready for your next question.');

  return <section className="wf-companion wf-panel" data-state={state} data-motion={paused ? 'paused' : 'active'} aria-label={t('Your workforce companion')}>
    <div className="wf-companion-heading"><span className="wf-eyebrow">{t('YOUR AI COMPANION')}</span><button className="wf-icon-button" type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? t('Resume animation') : t('Pause animation')} title={paused ? t('Resume animation') : t('Pause animation')} aria-pressed={paused}>{paused ? <Play size={15} /> : <Pause size={15} />}</button></div>
    <div className="wf-companion-stage" aria-hidden="true">
      <div className="wf-companion-halo" /><div className="wf-companion-orbit" />
      <div className="wf-companion-portrait"><Image src="/images/workforce-companion.webp" alt="" width={640} height={640} sizes="(max-width: 700px) 72px, (max-width: 1023px) 180px, 340px" unoptimized /><span className="wf-companion-scan" /></div>
      <div className="wf-companion-platform" />
    </div>
    <div className="wf-companion-copy"><h2>{t('Your workforce companion')}</h2><p role="status" aria-live="polite" aria-atomic="true"><Icon size={14} aria-hidden="true" /><span>{message}</span></p></div>
    <div className="wf-companion-footer"><span className="wf-companion-signal" aria-hidden="true"><i /><i /><i /><i /><i /></span><a href="#workforce-question" className="wf-text-button" onClick={() => document.getElementById('workforce-question')?.focus()}>{t('Go to chat')}<ArrowUpRight size={14} aria-hidden="true" /></a></div>
  </section>;
}
