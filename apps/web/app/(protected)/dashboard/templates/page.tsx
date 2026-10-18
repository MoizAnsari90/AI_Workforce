"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Building2, Check, HeartPulse, Layers3, Plus, ShoppingBag, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { workforceRequest } from "@/lib/workforce-api";
import { EmptyState, LoadError, PageHeading, readable, RefreshButton, SearchField, useWorkspaceResource } from "@/components/workforce/page-kit";

interface Template { id: string; name: string; category: string; description: string; definition?: { nodes?: { type: string; agentName?: string; tool?: string; source?: string; provider?: string }[] } }

export default function TemplatesPage() {
  const { t } = useTranslation();
  const { user, tenant } = useAuth();
  const tenantId = user?.tenantId || tenant?.id;
  const { data, error, loading, refresh } = useWorkspaceResource<Template[]>("/api/proxy/templates");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [deployed, setDeployed] = useState<string[]>([]);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const lock = useRef(false);
  const categories = [...new Set(data?.map(item => item.category.toLowerCase()) || [])];
  const shown = data?.filter(item => (category === "all" || item.category.toLowerCase() === category) && `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())) || [];
  async function deploy(template: Template) {
    if (!tenantId || lock.current) return;
    lock.current = true; setBusy(template.id); setNotice(null);
    try {
      const result = await workforceRequest<{ templateName: string }>(`/api/proxy/tenants/${tenantId}/templates/deploy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ templateId: template.id }) });
      setDeployed(current => [...current, template.id]); setNotice({ text: `${result.templateName} added to your workspace. Connect the required services before using its workflow.` });
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "Couldn't deploy this template.", error: true }); }
    finally { lock.current = false; setBusy(null); }
  }
  return <div className="wf-page">
    <PageHeading eyebrow={t("BUILD YOUR AI TEAM")} title={t("A head start for better work.")} description={t("Choose a workflow template built around the work your business does.")}><RefreshButton loading={loading} onClick={() => void refresh()} /></PageHeading>
    <div className="wf-feature-banner"><span className="wf-feature-icon"><Layers3 size={27} /></span><div><h2>{t("Start with a template. Make it your workforce.")}</h2><p>{t("Each deployment adds a workflow and an agent to this workspace.")}</p></div><Link className="wf-text-button" href="/dashboard/integrations">{t("Manage connections")} <ArrowRight size={15} /></Link></div>
    <LoadError error={error} retry={() => void refresh()} />
    {notice && <div className={`wf-notice ${notice.error ? "wf-notice-error" : ""}`} role={notice.error ? "alert" : "status"}><span>{t(notice.text)}</span>{!notice.error && <Link className="wf-text-button" href="/dashboard">{t("View team")} <ArrowRight size={14} /></Link>}</div>}
    <div className="wf-toolbar"><div className="wf-tabs" aria-label={t("Template category")}><button aria-pressed={category === "all"} onClick={() => setCategory("all")}>{t("All templates")}</button>{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{t(readable(item))}</button>)}</div><SearchField value={query} onChange={setQuery} placeholder={t("Search templates")} /></div>
    {!data ? <section className="wf-panel"><EmptyState icon={<Layers3 size={28} />} title={loading ? t("Finding your next teammate…") : t("Templates unavailable")} description={loading ? t("Loading available workflows.") : t("Retry to load the template library.")} /></section> : !shown.length ? <section className="wf-panel"><EmptyState icon={<Sparkles size={28} />} title={t("No templates found.")} description={t("Try another search or category.")} /></section> : <div className="wf-template-grid">{shown.map((item, index) => {
      const Icon = item.category.toLowerCase() === "ecommerce" ? ShoppingBag : item.category.toLowerCase() === "healthcare" ? HeartPulse : Building2;
      const nodes = Array.isArray(item.definition?.nodes) ? item.definition.nodes : [];
      return <article key={item.id} className={`wf-panel wf-template-card wf-template-tone-${index % 3}`}><div className="wf-template-art" aria-hidden="true"><span /><span /><div><Icon size={36} strokeWidth={1.4} /></div><Bot size={23} /></div><div className="wf-template-body"><span className="wf-badge">{t(readable(item.category.toLowerCase()))}</span><h2>{item.name}</h2><p>{item.description}</p><div className="wf-workflow-steps"><p className="wf-small-label">{t("INCLUDED WORKFLOW")}</p>{nodes.map((node, i) => <div key={i}><span>{String(i + 1).padStart(2, "0")}</span><p>{t(readable(node.agentName || node.tool || node.source || node.provider || node.type))}</p></div>)}</div><button className={`wf-button wf-button-full ${deployed.includes(item.id) ? "wf-button-secondary" : "wf-button-primary"}`} disabled={!tenantId || busy !== null || deployed.includes(item.id)} onClick={() => void deploy(item)}>{deployed.includes(item.id) ? <Check size={16} /> : <Plus size={16} />}{busy === item.id ? t("Adding to workspace…") : deployed.includes(item.id) ? t("Added to this workspace") : t("Add to workspace")}</button></div></article>;
    })}</div>}
    <p className="wf-page-footnote">{t("Templates provide a starting workflow. Store, messaging and voice services need their own connections.")}</p>
  </div>;
}
