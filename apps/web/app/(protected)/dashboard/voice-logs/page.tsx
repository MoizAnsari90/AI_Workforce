"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useState } from "react";
import { ChevronDown, MessageSquareText, Mic, Phone, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { EmptyState, LoadError, PageHeading, RefreshButton, SearchField, StatusBadge, useWorkspaceResource } from "@/components/workforce/page-kit";

interface VoiceSession { id: string; provider: string; callId: string; status: string; transcript: { speaker: string; text: string }[] | null; metadata?: { durationSeconds?: number; transcriptUrl?: string; recordingUrl?: string }; createdAt: string }

export default function VoiceLogsPage() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const { data, loading, error, refresh } = useWorkspaceResource<VoiceSession[]>(user?.tenantId ? `/api/proxy/tenants/${user.tenantId}/voice-sessions` : undefined);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const providers = [...new Set(data?.map(item => item.provider) || [])];
  const shown = data?.filter(item => (provider === "all" || item.provider === provider) && `${item.callId} ${item.status} ${item.provider}`.toLowerCase().includes(query.toLowerCase())) || [];
  return <div className="wf-page">
    <PageHeading eyebrow={t("EVERY CONVERSATION, IN CONTEXT")} title={t("The voice of your business.")} description={t("Review recorded call sessions and follow the conversation, word for word.")}><RefreshButton loading={loading} onClick={() => void refresh()} /></PageHeading>
    <div className="wf-feature-banner"><span className="wf-feature-icon"><Mic size={28} /></span><div><h2>{t("A clearer view of every call.")}</h2><p>{t("Dograh call results appear here after its Webhook node sends the configured call data.")}</p></div><span className="wf-badge">{data ? `${data.length} recorded sessions` : t("Checking sessions")}</span></div>
    <LoadError error={error} retry={() => void refresh()} />
    <div className="wf-toolbar"><div className="wf-tabs" aria-label={t("Voice provider")}><button aria-pressed={provider === "all"} onClick={() => setProvider("all")}>{t("All providers")}</button>{providers.map(item => <button key={item} aria-pressed={provider === item} onClick={() => setProvider(item)}>{item}</button>)}</div><SearchField value={query} onChange={setQuery} placeholder={t("Search calls")} /></div>
    {!data || !shown.length ? <section className="wf-panel"><EmptyState icon={query ? <Search size={28} /> : <Mic size={30} />} title={!data ? loading ? t("Loading conversations…") : t("Calls unavailable") : data.length ? t("No matching calls.") : t("Your next conversation starts here.")} description={!data ? loading ? t("Checking voice sessions in this workspace.") : t("Retry to load your call sessions.") : data.length ? t("Try another call ID, status or provider.") : t("Publish a Dograh voice agent, connect it in Reception automation, and configure its Webhook node to send call results here.")} /></section> : <div className="wf-call-list">{shown.map(item => <details className="wf-panel wf-call" key={item.id}><summary><span className="wf-record-icon wf-tone-blue"><Phone size={19} /></span><div className="wf-call-title"><strong>{item.provider}  {t("conversation")}</strong><span>{new Date(item.createdAt).toLocaleString(locale)}</span></div><StatusBadge status={item.status} /><ChevronDown className="wf-chevron" size={17} /></summary><div className="wf-call-body"><p className="wf-call-id">{t("Call ID:")} {item.callId}{typeof item.metadata?.durationSeconds === "number" && <> · {item.metadata.durationSeconds} {t("seconds")}</>}</p>{(item.metadata?.transcriptUrl || item.metadata?.recordingUrl) && <p className="wf-call-id">{item.metadata.transcriptUrl && <a href={item.metadata.transcriptUrl} target="_blank" rel="noopener noreferrer">{t("Open transcript")}</a>}{item.metadata.transcriptUrl && item.metadata.recordingUrl && " · "}{item.metadata.recordingUrl && <a href={item.metadata.recordingUrl} target="_blank" rel="noopener noreferrer">{t("Open recording")}</a>}</p>}<div className="wf-transcript-heading"><MessageSquareText size={16} /><h2>{t("Conversation transcript")}</h2></div>{Array.isArray(item.transcript) && item.transcript.length ? <div className="wf-transcript">{item.transcript.map((line, index) => <div className={`wf-transcript-line ${line.speaker.toLowerCase() === "agent" ? "is-agent" : ""}`} key={index}><span>{line.speaker}</span><p>{line.text}</p></div>)}</div> : <p className="wf-transcript-empty">{t("No transcript was recorded for this session.")}</p>}</div></details>)}</div>}
  </div>;
}
