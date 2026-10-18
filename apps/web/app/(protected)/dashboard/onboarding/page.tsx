"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, Building2, Check, HeartPulse, LoaderCircle, ShoppingBag, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { workforceRequest } from "@/lib/workforce-api";

type Template = { id: string; name: string; category: string; description: string };
type SetupStatus = { nextStep: string; readyToActivate: boolean; industry: string | null; bundleCount: number; agents: { id: string; name: string; department: string; isActive: boolean }[]; steps: { id: string; title: string; description: string; state: string; href: string }[] };
const choices = [
  { id: "ecommerce", title: "E-commerce", detail: "Store operations, inventory and customer support", icon: ShoppingBag, needs: "Shopify or WooCommerce; WhatsApp can be connected later" },
  { id: "real_estate", title: "Real estate", detail: "Qualify property leads and coordinate viewings", icon: Building2, needs: "Business profile, writable calendar, viewing agent and property" },
  { id: "healthcare", title: "Clinic / healthcare", detail: "Handle patient inquiries and appointment requests", icon: HeartPulse, needs: "Business profile, writable calendar, doctor and service" },
];

export default function OnboardingPage() {
  const { t } = useTranslation();
  const { user } = useAuth(); const router = useRouter(); const tenantId = user?.tenantId;
  const [templates, setTemplates] = useState<Template[]>([]); const [status, setStatus] = useState<SetupStatus | null>(null);
  const [selected, setSelected] = useState(""); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) return;
      const readiness = await workforceRequest<SetupStatus>(`/api/proxy/tenants/${tenantId}/onboarding-status`);
      if (cancelled) return;
      setStatus(readiness);
      if (readiness.nextStep === 'ready') { router.replace('/dashboard'); return; }
      if (readiness.nextStep === 'choose_bundle') setTemplates(await workforceRequest<Template[]>("/api/proxy/templates"));
    })().catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Setup information could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, router]);
  const choice = choices.find(item => item.id === selected);
  const template = useMemo(() => templates.find(item => item.category.toLowerCase() === selected), [templates, selected]);

  async function continueSetup() {
    if (!tenantId || !template || busy) return;
    setBusy(true); setError("");
    try {
      await workforceRequest(`/api/proxy/tenants/${tenantId}/templates/deploy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: template.id, activate: false }) });
      router.replace(`/dashboard/settings/business?onboarding=1&industry=${selected}`);
    } catch (err) { setError(err instanceof Error ? err.message : "The bundle could not be added."); setBusy(false); }
  }

  return <div className="wf-page wf-onboarding-page">
    <div className="wf-onboarding-heading"><p className="wf-eyebrow">{t("WELCOME TO AI WORKFORCE")}</p><h1>{t("Set up your workspace.")}</h1><p>{t("Choose a business bundle, connect the services it needs and activate it when its required checks pass.")}</p></div>
    <div className="wf-onboarding-progress" aria-label={t("Setup progress")}><span className="is-current"><b>01</b>  {t("Choose a bundle")}</span><i /><span><b>02</b>  {t("Business details")}</span><i /><span><b>03</b>  {t("Connect & configure")}</span></div>
    {error && <div className="wf-notice wf-notice-error" role="alert">{t(error)}</div>}
    {loading ? <section className="wf-panel"><div className="wf-empty-compact"><LoaderCircle size={24} className="wf-spin" /><p>{t("Loading your setup...")}</p></div></section> : status && status.nextStep !== 'choose_bundle' ? <SetupChecklist status={status} tenantId={tenantId || ''} onActivated={() => router.replace('/dashboard')} /> : <div className="wf-onboarding-choices">{choices.map(item => { const Icon = item.icon; const active = selected === item.id; return <button type="button" key={item.id} className={`wf-panel wf-onboarding-choice ${active ? "is-selected" : ""}`} aria-label={`Choose ${t(item.title)} bundle`} aria-pressed={active} onClick={() => setSelected(item.id)}><span className="wf-onboarding-choice-icon"><Icon size={24} /></span><span className="wf-onboarding-choice-copy"><strong>{t(item.title)}</strong><small>{t(item.detail)}</small><small><b>{t("Required setup:")}</b> {t(item.needs)}</small></span><span className="wf-onboarding-choice-status">{active ? <><Check size={14} />  {t("Selected")}</> : t("Choose")}</span></button>; })}</div>}
    {choice && !status?.bundleCount && <section className="wf-panel wf-onboarding-review"><div><span className="wf-feature-icon"><Bot size={24} /></span><div><p className="wf-eyebrow">{t("YOUR FIRST AI BUNDLE")}</p><h2>{template?.name || t("{bundle} bundle", { bundle: t(choice.title) })}</h2><p>{template?.description || t(choice.detail)}</p></div></div><div className="wf-onboarding-note"><Sparkles size={17} /><span>{t("Your agent starts")} <strong>{t("paused")}</strong>{t(". The setup checklist will tell you what to connect before it can be activated.")}</span></div><button className="wf-button wf-button-primary" disabled={!template || busy} onClick={() => void continueSetup()}>{busy ? <><LoaderCircle size={16} className="wf-spin" />  {t("Setting up...")}</> : <>{t("Choose this bundle")} <ArrowRight size={16} /></>}</button></section>}
    <p className="wf-page-footnote">{t("You can add more agents later. Each workspace keeps its own business data and connections.")}</p>
  </div>;
}

function SetupChecklist({ status, tenantId, onActivated }: { status: SetupStatus; tenantId: string; onActivated: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const paused = status.agents.find(agent => !agent.isActive && (status.industry === 'healthcare' ? /health|clinic|reception/i.test(`${agent.department} ${agent.name}`) : status.industry === 'real_estate' ? /sales|real estate|property/i.test(`${agent.department} ${agent.name}`) : /operations|e-?commerce/i.test(`${agent.department} ${agent.name}`)));
  async function activate() {
    if (!paused || busy) return; setBusy(true); setError('');
    try { await workforceRequest(`/api/proxy/tenants/${tenantId}/agents/${paused.id}/toggle`, { method: 'PATCH' }); onActivated(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Finish the required setup steps before activating.'); setBusy(false); }
  }
  const complete = status.steps.filter(step => step.state === 'complete').length;
  const required = status.steps.filter(step => step.state === 'required');
  return <section className="wf-panel wf-onboarding-review wf-checklist">
    <div><span className="wf-feature-icon"><Check size={23} /></span><div><p className="wf-eyebrow">{t("SETUP CHECKLIST ·")} {complete}/{complete + required.length}  {t("REQUIRED STEPS")}</p><h2>{t("Get your")} {t(status.industry === "healthcare" ? "Clinic reception" : status.industry === "real_estate" ? "Real estate" : "E-commerce")}  {t("workforce ready.")}</h2><p>{t("Complete required items. Optional channels can be connected later.")}</p></div></div>
    {error && <div className="wf-notice wf-notice-error" role="alert">{t(error)}</div>}
    <div className="wf-checklist-items">{status.steps.map((step, index) => <article className="wf-checklist-item" key={step.id}><span className={`wf-checklist-marker is-${step.state}`}>{step.state === 'complete' ? <Check size={15} /> : String(index + 1).padStart(2, '0')}</span><div><strong>{t(step.title)}</strong><p>{t(step.description)}</p><span className={`wf-badge ${step.state === 'complete' ? 'wf-badge-mint' : step.state === 'required' ? 'wf-badge-amber' : ''}`}>{step.state === 'needs_test' ? t("Test required") : step.state === 'optional' ? t("Optional") : t(step.state === "complete" ? "Completed" : "Setup required")}</span></div>{step.state !== 'complete' && <a className="wf-text-button" href={step.href}>{step.state === 'required' ? t("Complete step") : t("Set up channel")} <ArrowRight size={14} /></a>}</article>)}</div>
    {status.readyToActivate ? paused ? <button className="wf-button wf-button-primary" disabled={busy} onClick={() => void activate()}>{busy ? <><LoaderCircle size={16} className="wf-spin" />  {t("Checking setup...")}</> : <>{t("Activate your AI bundle")} <ArrowRight size={16} /></>}</button> : <p className="wf-notice">{t("Required setup is complete. Your AI bundle is already active.")}</p> : <p className="wf-onboarding-note"><Sparkles size={17} /><span>{t("Your bundle stays paused until the required business, connection and workflow data checks pass.")}</span></p>}
    {status.steps.some(step => step.id === 'whatsapp' && step.state === 'needs_test') && <p className="wf-helper">{t("WhatsApp replies remain paused until its real two-way delivery test succeeds.")}</p>}
  </section>;
}
