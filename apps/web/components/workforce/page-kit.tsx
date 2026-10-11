"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, RefreshCw, Search } from "lucide-react";
import { workforceRequest } from "@/lib/workforce-api";

export function useWorkspaceResource<T>(url: string | undefined, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!url) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true);
    try { const result = await workforceRequest<T>(url, { signal: controller.signal }); if (!controller.signal.aborted) { setData(result); setError(""); } }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Couldn't load this page."); }
    finally { if (!controller.signal.aborted) setLoading(false); if (request.current === controller) request.current = null; }
  }, [url]);
  useEffect(() => {
    setData(null); setError(""); setLoading(Boolean(url)); void refresh();
    const timer = pollMs ? window.setInterval(() => { if (document.visibilityState === "visible" && !request.current) void refresh(); }, pollMs) : undefined;
    return () => { request.current?.abort(); if (timer) window.clearInterval(timer); };
  }, [refresh, pollMs, url]);
  return { data, loading, error, refresh };
}

export function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="wf-page-heading"><div><p className="wf-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{children}</div>;
}
export function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return <button className="wf-button wf-button-secondary" disabled={loading} onClick={onClick}><RefreshCw size={15} className={loading ? "wf-spin" : ""} />Refresh</button>;
}
export function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return error ? <div className="wf-notice wf-notice-error" role="alert"><CircleAlert size={18} /><span>{error}</span><button className="wf-text-button" onClick={retry}>Retry</button></div> : null;
}
export function EmptyState({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <div className="wf-empty-state"><span className="wf-empty-icon">{icon}</span><h2>{title}</h2><p>{description}</p>{children}</div>;
}
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="wf-search"><Search size={17} /><span className="sr-only">{placeholder}</span><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
export function StatusBadge({ status }: { status: string }) {
  const positive = ["approved", "completed", "ended", "active", "connected"].includes(status.toLowerCase());
  const pending = ["pending", "in-progress", "queued", "ringing"].includes(status.toLowerCase());
  return <span className={`wf-badge ${positive ? "wf-badge-mint" : pending ? "wf-badge-amber" : ""}`}>{readable(status)}</span>;
}
export function readable(value: string) { return value.replace(/[_-]/g, " ").replace(/^\w/, letter => letter.toUpperCase()); }
