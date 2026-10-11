"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, MessageSquareText, RefreshCw, Send, UserRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { workforceRequest, WorkforceRequestError } from "@/lib/workforce-api";
import { EmptyState, LoadError, PageHeading, StatusBadge, useWorkspaceResource } from "@/components/workforce/page-kit";

interface Conversation { id: string; customerPhone: string; customerName: string | null; aiActive: boolean; lastMessageAt: string; }
interface Message { id: string; direction: string; senderType: string; textContent: string; createdAt: string; }
interface ConversationDetail extends Conversation { messages: Message[]; olderMessagesCursor: string | null; }
interface ReplyAttempt { requestId: string; message: string; }
type Notice = { text: string; error?: boolean } | null;

export default function SupportInboxPage() {
  const { user } = useAuth();
  if (!user?.tenantId) return <p className="wf-helper">Loading workspace...</p>;
  const permissions: string[] = user.permissions || [];
  const admin = user.role === "admin" || permissions.includes("admin:all");
  if (!admin && !permissions.includes("support:read")) return <p role="alert">You need support read permission to open this inbox.</p>;
  return <Inbox key={`${user.tenantId}:${user.id}`} tenantId={user.tenantId} userId={user.id} canWrite={admin || permissions.includes("support:write")} />;
}

function Inbox({ tenantId, userId, canWrite }: { tenantId: string; userId: string; canWrite: boolean }) {
  const [filter, setFilter] = useState<"all" | "human">("all");
  const [page, setPage] = useState(0);
  const listUrl = `/api/proxy/tenants/${tenantId}/conversations?page=${page}${filter === "human" ? "&aiActive=false" : ""}`;
  const { data, loading, error, refresh } = useWorkspaceResource<Conversation[]>(listUrl, 10000);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const visible = data || [];
  // Selection stays stable when a refreshed list moves or filters the current row.
  useEffect(() => { if (!selected && data?.length) setSelected(data[0]); }, [selected, data]);

  return <div className="wf-page">
    <PageHeading eyebrow="CUSTOMER CONVERSATIONS" title="Support inbox." description="Review WhatsApp conversations, reply as a person and choose when the AI can take over."><button className="wf-button wf-button-secondary" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? "wf-spin" : ""} />Refresh list</button></PageHeading>
    <div className="wf-inbox-note"><MessageSquareText size={19} /><span>Messages refresh automatically. Staff replies pause future AI handling. A reply already being sent may still arrive.</span></div>
    <LoadError error={error} retry={() => void refresh()} />
    <section className="wf-inbox" aria-label="Support inbox">
      <aside className="wf-panel wf-inbox-list">
        <div className="wf-inbox-list-head"><h2>Conversations</h2><span>Page {page + 1}</span></div>
        <div className="wf-inbox-filters">{(["all", "human"] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>{value === "all" ? "All" : "Needs a person"}</button>)}</div>
        {!data ? <p className="wf-helper">{loading ? "Loading conversations..." : "Conversations are unavailable."}</p> : !visible.length ? <EmptyState icon={<MessageSquareText size={25} />} title="No conversations on this page." description={filter === "human" ? "Conversations with paused AI appear here." : "New customer messages appear here when WhatsApp is connected."} /> : <div className="wf-inbox-items">{visible.map(item => <button key={item.id} className={`wf-inbox-item ${selected?.id === item.id ? "is-selected" : ""}`} aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)}><span className="wf-inbox-avatar"><UserRound size={17} /></span><span className="wf-inbox-item-copy"><strong>{item.customerName || item.customerPhone}</strong><small>{item.customerPhone}</small><small>{new Date(item.lastMessageAt).toLocaleString()}</small></span><StatusBadge status={item.aiActive ? "AI active" : "needs person"} /></button>)}</div>}
        <div className="wf-inbox-filters"><button disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><button disabled={loading || visible.length < 50} onClick={() => setPage(value => value + 1)}>Next</button></div>
      </aside>
      {selected ? <Thread key={selected.id} tenantId={tenantId} userId={userId} conversation={selected} canWrite={canWrite} draft={drafts[selected.id] || ""} setDraft={value => setDrafts(current => ({ ...current, [selected.id]: value }))} refreshList={refresh} /> : <section className="wf-panel wf-inbox-thread"><EmptyState icon={<MessageSquareText size={28} />} title="Select a conversation" description="Choose a customer from the list to read and reply." /></section>}
    </section>
  </div>;
}

