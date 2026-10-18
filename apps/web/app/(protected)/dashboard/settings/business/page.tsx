"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, Check, Globe2, Save } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext.hooks';
import { workforceRequest } from '@/lib/workforce-api';
import { EmptyState, LoadError, PageHeading } from '@/components/workforce/page-kit';
import { CalendarSetup } from '@/components/workforce/calendar-setup';

type Profile = { name: string; country: string; industry: string; currency: string; timezone: string; languages: string[]; primaryLanguage: string; workingHours: { day: number; enabled: boolean; start: string; end: string }[]; slotMinutes: number; bufferMinutes: number };
type Result = { profile: Profile | null; updatedAt: string | null; markets: { code: string; name: string; currency: string; timezone: string; languages: string[] }[] };
const languages = [{ code: 'en', name: 'English' }, { code: 'ur', name: 'Urdu' }, { code: 'ur-Latn', name: 'Roman Urdu' }, { code: 'ar', name: 'Arabic' }, { code: 'es', name: 'Spanish' }];
const zones = ['Asia/Karachi', 'Asia/Dubai', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'America/Adak', 'America/Indiana/Indianapolis', 'America/Detroit'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function initialProfile(name: string, industry = 'ecommerce'): Profile { return { name, country: '', industry, currency: 'PKR', timezone: 'Asia/Karachi', languages: ['en'], primaryLanguage: 'en', workingHours: days.map((_, day) => ({ day, enabled: day > 0 && day < 6, start: '09:00', end: '17:00' })), slotMinutes: 30, bufferMinutes: 0 }; }

export default function BusinessSetupPage() {
  const { t } = useTranslation();
  const { user, tenant } = useAuth();
  const isAdmin = user?.role === 'admin';
  const tenantId = user?.tenantId;
  const [data, setData] = useState<Result | null>(null);
  const [form, setForm] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [guidedSetup, setGuidedSetup] = useState(false);
  const request = useRef<AbortController | null>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const saveLock = useRef(false);
  const load = useCallback(async () => {
    if (!tenantId) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try { const result = await workforceRequest<Result>(`/api/proxy/tenants/${tenantId}/business-setup`, { signal: controller.signal }); setData(result); const params = new URLSearchParams(window.location.search); const industry = params.get('industry'); setForm(result.profile || initialProfile(tenant?.name || '', industry || undefined)); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Business setup could not be loaded.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [tenantId, tenant?.name]);
  useEffect(() => { setData(null); setForm(null); void load(); return () => { request.current?.abort(); saveRequest.current?.abort(); }; }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setGuidedSetup(params.get('onboarding') === '1');
    const result = params.get('calendar');
    if (!result) return;
    const messages: Record<string, string> = { connected: 'Google connected. Select your calendar below to finish setup.', cancelled: 'Google setup was cancelled. You can try again.', invalid: 'The calendar callback was incomplete. Please start again.', session_expired: 'Your session expired. Sign in and reconnect Google.', failed: 'Google connection could not be completed. Retry and approve both calendar permissions.' };
    setNotice(messages[result] || messages.failed);
    params.delete('calendar');
    window.history.replaceState({}, '', `/dashboard/settings/business${params.size ? `?${params}` : ''}`);
  }, []);
  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(data?.profile);
  function patch(values: Partial<Profile>) { setForm(current => current ? { ...current, ...values } : current); setNotice(''); }
  async function save() {
    if (!form || !isAdmin || !tenantId || saveLock.current) return;
    setError(''); setNotice('');
    if (!form.languages.length || !form.languages.includes(form.primaryLanguage)) { setError('Select at least one language and a primary language from that selection.'); return; }
    if (form.workingHours.some(day => day.enabled && day.start >= day.end)) { setError('Closing time must be after opening time for each open day.'); return; }
    saveLock.current = true; setSaving(true); const controller = new AbortController(); saveRequest.current = controller;
    try { const result = await workforceRequest<Omit<Result, 'markets'>>(`/api/proxy/tenants/${tenantId}/business-setup`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), signal: controller.signal }); setData(current => current ? { ...current, ...result } : current); setForm(result.profile); setNotice(guidedSetup ? 'Business details saved. Continue to your setup checklist to connect the required services.' : 'Business setup saved. Your calendar checks and date-filtered workspace answers now use this timezone.'); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Your settings could not be saved.'); }
    finally { saveLock.current = false; if (!controller.signal.aborted) setSaving(false); }
  }
  return <div className="wf-page wf-business-page">
    <PageHeading eyebrow={t("SET THE FOUNDATION")} title={t("Built around your business.")} description={t("Choose your market, set your hours and connect your calendar.")} />
    <div className="wf-feature-banner"><span className="wf-feature-icon"><Globe2 size={26} /></span><div><h2>{t("One workforce. Your way of working.")}</h2><p>{t("Pakistan, UAE or US—save the settings your workspace should use.")}</p></div><span className={`wf-badge ${data?.profile ? 'wf-badge-mint' : ''}`}>{data?.profile ? t("Profile saved") : loading ? t("Loading") : t("Setup required")}</span></div>
    {guidedSetup && <div className="wf-notice" role="status"><Building2 size={17} /><span><strong>{t("Step 2 of 3: Add your business details.")}</strong>  {t("Save your country, timezone and working hours so your bundle uses the right settings. Next, connect the services it needs.")}</span></div>}
    <LoadError error={error} retry={() => void load()} />{notice && <div className="wf-notice" role="status"><Check size={17} /><span>{t(notice)}</span></div>}
    {!isAdmin && user && <div className="wf-notice">{t("A workspace admin can update these settings. You can review the saved profile.")}</div>}
    {!form ? <section className="wf-panel"><EmptyState icon={<Building2 size={28} />} title={loading ? t("Loading your business…") : t("Business setup unavailable")} description={t("Your saved settings will appear here.")} /></section> : <form className="wf-panel wf-business-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="wf-record-heading"><span className="wf-step-number">01</span><div><h2>{t("Business details")}</h2><p>{t("Your market and preferred settings.")}</p></div></div>
      <fieldset disabled={!isAdmin || saving || loading} className="wf-settings-body">
        <div className="wf-settings-grid">
          <label><span className="wf-field-label">{t("Business name")}</span><input className="wf-field" minLength={2} maxLength={120} required value={form.name} onChange={event => patch({ name: event.target.value })} autoComplete="organization" /></label>
          <label><span className="wf-field-label">{t("Business type")}</span><select className="wf-field" value={form.industry} onChange={event => patch({ industry: event.target.value })}><option value="ecommerce">{t("E-commerce")}</option><option value="real_estate">{t("Real estate agency")}</option><option value="healthcare">{t("Clinic / healthcare")}</option></select></label>
          <label><span className="wf-field-label">{t("Country")}</span><select className="wf-field" required value={form.country} onChange={event => { const market = data?.markets.find(item => item.code === event.target.value); if (market) patch({ country: market.code, currency: market.currency, timezone: market.timezone }); }}><option value="">{t("Choose your country")}</option>{data?.markets.map(market => <option key={market.code} value={market.code}>{t(market.name)}</option>)}</select></label>
          <label><span className="wf-field-label">{t("Currency")}</span><select className="wf-field" value={form.currency} onChange={event => patch({ currency: event.target.value })}>{['PKR', 'AED', 'USD'].map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <label><span className="wf-field-label">{t("Business timezone")}</span><input className="wf-field" list="business-timezones" required value={form.timezone} onChange={event => patch({ timezone: event.target.value })} /><datalist id="business-timezones">{zones.map(zone => <option key={zone} value={zone} />)}</datalist><small className="wf-settings-hint">{t("Use your local IANA timezone, for example America/Chicago. Daylight saving is handled automatically.")}</small></label>
          <label><span className="wf-field-label">{t("Primary conversation language")}</span><select className="wf-field" value={form.primaryLanguage} onChange={event => patch({ primaryLanguage: event.target.value })}>{languages.filter(item => form.languages.includes(item.code)).map(item => <option key={item.code} value={item.code}>{t(item.name)}</option>)}</select></label>
        </div>
        <div className="wf-language-options"><span className="wf-field-label">{t("Conversation languages")}</span><div>{languages.map(item => <label key={item.code}><input type="checkbox" checked={form.languages.includes(item.code)} onChange={event => { const next = event.target.checked ? [...form.languages, item.code] : form.languages.filter(code => code !== item.code); patch({ languages: next, primaryLanguage: next.includes(form.primaryLanguage) ? form.primaryLanguage : next[0] || '' }); }} />{t(item.name)}</label>)}</div><p className="wf-settings-hint">{t("Language and currency preferences are saved for your business workflows. They do not translate the dashboard or enable a bundle by themselves.")}</p></div>
      </fieldset>
      <div className="wf-record-heading wf-settings-divider"><span className="wf-step-number">02</span><div><h2>{t("Working hours")}</h2><p>{t("Times are in")} {form.timezone}{t(". Switch a day off when your business is closed.")}</p></div></div>
      <fieldset disabled={!isAdmin || saving || loading} className="wf-settings-body"><div className="wf-hours-list">{[1, 2, 3, 4, 5, 6, 0].map(day => { const hours = form.workingHours.find(item => item.day === day)!; const update = (value: Partial<typeof hours>) => patch({ workingHours: form.workingHours.map(item => item.day === day ? { ...item, ...value } : item) }); return <div className="wf-hours-row" key={day}><label className="wf-day-toggle"><input type="checkbox" checked={hours.enabled} onChange={event => update({ enabled: event.target.checked })} />{t(days[day])}</label>{hours.enabled ? <div><label><span className="sr-only">{t(days[day])}  {t("opening time")}</span><input className="wf-field" type="time" required value={hours.start} onChange={event => update({ start: event.target.value })} /></label><span>{t("to")}</span><label><span className="sr-only">{t(days[day])}  {t("closing time")}</span><input className="wf-field" type="time" required value={hours.end} onChange={event => update({ end: event.target.value })} /></label></div> : <span className="wf-helper">{t("Closed")}</span>}</div>; })}</div>
        <div className="wf-settings-grid wf-slot-settings"><label><span className="wf-field-label">{t("Appointment duration (minutes)")}</span><input type="number" className="wf-field" min={10} max={180} required value={form.slotMinutes} onChange={event => patch({ slotMinutes: Number(event.target.value) })} /></label><label><span className="wf-field-label">{t("Buffer between appointments (minutes)")}</span><input type="number" className="wf-field" min={0} max={60} required value={form.bufferMinutes} onChange={event => patch({ bufferMinutes: Number(event.target.value) })} /></label></div>
      </fieldset><div className="wf-settings-save"><span className="wf-helper">{dirty ? t("You have unsaved settings.") : t("Your settings are saved.")}</span><button type="submit" className="wf-button wf-button-primary" disabled={!isAdmin || saving || loading || !dirty}><Save size={16} />{saving ? t("Saving…") : t("Save business setup")}</button></div>
    </form>}
    <CalendarSetup key={tenantId} isAdmin={isAdmin} profileSaved={!!data?.profile && !dirty} profileRevision={data?.updatedAt || null} />
    <div className="wf-test-callout"><div><h3>{guidedSetup ? t("Continue your setup.") : t("Keep connecting your business.")}</h3><p>{guidedSetup ? t("Your checklist will show the exact next step for your selected bundle.") : t("Manage your store and WhatsApp connections in Integrations. Calendar setup is available here for booking workflows.")}</p></div><Link className="wf-text-button" href={guidedSetup ? '/dashboard/onboarding' : '/dashboard/integrations'}>{guidedSetup ? t("Return to setup checklist") : t("Open integrations")} <ArrowRight size={16} /></Link></div>
  </div>;
}
