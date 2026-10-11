"use client";

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CalendarDays, Check, FileText, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext.hooks';
import { workforceRequest } from '@/lib/workforce-api';
import { PageHeading, LoadError, StatusBadge, useWorkspaceResource } from '@/components/workforce/page-kit';

type Settings = { enabled: boolean; recipient: string; deliveryTime: string; templateName: string; templateLanguage: string; consent: boolean; timezone: string; nextRunAt?: string };
type Report = { period: string; orders: number; units: number; paidOrders: number; unpaidOrders: number; unfulfilledOrders: number; cancelledOrders: number; testOrdersExcluded: number; totals: Array<{ currency: string; orderValue: string; paidOrderValue: string }>; topProducts: Array<{ title: string; units: number }>; definition: string; checkedAt: string };
type Data = { settings: Settings; reports: Array<{ id: string; reportDate: string; status: string; error?: string; summary?: Report }> };

export default function ReportsPage() {
  const { user } = useAuth();
  if (!user) return <p className="wf-helper">Loading workspace…</p>;
  if (user.role !== 'admin') return <div className="wf-page"><PageHeading eyebrow="DAILY REPORTS" title="Your store, at a glance." description="Your workspace admin can view store reports and configure owner notifications." /></div>;
  return <StoreReports key={user.tenantId} tenantId={user.tenantId} />;
}
function StoreReports({ tenantId }: { tenantId: string }) {
  const base = `/api/proxy/tenants/${tenantId}/store-reports`;
  const { data, error, loading, refresh } = useWorkspaceResource<Data>(base, 30000);
  const [form, setForm] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [previewBusy, setPreviewBusy] = useState(false);
  const [notice, setNotice] = useState(''), [actionError, setActionError] = useState(''), [date, setDate] = useState('');
  const [preview, setPreview] = useState<Report | null>(null);
  useEffect(() => { if (data && !dirty) setForm(data.settings); }, [data, dirty]);
  function edit(values: Partial<Settings>) { setForm(current => current ? { ...current, ...values } : current); setDirty(true); setNotice(''); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!form || busy) return; setBusy(true); setActionError('');
    try {
      const { enabled, recipient, deliveryTime, templateName, templateLanguage, consent } = form;
      await workforceRequest(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, recipient, deliveryTime, templateName, templateLanguage, consent }), signal: AbortSignal.timeout(90000) });
      setDirty(false); await refresh(); setNotice(enabled ? 'Daily reports enabled. The previous completed day will be sent at your selected local time.' : 'Report settings saved. Scheduled sending is off.');
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Could not save report settings.'); }
    finally { setBusy(false); }
  }
  async function check() {
    setPreviewBusy(true); setActionError(''); setPreview(null);
    try { setPreview(await workforceRequest<Report>(`${base}/preview${date ? `?date=${date}` : ''}`, { signal: AbortSignal.timeout(90000) })); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'The report could not be verified.'); }
    finally { setPreviewBusy(false); }
  }
  return <div className="wf-page wf-niche-page">
    <PageHeading eyebrow="DAILY STORE REPORTS" title="Close the day with clarity." description="Check sales activity and send a daily summary to your chosen WhatsApp number."><Link href="/dashboard/integrations" className="wf-button wf-button-secondary">Store connections</Link></PageHeading>
    <LoadError error={error} retry={() => void refresh()} />
    {actionError && <div role="alert" className="wf-notice wf-notice-error">{actionError}</div>}
    {notice && <div role="status" className="wf-notice"><Check size={18} />{notice}</div>}
    <section className="wf-panel wf-niche-section"><h2><FileText size={20} /> Preview your store report</h2><p>Preview yesterday or choose a date. Previewing does not send a message. Reports currently support Shopify.</p>
      <div className="wf-settings-grid"><label className="wf-field-label">Report date (leave empty for yesterday)<input type="date" className="wf-field" value={date} onChange={e => setDate(e.target.value)} /></label><div><button className="wf-button wf-button-primary" disabled={previewBusy} onClick={() => void check()}>{previewBusy && <RefreshCw size={15} className="wf-spin" />}{previewBusy ? 'Reading your store…' : 'Preview report'}</button></div></div>
      {preview && <div className="wf-report-preview"><p className="wf-eyebrow">{preview.period}</p><div className="wf-niche-stats">{[['Orders', preview.orders], ['Units', preview.units], ['Awaiting fulfillment', preview.unfulfilledOrders]].map(([label, value]) => <div className="wf-panel" key={label}><p>{label}</p><strong>{value}</strong></div>)}</div>
        <h3>Order values</h3><p>Current order value, including unpaid orders: {preview.totals.map(t => `${t.orderValue} ${t.currency}`).join(' · ') || 'No included orders'}</p><p>Value on paid orders: {preview.totals.map(t => `${t.paidOrderValue} ${t.currency}`).join(' · ') || 'None'}</p><p>{preview.paidOrders} paid orders · {preview.unpaidOrders} in other payment states · {preview.cancelledOrders} cancelled orders excluded · {preview.testOrdersExcluded} test orders excluded</p>
        <h3>Top products by units</h3><ul>{preview.topProducts.map((item, index) => <li key={index}>{item.title} <strong>{item.units}</strong></li>)}</ul>{!preview.topProducts.length && <p>No products sold in included orders.</p>}<p className="wf-helper">{preview.definition}</p><p className="wf-helper">Checked {new Date(preview.checkedAt).toLocaleString()}</p>
      </div>}
    </section>
    <form onSubmit={save} className="wf-panel wf-niche-section"><h2><CalendarDays size={20} /> Daily WhatsApp delivery</h2><p>The previous completed day is reported using your business timezone. The recipient is the owner's WhatsApp number, separate from your connected business sender.</p>
      {!form ? <p>{loading ? 'Loading delivery settings…' : 'Refresh to load settings.'}</p> : <>
        <div className="wf-settings-grid"><label className="wf-field-label">Recipient WhatsApp number<input className="wf-field" type="tel" placeholder="+923001234567" value={form.recipient} onChange={e => edit({ recipient: e.target.value })} disabled={busy} /></label><label className="wf-field-label">Daily delivery time · {form.timezone}<input className="wf-field" type="time" value={form.deliveryTime} onChange={e => edit({ deliveryTime: e.target.value })} required disabled={busy} /></label></div>
        <details className="wf-report-template"><summary>WhatsApp template setup</summary><p>Use an approved utility template with these seven body parameters. Your platform admin can help with the one-time setup.</p><pre>{'Store report for {{1}}. Orders: {{2}}. Units: {{3}}. Current order value (includes unpaid orders): {{4}}. Value on paid orders: {{5}}. Awaiting fulfillment: {{6}}. Top products: {{7}}. Not accounting net sales or profit.'}</pre></details>
        <div className="wf-settings-grid"><label className="wf-field-label">Approved template name<input className="wf-field" value={form.templateName} onChange={e => edit({ templateName: e.target.value })} placeholder="store_daily_report" disabled={busy} /></label><label className="wf-field-label">Template language<input className="wf-field" value={form.templateLanguage} onChange={e => edit({ templateLanguage: e.target.value })} placeholder="en_US" disabled={busy} /></label></div>
        <div className="wf-automation-toggles"><label><input type="checkbox" checked={form.consent} onChange={e => edit({ consent: e.target.checked })} disabled={busy} />The recipient agrees to receive daily store reports.</label><label><input type="checkbox" checked={form.enabled} onChange={e => edit({ enabled: e.target.checked })} disabled={busy} />Enable scheduled daily reports</label></div>
        <button className="wf-button wf-button-primary" disabled={busy || !dirty}>{busy ? 'Verifying and saving…' : 'Save report settings'}</button>{form.enabled && form.nextRunAt && !dirty && <p className="wf-helper">Next scheduled report: {new Date(form.nextRunAt).toLocaleString(undefined, { timeZone: form.timezone })} ({form.timezone})</p>}
      </>}
    </form>
    <section className="wf-panel wf-niche-section"><h2>Report history</h2><p>Accepted means Meta accepted the message. Delivered requires a delivery receipt. Uncertain sends are held for review.</p><div className="wf-niche-records">{data?.reports.map(report => <article key={report.id}><div><strong>{report.reportDate}</strong>{report.error && <p>{report.error}</p>}</div><StatusBadge status={report.status} /></article>)}</div>{data && !data.reports.length && <p>Your scheduled reports will appear here.</p>}</section>
  </div>;
}
