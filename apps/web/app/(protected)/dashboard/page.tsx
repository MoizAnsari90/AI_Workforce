"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, ArrowUpRight, Bot, CheckCheck, CircleAlert, CircleCheck, Clock3, MessageCircle, MessageSquareText, Package, Pause, Play, Plug, Plus, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { WorkforceAssistant } from "@/components/workforce/assistant";
import { workforceRequest } from "@/lib/workforce-api";

interface Agent { id: string; name: string; department: string; isActive: boolean; _count: { tasks: number }; tasks: { title: string; status: string; createdAt: string }[] }
interface DashboardData {
  inventoryCount: number; lowStockAlerts: number; pendingApprovals: number; tasksCompleted: number;
  aiRepliesPer100Inbound: number | null; agents: Agent[];
  businessProfile: { profile: { industry?: string } } | null; checkedAt: string;
  recentActivity: { id: string; operation: string; entityType: string; createdAt: string }[];
}
function readable(value: string) { return value.replace(/[_-]/g, " ").toLowerCase().replace(/^\w/, letter => letter.toUpperCase()); }
function greetingName(value: string) { return value.trim().split(/[\s._-]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1).toLowerCase()).join("") || "there"; }

export default function DashboardPage() {
  const router = useRouter();
  const { user, tenant } = useAuth();
  const tenantId = user?.tenantId || tenant?.id;
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [agentBusy, setAgentBusy] = useState<string | null>(null);
  const [greeting, setGreeting] = useState("Welcome back");
  const [dateLabel, setDateLabel] = useState("");
  const [onboardingCheck, setOnboardingCheck] = useState(true);
  const request = useRef<AbortController | null>(null);
  const toggleRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!tenantId) return;
    if (silent && request.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!silent) setLoading(true);
    setError("");
    try { const result = await workforceRequest<DashboardData>(`/api/proxy/tenants/${tenantId}/operations/dashboard`, { signal: controller.signal }); if (!controller.signal.aborted) setData(result); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn't load your workspace."); }
    finally { if (!controller.signal.aborted) setLoading(false); if (request.current === controller) request.current = null; }
  }, [tenantId]);

  useEffect(() => {
    setData(null); setActionError(""); setAgentBusy(null); void refresh();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 30_000);
    return () => { request.current?.abort(); toggleRequest.current?.abort(); window.clearInterval(poll); };
  }, [refresh]);
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    workforceRequest<{ needsOnboarding: boolean; nextStep: string }>(`/api/proxy/tenants/${tenantId}/onboarding-status`)
      .then(status => { if (!cancelled && status.needsOnboarding) router.replace('/dashboard/onboarding'); })
      .catch(() => { /* A status-check outage must not lock an existing customer out. */ })
      .finally(() => { if (!cancelled) setOnboardingCheck(false); });
    return () => { cancelled = true; };
  }, [tenantId, router]);
  useEffect(() => {
    const update = () => { const now = new Date(); setGreeting(now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening"); setDateLabel(now.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })); };
    update(); const interval = window.setInterval(update, 60_000); return () => window.clearInterval(interval);
  }, []);

  async function toggleAgent(agent: Agent) {
    if (!tenantId || agentBusy) return;
    const controller = new AbortController(); toggleRequest.current = controller;
    setAgentBusy(agent.id); setActionError("");
    try { await workforceRequest(`/api/proxy/tenants/${tenantId}/agents/${agent.id}/toggle`, { method: "PATCH", signal: controller.signal }); await refresh(); }
    catch (error) { if (!controller.signal.aborted) setActionError(error instanceof Error ? error.message : "Couldn't update the agent."); }
    finally { if (!controller.signal.aborted) setAgentBusy(null); }
  }

  const stats = [
    { label: "Tasks completed", value: data?.tasksCompleted, description: "Completed by your AI team", icon: CheckCheck, tone: "mint" },
    { label: "AI replies / 100 inbound", value: data?.aiRepliesPer100Inbound, description: "Outbound replies, not unique customers", icon: MessageSquareText, tone: "blue" },
    { label: "Pending approvals", value: data?.pendingApprovals, description: data ? data.pendingApprovals ? "Ready for your review" : "No requests waiting" : "Requests awaiting review", icon: Clock3, tone: "amber" },
    { label: "Inventory records", value: data?.inventoryCount, description: "Saved in this workspace", icon: Package, tone: "violet" },
  ];
  const activeCount = data?.agents.filter(agent => agent.isActive).length ?? 0;

  if (onboardingCheck) return <div className="wf-page" aria-busy="true"><section className="wf-panel"><div className="wf-empty-compact"><RefreshCw size={24} className="wf-spin" /><p>Preparing your workspace…</p></div></section></div>;
  return <div className="wf-page wf-dashboard-home">
    <div className="wf-page-heading"><div><p className="wf-eyebrow">YOUR BUSINESS, IN FOCUS</p><h1>{greeting}, <span>{greetingName(tenant?.name || user?.email?.split("@")[0] || "there")}.</span></h1><p>Here's what's happening with your workforce.</p></div><div className="wf-heading-actions"><span className="wf-date">{dateLabel}</span><button onClick={() => void refresh()} className="wf-button wf-button-secondary" disabled={loading || !tenantId}><RefreshCw size={15} className={loading ? "wf-spin" : ""} />{loading ? "Refreshing" : "Refresh"}</button></div></div>
    {error && <div className="wf-notice wf-notice-error" role="alert"><CircleAlert size={17} /><span>{error} {data ? "Showing the last loaded figures." : "Your figures will appear when the connection is restored."}</span><button onClick={() => void refresh()} disabled={loading} className="wf-text-button">Retry</button></div>}
    <div className="wf-section-meta"><span><Activity size={13} /> Workspace snapshot</span><span>All-time counts · Current pending items</span></div>
    <div className="wf-stats" aria-busy={loading}>{stats.map(({ label, value, description, icon: Icon, tone }) => <section key={label} className="wf-stat"><div className="wf-stat-top"><span>{label}</span><span className={`wf-stat-icon wf-tone-${tone}`}><Icon size={17} strokeWidth={1.7} /></span></div><div className="wf-stat-value">{loading && !data ? <span className="wf-skeleton" /> : value == null ? "—" : value.toLocaleString()}</div><p>{description}</p></section>)}</div>
    <div className="wf-dashboard-grid">
      <WorkforceAssistant key={tenantId} tenantId={tenantId} agents={data?.agents || []} bundleIndustry={data?.businessProfile?.profile?.industry} checkedAt={data?.checkedAt} />
      <div className="wf-dashboard-rail">
        <section className="wf-panel wf-attention"><div className="wf-panel-heading"><h2>Needs your attention</h2><span className="wf-panel-icon"><ShieldCheck size={18} /></span></div>
          {!data ? <div className="wf-empty-compact"><Clock3 size={25} /><p>{loading ? "Checking your workspace..." : "Attention items couldn't be loaded."}</p></div> : <>
            <div className={`wf-attention-summary ${data.pendingApprovals || data.lowStockAlerts ? "has-items" : ""}`}>{data.pendingApprovals || data.lowStockAlerts ? <CircleAlert size={29} strokeWidth={1.5} /> : <CircleCheck size={29} strokeWidth={1.5} />}<strong>{data.pendingApprovals || data.lowStockAlerts ? "A few things to check" : "You're all caught up"}</strong><p>{data.pendingApprovals || data.lowStockAlerts ? "Keep your business moving with a quick review." : "No pending approvals or open stock alerts."}</p></div>
            <Link href="/dashboard/approvals" className="wf-attention-row"><span>Approval requests</span><strong>{data.pendingApprovals}</strong><ArrowUpRight size={15} /></Link>
            <a href="#assistant" className="wf-attention-row"><span>Open stock alerts</span><strong>{data.lowStockAlerts}</strong><ArrowUpRight size={15} /></a>
          </>}
        </section>
        <Link href="/dashboard/integrations" className="wf-connect-callout"><span className="wf-callout-icon"><Plug size={22} strokeWidth={1.6} /></span><span><strong>Bring your tools together.</strong><p>Connect your store and give your AI more context.</p><span className="wf-callout-link">Explore integrations <ArrowRight size={14} /></span></span></Link>
      </div>
    </div>
    <div className="wf-bottom-grid">
      <section className="wf-panel"><div className="wf-panel-heading"><div><h2>Your AI team <span className="wf-count">{data?.agents.length ?? "—"}</span></h2><p>{data ? `${activeCount} active in this view · You're in control` : "Your deployed workforce"}</p></div><Link className="wf-text-button" href="/dashboard/templates"><Plus size={15} /> Add agent</Link></div>
        {actionError && <div className="wf-inline-error" role="alert">{actionError}</div>}
        <div className="wf-agent-list">{!data ? <div className="wf-empty-compact"><Bot size={28} /><p>{loading ? "Loading your AI team..." : "Your team couldn't be loaded."}</p></div> : data.agents.length ? data.agents.map(agent => <div className="wf-agent" key={agent.id}><span className={`wf-agent-avatar ${agent.isActive ? "" : "is-paused"}`}><Bot size={20} strokeWidth={1.7} /></span><div className="wf-agent-copy"><strong title={agent.name}>{agent.name}</strong><span>{readable(agent.department)} <span className={`wf-inline-status ${agent.isActive ? "is-on" : ""}`}>{agent.isActive ? "Active" : "Paused"}</span></span></div><button className="wf-agent-control" disabled={agentBusy !== null} onClick={() => void toggleAgent(agent)} aria-label={`${agent.isActive ? "Pause" : "Resume"} ${agent.name}`} title={agent.isActive ? "Pause agent" : "Resume agent"}>{agentBusy === agent.id ? <RefreshCw size={15} className="wf-spin" /> : agent.isActive ? <Pause size={15} /> : <Play size={15} />}</button></div>) : <div className="wf-empty-compact"><Bot size={29} /><strong>Your first teammate is one click away.</strong><p>Choose a template to start building your AI team.</p><Link href="/dashboard/templates" className="wf-text-button">Browse templates <ArrowRight size={14} /></Link></div>}</div>
      </section>
      <section className="wf-panel"><div className="wf-panel-heading"><div><h2>Recent activity</h2><p>The latest from your workspace</p></div><Activity size={18} className="wf-muted" /></div><div className="wf-activity-list">{!data ? <div className="wf-empty-compact"><Clock3 size={26} /><p>{loading ? "Loading recent activity..." : "Activity couldn't be loaded."}</p></div> : data.recentActivity.length ? data.recentActivity.map(item => <div className="wf-activity" key={item.id}><span className="wf-activity-dot" /><div><strong>{readable(item.operation)}</strong><span>{readable(item.entityType)}</span></div><time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{new Date(item.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time></div>) : <div className="wf-empty-compact"><Activity size={28} /><strong>A fresh start.</strong><p>Your team's activity will appear here as you work.</p></div>}</div></section>
    </div>
    <div className="wf-quick-links"><span>MAKE IT YOURS</span><Link href="/dashboard/integrations"><Plug size={16} /> Connect a store <ArrowUpRight size={14} /></Link><Link href="/dashboard/settings/whatsapp"><MessageCircle size={16} /> Set up WhatsApp <ArrowUpRight size={14} /></Link><Link href="/dashboard/templates"><Sparkles size={16} /> Explore AI templates <ArrowUpRight size={14} /></Link></div>
  </div>;
}