function Thread({ tenantId, userId, conversation, canWrite, draft, setDraft, refreshList }: {
  tenantId: string; userId: string; conversation: Conversation; canWrite: boolean; draft: string; setDraft: (value: string) => void; refreshList: () => Promise<void>;
}) {
  const base = `/api/proxy/tenants/${tenantId}/conversations/${conversation.id}`;
  const { data: detail, loading, error, refresh } = useWorkspaceResource<ConversationDetail>(base, 5000);
  const [older, setOlder] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState<ReplyAttempt | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const storageKey = `support-reply:${tenantId}:${userId}:${conversation.id}`;
  const log = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const messages = useMemo(() => [...new Map([...older, ...(detail?.messages || [])].map(message => [message.id, message])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), [older, detail?.messages]);
  const cursor = olderCursor === undefined ? detail?.olderMessagesCursor : olderCursor;

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved && typeof saved.requestId === "string" && typeof saved.message === "string") {
        setAttempt(saved); setNotice({ text: "A previous reply has not been confirmed here. Check the same request before sending another.", error: true });
      }
    } catch { /* Unavailable browser storage is reported before a send. */ }
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => { if (stickToBottom.current) log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages.at(-1)?.id]);

  function clearAttempt() { sessionStorage.removeItem(storageKey); setAttempt(null); setReviewed(false); }
  async function action(path: "pause-ai" | "resume-ai") {
    if (lock.current || !detail || !canWrite) return;
    lock.current = true; setBusy(true); setNotice(null);
    try {
      await workforceRequest(`${base}/${path}`, { method: "POST", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: "{}" });
      setNotice({ text: path === "pause-ai" ? "AI paused for this conversation." : "AI resumed. Future customer messages will be handled by AI when channel setup is verified." });
      void Promise.all([refresh(), refreshList()]);
    } catch (err) { setNotice({ text: err instanceof Error ? err.message : "Action failed.", error: true }); }
    finally { lock.current = false; setBusy(false); }
  }
  async function loadOlder() {
    if (!cursor || historyBusy) return;
    setHistoryBusy(true);
    try {
      const result = await workforceRequest<ConversationDetail>(`${base}?before=${encodeURIComponent(cursor)}`, { signal: AbortSignal.timeout(30000) });
      stickToBottom.current = false;
      setOlder(current => [...result.messages, ...current, ...(detail?.messages || [])]);
      setOlderCursor(result.olderMessagesCursor);
    } catch (err) { setNotice({ text: err instanceof Error ? err.message : "Could not load older messages.", error: true }); }
    finally { setHistoryBusy(false); }
  }
  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !detail || !canWrite || !hydrated || (!attempt && !draft.trim())) return;
    lock.current = true; setBusy(true); setNotice(null);
    let request: ReplyAttempt;
    try {
      request = attempt || { requestId: crypto.randomUUID(), message: draft.trim() };
      // Preserve the exact attempt across navigation/reload before any network I/O.
      sessionStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      setNotice({ text: "Browser session storage is unavailable. Enable it to send replies safely.", error: true });
      lock.current = false; setBusy(false); return;
    }
    setAttempt(request);
    try {
      await workforceRequest(`${base}/reply`, { method: "POST", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      clearAttempt(); setDraft(""); stickToBottom.current = true;
      setNotice({ text: "Meta accepted this reply. This does not confirm delivery to the customer's phone. AI remains paused." });
    } catch (err) {
      if (err instanceof WorkforceRequestError && err.code === "REPLY_REJECTED") { clearAttempt(); setDraft(request.message); }
      setNotice({ text: err instanceof WorkforceRequestError ? err.message : "Reply acceptance could not be confirmed. Check the same request before sending another.", error: true });
    } finally {
      lock.current = false; setBusy(false); void Promise.all([refresh(), refreshList()]);
    }
  }

  return <section className="wf-panel wf-inbox-thread" aria-label="Conversation details">
    <header className="wf-inbox-thread-head"><div><p className="wf-eyebrow">WHATSAPP CUSTOMER</p><h2>{conversation.customerName || conversation.customerPhone}</h2><p>{conversation.customerPhone}</p></div><div className="wf-inbox-thread-actions">{detail && <StatusBadge status={detail.aiActive ? "AI active" : "human takeover"} />}<button className="wf-text-button" disabled={loading} onClick={() => void refresh()}>Refresh messages</button>{canWrite && detail && <button className="wf-button wf-button-secondary" disabled={busy || !!attempt} onClick={() => void action(detail.aiActive ? "pause-ai" : "resume-ai")}>{detail.aiActive ? "Pause AI" : "Resume AI"}</button>}</div></header>
    <LoadError error={error} retry={() => void refresh()} />
    {notice && <div className={`wf-notice ${notice.error ? "wf-notice-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.error ? <CircleAlert size={17} /> : <Check size={17} />}{notice.text}</div>}
    <div className="wf-inbox-messages" ref={log} onScroll={() => { const node = log.current; if (node) stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60; }}>
      {cursor && <button className="wf-text-button" disabled={historyBusy} onClick={() => void loadOlder()}>{historyBusy ? "Loading history..." : "Load older messages"}</button>}
      {!detail ? <p className="wf-helper">{loading ? "Loading messages..." : "Refresh to load this conversation."}</p> : !messages.length ? <EmptyState icon={<MessageSquareText size={25} />} title="No messages yet" description="The conversation history will appear here." /> : messages.map(message => <article key={message.id} className={`wf-inbox-message is-${message.direction}`}><span>{message.senderType === "customer" ? "Customer" : message.senderType === "human" ? "Your team" : "AI Workforce"}</span><p>{message.textContent}</p><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></article>)}
    </div>
    {canWrite ? <form className="wf-inbox-reply" onSubmit={sendReply}><label htmlFor="support-reply">Reply to {conversation.customerName || conversation.customerPhone}</label><textarea id="support-reply" className="wf-field" value={attempt?.message ?? draft} disabled={!hydrated || busy || !!attempt || !detail || !!error} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder="Write a WhatsApp reply..." required /><div><span className="wf-helper">{attempt ? "The same reply request is preserved; uncertain sends are never automatically resent." : "Sending pauses AI. Replies must be allowed by the customer's WhatsApp messaging window."}</span><button className="wf-button wf-button-primary" disabled={busy || !hydrated || !detail || !!error || (!attempt && !draft.trim())}><Send size={15} />{busy ? "Checking..." : attempt ? "Check / retry same request" : "Send reply"}</button></div>{attempt && !busy && <div><label className="wf-helper"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I checked this reply in Meta and reviewed whether it was sent.</label><button type="button" className="wf-text-button" disabled={!reviewed} onClick={() => { clearAttempt(); setDraft(""); setNotice({ text: "Previous request closed here. It will not be resent. You can compose a new reply." }); }}>Close reviewed request</button></div>}</form> : <p className="wf-inbox-note">You have read-only access. A teammate with support write permission can reply or change AI handling.</p>}
  </section>;
}
