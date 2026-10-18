"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useRef, useState } from "react";
import { Check, ChevronDown, Clock3, History, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { workforceRequest } from "@/lib/workforce-api";
import { EmptyState, LoadError, PageHeading, readable, RefreshButton, StatusBadge, useWorkspaceResource } from "@/components/workforce/page-kit";

interface Approval { id: string; actionType: string; actionPayload: unknown; status: string; createdAt: string; rejectionReason?: string }

export default function ApprovalsPage() {
  const { t, locale } = useTranslation();
  const { user, tenant } = useAuth();
  const tenantId = user?.tenantId || tenant?.id;
  const { data, loading, error, refresh } = useWorkspaceResource<Approval[]>(tenantId ? `/api/proxy/tenants/${tenantId}/approval-requests` : undefined, 5000);
  const [view, setView] = useState("pending");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const pending = data?.filter(item => item.status === "pending") || [];
  const history = data?.filter(item => item.status !== "pending") || [];
  const items = view === "pending" ? pending : history;
  async function review(item: Approval, decision: "approved" | "rejected") {
    if (!tenantId || user?.role !== "admin" || lock.current) return;
    lock.current = true; setBusy(item.id); setNotice(null);
    try {
      await workforceRequest(`/api/proxy/tenants/${tenantId}/approval-requests/${item.id}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ...(decision === "rejected" ? { rejectionReason: reasons[item.id]?.trim() || "Rejected by administrator" } : {}) }),
      });
      setNotice({ text: decision === "approved" ? "Action approved. Check workspace activity for execution updates." : "Action rejected." });
      await refresh();
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "Couldn't review this request.", error: true }); }
    finally { lock.current = false; setBusy(null); }
  }
  return <div className="wf-page">
    <PageHeading eyebrow={t("YOU MAKE THE CALL")} title={t("Your approval desk.")} description={t("Review proposed actions before your workforce takes the next step.")}><RefreshButton loading={loading} onClick={() => void refresh()} /></PageHeading>
    <div className="wf-feature-banner"><span className="wf-feature-icon"><ShieldCheck size={27} /></span><div><h2>{t("AI does the groundwork. You stay in control.")}</h2><p>{t("Review the action details, then approve execution or reject with a reason.")}</p></div><span className="wf-badge wf-badge-amber">{data ? `${pending.length} pending` : t("Checking queue")}</span></div>
    <LoadError error={error} retry={() => void refresh()} />
    {notice && <div className={`wf-notice ${notice.error ? "wf-notice-error" : ""}`} role={notice.error ? "alert" : "status"}>{t(notice.text)}</div>}
    <div className="wf-toolbar"><div className="wf-tabs" aria-label={t("Approval views")}><button aria-pressed={view === "pending"} onClick={() => setView("pending")}><Clock3 size={15} />{t("Pending review")} <span>{data ? pending.length : "—"}</span></button><button aria-pressed={view === "history"} onClick={() => setView("history")}><History size={15} />{t("History")} <span>{data ? history.length : "—"}</span></button></div><span className="wf-helper">{t("Refreshes every 5 seconds")}</span></div>
    {!data ? <section className="wf-panel"><EmptyState icon={<Clock3 size={27} />} title={loading ? t("Loading your queue…") : t("Queue unavailable")} description={loading ? t("Checking the latest requests in this workspace.") : t("Use Retry above to load your approval requests.")} /></section> : !items.length ? <section className="wf-panel"><EmptyState icon={<ShieldCheck size={30} />} title={view === "pending" ? t("You're all caught up.") : t("A clear record, from the start.")} description={view === "pending" ? t("There are no requests waiting for your approval.") : t("Reviewed actions will appear here with their decision and details.")} /></section> : <div className="wf-review-list">{items.map(item => <article className="wf-panel wf-review-card" key={item.id}>
      <div className="wf-record-heading"><span className={`wf-record-icon ${item.status === "pending" ? "wf-tone-amber" : "wf-tone-mint"}`}><ShieldCheck size={21} /></span><div><h2>{t(readable(item.actionType))}</h2><p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(locale)}</time></p></div><StatusBadge status={item.status} /></div>
      <div className="wf-review-body"><p className="wf-small-label">{t("ACTION DETAILS")}</p><dl className="wf-detail-grid">{Object.entries(item.actionPayload && typeof item.actionPayload === "object" && !Array.isArray(item.actionPayload) ? item.actionPayload : { Details: item.actionPayload }).map(([key, value]) => <div key={key}><dt>{t(readable(key))}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "Not provided")}</dd></div>)}</dl>
        <details className="wf-technical-details"><summary>{t("Request details")} <ChevronDown size={14} /></summary><p>{t("Request ID:")} {item.id}</p><pre>{JSON.stringify(item.actionPayload, null, 2)}</pre></details>
        {item.rejectionReason && <p className="wf-rejection-note">{t("Rejection reason:")} {item.rejectionReason}</p>}
      </div>
      {item.status === "pending" && (user?.role === "admin" ? <div className="wf-review-actions"><label><span className="wf-field-label">{t("Rejection reason")} <span className="wf-helper">{t("(optional)")}</span></span><input className="wf-field" placeholder={t("Explain why this action should not run")} value={reasons[item.id] || ""} onChange={event => setReasons(current => ({ ...current, [item.id]: event.target.value }))} /></label><div><button className="wf-button wf-button-danger" disabled={busy !== null} onClick={() => void review(item, "rejected")}><X size={15} />{t("Reject")}</button><button className="wf-button wf-button-primary" disabled={busy !== null} onClick={() => void review(item, "approved")}><Check size={15} />{busy === item.id ? t("Submitting…") : t("Approve & execute")}</button></div></div> : <p className="wf-review-readonly">{t("A workspace admin can approve or reject this action.")}</p>)}
    </article>)}</div>}
  </div>;
}
