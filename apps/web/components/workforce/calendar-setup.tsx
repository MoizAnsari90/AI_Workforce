"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { workforceRequest } from '@/lib/workforce-api';
import { LoadError } from './page-kit';

type Calendar = { id: string; name: string; timezone: string | null; primary: boolean };
type Connection = { configured: boolean; connected: boolean; canBook?: boolean; calendars: Calendar[]; selected?: Calendar | null };
type Availability = { date: string; timezone: string; calendarName: string; slotMinutes: number; slots: { start: string; end: string }[]; checkedAt: string };

export function CalendarSetup({ isAdmin, profileSaved, profileRevision }: { isAdmin: boolean; profileSaved: boolean; profileRevision: string | null }) {
  const { t, locale } = useTranslation();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [calendarId, setCalendarId] = useState('');
  const [date, setDate] = useState('');
  const [availability, setAvailability] = useState<Availability | null>(null);
  const request = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    if (!isAdmin) { setLoading(false); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try { const value = await workforceRequest<Connection>('/api/proxy/calendar/google/connection', { signal: controller.signal }); setConnection(value); setCalendarId(value.selected?.id || ''); }
    catch (error) { if (!controller.signal.aborted) { setConnection(null); setError(error instanceof Error ? error.message : 'Could not load your calendar.'); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [isAdmin]);
  useEffect(() => { void refresh(); return () => { request.current?.abort(); actionRequest.current?.abort(); }; }, [refresh]);
  useEffect(() => { setAvailability(null); }, [profileRevision, profileSaved]);
  async function action(work: (signal: AbortSignal) => Promise<void>) {
    if (!isAdmin || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); setAvailability(null);
    const controller = new AbortController(); actionRequest.current = controller;
    try { await work(controller.signal); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The calendar request failed.'); }
    finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  function connect() { void action(async signal => { const result = await workforceRequest<{ authorizationUrl: string }>('/api/proxy/calendar/google/start', { method: 'POST', signal }); window.location.assign(result.authorizationUrl); }); }
  function select() { void action(async signal => { await workforceRequest('/api/proxy/calendar/google/selection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calendarId }), signal }); await refresh(); setNotice('Calendar selected. Check a date to verify availability.'); }); }
  function disconnect() { if (!window.confirm(t('Disconnect Google Calendar from this workspace?'))) return; void action(async signal => { await workforceRequest('/api/proxy/calendar/google/connection', { method: 'DELETE', signal }); setConnection(current => ({ configured: current?.configured ?? false, connected: false, calendars: [] })); setCalendarId(''); setNotice('Calendar disconnected. To revoke the Google grant too, remove AI Workforce in your Google Account connections.'); }); }
  return <section className="wf-panel wf-calendar-setup" id="calendar">
    <div className="wf-record-heading"><span className="wf-record-icon wf-tone-blue"><CalendarDays size={22} /></span><div><h2>{t("Google Calendar")}</h2><p>{t("Connect a calendar to check available appointment times.")}</p></div><span className={`wf-badge ${connection?.connected ? 'wf-badge-mint' : ''}`}>{!isAdmin ? t("Admin access") : loading ? t("Checking") : error && !connection ? t("Status unavailable") : connection?.connected ? t("Connected") : t("Not connected")}</span></div>
    <div className="wf-settings-body"><LoadError error={error} retry={() => void refresh()} />{notice && <div className="wf-notice" role="status">{t(notice)}</div>}
      {!isAdmin ? <p className="wf-helper">{t("A workspace admin can connect and manage calendars.")}</p> : <>
        {!loading && !connection?.configured && connection && <div className="wf-access-note"><ShieldCheck size={19} /><div><strong>{t("Calendar setup is not enabled yet.")}</strong><p>{t("Your platform administrator needs to enable Google Calendar. You won't need to copy API keys.")}</p></div></div>}
        <div className="wf-calendar-actions"><button className="wf-button wf-button-secondary" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={15} />{t("Refresh status")}</button><button className="wf-button wf-button-primary" disabled={busy || loading || !connection?.configured} onClick={connect}>{busy ? t("Please wait…") : connection?.connected ? t("Reconnect Google") : t("Connect Google Calendar")}<ArrowUpRight size={15} /></button>{(connection?.connected || (!connection && error)) && <button className="wf-disconnect" disabled={busy} onClick={disconnect}><Unplug size={14} />{t("Disconnect")}</button>}</div>
        {connection?.connected && <>
          {!connection.canBook && <p className="wf-setup-help">{t("Availability is connected. Reconnect Google and allow event creation to use appointment booking.")}</p>}
          <div className="wf-calendar-selection"><label><span className="wf-field-label">{t("Calendar to check")}</span><select className="wf-field" value={calendarId} disabled={busy} onChange={event => { setCalendarId(event.target.value); setAvailability(null); }}><option value="">{t("Select a calendar")}</option>{connection.calendars.map(item => <option key={item.id} value={item.id}>{item.name}{item.primary ? t("(Primary)") : ''}</option>)}</select></label><button className="wf-button wf-button-secondary" disabled={busy || !calendarId || calendarId === connection.selected?.id} onClick={select}><Check size={15} />{t("Use calendar")}</button></div>
          {!connection.calendars.length && <p className="wf-helper">{t("No calendars were returned. Add a calendar in Google and refresh here.")}</p>}
          <div className="wf-availability"><h3>{t("Test your availability")}</h3><p>{t("Uses your saved working hours and business timezone. This checks availability without booking an appointment.")}</p>{!profileSaved && <p className="wf-setup-help">{t("Save your business setup first.")}</p>}<form className="wf-calendar-selection" onSubmit={event => { event.preventDefault(); void action(async signal => { setAvailability(await workforceRequest<Availability>(`/api/proxy/calendar/google/availability?date=${encodeURIComponent(date)}`, { signal })); }); }}><label><span className="wf-field-label">{t("Date to check")}</span><input type="date" className="wf-field" required value={date} onChange={event => { setDate(event.target.value); setAvailability(null); }} /></label><button className="wf-button wf-button-secondary" disabled={busy || !date || !profileSaved || !connection.selected || calendarId !== connection.selected.id}>{t("Check availability")}</button></form>
            {availability && <div className="wf-availability-result" role="status"><strong>{availability.slots.length}  {t("available times ·")} {availability.slotMinutes}  {t("minutes")}</strong><p>{availability.date} · {availability.timezone}</p>{availability.slots.length ? <ul>{availability.slots.map(slot => <li key={slot.start}>{new Intl.DateTimeFormat(locale, { timeZone: availability.timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(slot.start))}</li>)}</ul> : <p>{t("No available slots in your saved working hours for this date.")}</p>}<small>{t("Checked")} {new Date(availability.checkedAt).toLocaleTimeString(locale)}{t(". Availability can change.")}</small></div>}
          </div>
        </>}
      </>}
      <p className="wf-page-footnote">{t("Availability checks do not book appointments. Create and cancel appointments from Real estate or Clinic reception after allowing event creation in Google. Customer reminders are not sent by this connection.")}</p>
    </div>
  </section>;
}
