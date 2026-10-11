"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, CircleAlert, Database, MessageSquareText, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { workforceRequest } from "@/lib/workforce-api";
import { WorkforceMark } from "./brand";

type Answer = { answer: string; source?: string };
type Exchange = { id: number; requestId: string; question: string; answer?: string; source?: string; error?: string };
type AssistantAgent = { id: string; name: string; department: string; isActive: boolean; _count: { tasks: number }; tasks: { title: string; status: string; createdAt: string }[] };
const suggestions = [
  { label: "Bundle & agents", question: "Tell me about my selected bundle and what each agent is doing." },
  { label: "Workspace overview", question: "Give me a workspace summary." },
  { label: "Pending approvals", question: "How many approvals are pending?" },
  { label: "Store questions", question: "What can you check about my store?" },
  { label: "Yesterday's report", question: "Daily report yesterday" },
];
const sourceNames: Record<string, string> = { database: "Workspace data", gemini: "Verified metrics", shopify: "Live Shopify data", woocommerce: "WooCommerce inventory", clarification: "Assistant" };

export function WorkforceAssistant({ tenantId, agents, bundleIndustry, checkedAt }: { tenantId: string | undefined; agents: AssistantAgent[]; bundleIndustry?: string; checkedAt?: string }) {
  const [prompt, setPrompt] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const bundleNames: Record<string, string> = { ecommerce: "E-commerce", real_estate: "Real estate", healthcare: "Clinic / healthcare" };
  const departmentWork: Record<string, string> = {
    operations: "Store operations and commerce workflows",
    healthcare: "Clinic reception and appointment workflows",
    sales: "Lead qualification and customer follow-up",
    support: "Customer questions and support workflows",
    marketing: "Marketing content and campaign workflows",
    finance: "Finance records and approval workflows",
  };

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [exchanges, busy]);

  async function ask(question = prompt, requestId = crypto.randomUUID()) {
    const text = question.trim();
    if (!text || !tenantId || inFlight.current) return;
    const id = ++sequence.current;
    const request = new AbortController();
    controller.current = request;
    inFlight.current = true;
    setBusy(true);
    setPrompt("");
    setExchanges(current => [...current, { id, requestId, question: text }]);
    try {
      const result = await workforceRequest<Answer>(`/api/proxy/tenants/${tenantId}/workforce/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, requestId }), signal: request.signal,
      });
      setExchanges(current => current.map(item => item.id === id ? { ...item, answer: result.answer, source: result.source } : item));
    } catch (error) {
      if (!request.signal.aborted) setExchanges(current => current.map(item => item.id === id ? { ...item, error: error instanceof Error ? error.message : "Your question couldn't be sent. Please try again." } : item));
    } finally {
      inFlight.current = false;
      if (!request.signal.aborted) { setBusy(false); input.current?.focus(); }
    }
  }

  return <section className="wf-panel wf-assistant" id="assistant" aria-labelledby="assistant-title">
    <div className="wf-panel-heading"><div className="wf-heading-with-icon"><WorkforceMark small /><div><h2 id="assistant-title">Your workforce assistant</h2><p>A clearer picture of your business.</p></div></div><span className="wf-badge"><ShieldCheck size={12} /> Read only</span></div>
    <section className="wf-bundle-live" aria-label="Selected bundle and agent status">
      <div className="wf-bundle-live-heading"><div><span className="wf-eyebrow">YOUR SELECTED BUNDLE</span><h3>{bundleNames[bundleIndustry || ""] || "Business bundle"}</h3></div><span className="wf-live-indicator"><i /> Status checks every 30 sec</span></div>
      <p className="wf-bundle-description">{bundleIndustry === "ecommerce" ? "Store operations, product and inventory questions, order workflows, and customer support when the required connections are active." : bundleIndustry === "real_estate" ? "Property enquiries, lead qualification, and viewing coordination configured for this workspace." : bundleIndustry === "healthcare" ? "Clinic reception, patient enquiries, and appointment coordination. The assistant does not provide medical diagnosis or treatment advice." : "Save your business details to show the bundle configured for this workspace."}</p>
      <div className="wf-bundle-team-heading"><strong>Your agents <span>{agents.length}</span></strong>{checkedAt && <time dateTime={checkedAt}>Checked {new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>}</div>
      {agents.length ? <div className="wf-bundle-agent-list">{agents.map(agent => {
        const latest = agent.tasks[0];
        return <article className="wf-bundle-agent" key={agent.id}>
          <span className={`wf-bundle-agent-dot ${agent.isActive ? "is-active" : ""}`} aria-label={agent.isActive ? "Active" : "Paused"} />
          <div className="wf-bundle-agent-main"><strong>{agent.name}</strong><span>{departmentWork[agent.department.toLowerCase()] || `${agent.department.replace(/[_-]/g, " ")} workflows`}</span></div>
          <div className="wf-bundle-agent-work"><small>{latest ? `Latest recorded task · ${latest.status.replace(/[_-]/g, " ")}` : `${agent._count.tasks} tasks recorded`}</small><span>{latest?.title || (agent.isActive ? "Enabled for configured workflows" : "New automated work is paused")}</span></div>
        </article>;
      })}</div> : <p className="wf-bundle-no-agents">No agents are deployed in this workspace yet. Choose a bundle in setup to get started.</p>}
    </section>
    <div className="wf-conversation" ref={log} role="log" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions text">
      {exchanges.length === 0 ? <div className="wf-assistant-empty">
        <div className="wf-assistant-art" aria-hidden="true"><span className="wf-orbit wf-orbit-one" /><span className="wf-orbit wf-orbit-two" /><span className="wf-orbit-node"><Database size={16} /></span><span className="wf-orbit-message"><MessageSquareText size={16} /></span><div className="wf-assistant-core"><Sparkles size={30} strokeWidth={1.4} /></div><span className="wf-orbit-check"><Check size={13} /></span></div>
        <h3>Less searching. More clarity.</h3><p>Ask about your team, approvals or store inventory.<br />Get answers grounded in your workspace.</p>
      </div> : exchanges.map(item => <div className="wf-exchange" key={item.id}>
        <div className="wf-question"><span className="wf-message-label">You</span><p>{item.question}</p></div>
        <div className="wf-answer">
          <span className="wf-message-label"><Sparkles size={13} /> Workforce {item.source && <span className="wf-answer-source">{sourceNames[item.source] || "Assistant"}</span>}</span>
          {item.error ? <div className="wf-chat-error" role="alert"><p><CircleAlert size={15} />{item.error}</p><button disabled={busy} onClick={() => void ask(item.question, item.requestId)} className="wf-text-button"><RotateCcw size={13} /> Try again</button></div> : item.answer ? <p>{item.answer}</p> : <span className="wf-thinking">Checking your workspace<span>...</span></span>}
        </div>
      </div>)}
    </div>
    <div className="wf-assistant-bottom">
      <details className="wf-helper"><summary>Questions you can ask</summary><p>Stock for SKU: sku-managed-1<br />Stock and price of product &quot;your exact product name&quot;<br />Order #1001 status<br />Sales summary today<br />Daily report yesterday<br />Top products this month<br />Low-stock products below 10</p><p>Product, order and sales questions use Shopify and your workspace permissions. WooCommerce supports exact-SKU stock. Each question is independent; use the full product or order name.</p><Link href="/dashboard/reports">Preview a daily report or set up owner delivery →</Link></details>
      {exchanges.length === 0 && <div className="wf-suggestions">{suggestions.map(item => <button key={item.label} disabled={busy || !tenantId} onClick={() => void ask(item.question)}>{item.label}<ArrowUp size={12} /></button>)}</div>}
      <form onSubmit={event => { event.preventDefault(); void ask(); }} className="wf-composer">
        <label htmlFor="workforce-question" className="sr-only">Ask your workforce</label>
        <textarea ref={input} id="workforce-question" rows={2} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); } }} placeholder="What would you like to know?" />
        <button type="submit" disabled={busy || !tenantId || !prompt.trim()} aria-label={busy ? "Waiting for answer" : "Send question"}><ArrowUp size={19} /></button>
      </form>
      <div className="wf-composer-note"><span>Each question is answered independently.</span><span>Enter to send</span></div>
    </div>
  </section>;
}
