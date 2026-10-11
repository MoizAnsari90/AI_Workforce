"use client";
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext.hooks';
import { workforceRequest } from '@/lib/workforce-api';
import { PageHeading, useWorkspaceResource } from '@/components/workforce/page-kit';
type Billing = { mode: string; status: string; planId?: string; periodEnd?: string; cancelAtPeriodEnd?: boolean; availableCredits?: number; canManage?: boolean; hasSubscription?: boolean; plans: Array<{ id: string; name: string; amount: number; currency: string; monthlyCredits: number; maxAgents: number }> };
export default function BillingPage() {
  const { user } = useAuth();
  const base = user?.tenantId && user.role === 'admin' ? `/api/proxy/tenants/${user.tenantId}/billing` : undefined;
  const { data, loading, error, refresh } = useWorkspaceResource<Billing>(base, 30000);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  async function redirect(path: string, planId?: string) {
    if (!base || busy) return; setBusy(true); setActionError('');
    try { const result = await workforceRequest<{ url: string }>(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(planId ? { planId } : {}) }); window.location.assign(result.url); }
    catch (e) { setActionError(e instanceof Error ? e.message : 'Billing could not be opened.'); setBusy(false); }
  }
  return <><PageHeading eyebrow="YOUR PLAN" title="Billing & subscription" description="Choose a plan or manage payments and cancellation securely." />
    {user?.role !== 'admin' ? <p>Ask your workspace admin to manage billing.</p> : <>
      {(error || actionError) && <p role="alert" className="wf-inline-error">{error || actionError}</p>}
      <button className="wf-button wf-button-secondary" disabled={loading || busy} onClick={() => void refresh()}>Refresh payment status</button>
      {loading && <p>Checking your subscription…</p>}
      {data && <section className="wf-panel wf-niche-section"><h2>{data.mode === 'disabled' ? 'Plans are not available yet' : `Subscription: ${data.status.replaceAll('_', ' ')}`}</h2>
        {data.mode === 'disabled' ? <p>Your platform administrator needs to configure billing before a plan can be purchased.</p> : <>
          {data.mode === 'test' && <p className="wf-helper">Test checkout: use payment-provider test details only. This environment does not collect live payments.</p>}
          <p>Plan: {data.planId || 'None'} · Available workflow credits: {data.availableCredits ?? 0}</p>
          {data.periodEnd && <p>{data.cancelAtPeriodEnd ? 'Cancels at the end of the period: ' : 'Current period ends: '}{new Date(data.periodEnd).toLocaleDateString()}</p>}
          <p>Payment status updates automatically after confirmation. Plan changes and cancellation are available in Manage subscription.</p>
          {data.canManage && <button disabled={busy} className="wf-button wf-button-secondary" onClick={() => void redirect('portal')}>Manage subscription, invoices & payment method</button>}
          <div className="wf-settings-grid">{data.plans.map(plan => <article className="wf-panel wf-niche-section" key={plan.id}><h3>{plan.name}</h3><p>{new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(plan.amount / (10 ** (new Intl.NumberFormat('en', { style: 'currency', currency: plan.currency }).resolvedOptions().maximumFractionDigits ?? 2)))} / month</p><p>Up to {plan.maxAgents} agents · {plan.monthlyCredits} included workforce questions per billing month (1 credit each)</p><button disabled={busy || data.hasSubscription} className="wf-button wf-button-primary" onClick={() => void redirect('checkout', plan.id)}>{data.hasSubscription ? 'Manage your current plan above' : 'Continue to secure checkout'}</button></article>)}</div>
        </>}
      </section>}
    </>}
  </>;
}
