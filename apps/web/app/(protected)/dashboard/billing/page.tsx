"use client";
import { useTranslation } from "@/contexts/LanguageContext";
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext.hooks';
import { workforceRequest } from '@/lib/workforce-api';
import { PageHeading, useWorkspaceResource } from '@/components/workforce/page-kit';
type Billing = { mode: string; status: string; planId?: string; periodEnd?: string; cancelAtPeriodEnd?: boolean; availableCredits?: number; canManage?: boolean; hasSubscription?: boolean; plans: Array<{ id: string; name: string; amount: number; currency: string; monthlyCredits: number; maxAgents: number }> };
export default function BillingPage() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const base = user?.tenantId && user.role === 'admin' ? `/api/proxy/tenants/${user.tenantId}/billing` : undefined;
  const { data, loading, error, refresh } = useWorkspaceResource<Billing>(base, 30000);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  async function redirect(path: string, planId?: string) {
    if (!base || busy) return; setBusy(true); setActionError('');
    try { const result = await workforceRequest<{ url: string }>(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(planId ? { planId } : {}) }); window.location.assign(result.url); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Billing could not be opened.'); setBusy(false); }
  }
  return <><PageHeading eyebrow={t("YOUR PLAN")} title={t("Billing & subscription")} description={t("Choose a plan or manage payments and cancellation securely.")} />
    {user?.role !== 'admin' ? <p>{t("Ask your workspace admin to manage billing.")}</p> : <>
      {(error || actionError) && <p role="alert" className="wf-inline-error">{t(error || actionError)}</p>}
      <button className="wf-button wf-button-secondary wf-billing-refresh" disabled={loading || busy} onClick={() => void refresh()}>{t("Refresh payment status")}</button>
      {loading && <p>{t("Checking your subscription…")}</p>}
      {data && <section className="wf-panel wf-niche-section"><h2>{data.mode === 'disabled' ? t("Plans are not available yet") : `Subscription: ${data.status.replaceAll('_', ' ')}`}</h2>
        {data.mode === 'disabled' ? <p>{t("Your platform administrator needs to configure billing before a plan can be purchased.")}</p> : <>
          {data.mode === 'test' && <p className="wf-helper">{t("Test checkout: use payment-provider test details only. This environment does not collect live payments.")}</p>}
          <p>{t("Plan:")} {data.planId || t("None")}  {t("· Available workflow credits:")} {data.availableCredits ?? 0}</p>
          {data.periodEnd && <p>{data.cancelAtPeriodEnd ? t("Cancels at the end of the period:") : t("Current period ends:")}{new Date(data.periodEnd).toLocaleDateString(locale)}</p>}
          <p>{t("Payment status updates automatically after confirmation. Plan changes and cancellation are available in Manage subscription.")}</p>
          {data.canManage && <button disabled={busy} className="wf-button wf-button-secondary" onClick={() => void redirect('portal')}>{t("Manage subscription, invoices & payment method")}</button>}
          <div className="wf-settings-grid">{data.plans.map(plan => <article className="wf-panel wf-niche-section" key={plan.id}><h3>{plan.name}</h3><p>{new Intl.NumberFormat(locale, { style: 'currency', currency: plan.currency }).format(plan.amount / (10 ** (new Intl.NumberFormat('en', { style: 'currency', currency: plan.currency }).resolvedOptions().maximumFractionDigits ?? 2)))}  {t("/ month")}</p><p>{t("Up to")} {plan.maxAgents}  {t("agents ·")} {plan.monthlyCredits}  {t("included workforce questions per billing month (1 credit each)")}</p><button disabled={busy || data.hasSubscription} className="wf-button wf-button-primary" onClick={() => void redirect('checkout', plan.id)}>{data.hasSubscription ? t("Manage your current plan above") : t("Continue to secure checkout")}</button></article>)}</div>
        </>}
      </section>}
    </>}
  </>;
}
