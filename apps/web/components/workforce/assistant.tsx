"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, CircleAlert, Database, MessageSquareText, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { workforceRequest } from "@/lib/workforce-api";
import { WorkforceMark } from "./brand";
import { VoiceQuestionControl, type VoiceTranscript } from './voice-question-control';
import { useCompanion } from '@/contexts/CompanionContext';
import { assistantCompanionState, type CompanionState } from '@/lib/companion';

type Answer = { answer: string; source?: string };
type Exchange = { id: number; requestId: string; question: string; requestQuestion: string; answer?: string; source?: string; error?: string };
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
  const { t, locale } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceTranscript | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<CompanionState>('ready');
  const { setState: setCompanionState } = useCompanion();
  const companionState = assistantCompanionState(busy, voiceStatus, exchanges[exchanges.length - 1]);
  useEffect(() => { setCompanionState(companionState); }, [companionState, setCompanionState]);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
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

  async function ask(question = prompt, requestId = crypto.randomUUID(), retryQuestion?: string) {
    const displayQuestion = question.trim();
    const text = (retryQuestion || (voiceDraft?.transcript === question ? voiceDraft.question : question)).trim();
    if (!text || text.length > 2000 || displayQuestion.length > 2000 || !tenantId || inFlight.current || voiceBusy) return;
    const id = ++sequence.current;
    const request = new AbortController();
    controller.current = request;
    inFlight.current = true;
    setBusy(true);
    setPrompt("");
    setVoiceDraft(null);
    setExchanges(current => [...current, { id, requestId, question: displayQuestion, requestQuestion: text }]);
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
    <div className="wf-panel-heading"><div className="wf-heading-with-icon"><WorkforceMark small /><div><h2 id="assistant-title">{t("Your workforce assistant")}</h2><p>{t("A clearer picture of your business.")}</p></div></div><span className="wf-badge"><ShieldCheck size={12} />  {t("Read only")}</span></div>
    <section className="wf-bundle-live" aria-label={t("Selected bundle and agent status")}>
      <div className="wf-bundle-live-heading"><div><span className="wf-eyebrow">{t("YOUR SELECTED BUNDLE")}</span><h3>{t(bundleNames[bundleIndustry || ""] || "Business bundle")}</h3></div><span className="wf-live-indicator"><i />  {t("Status checks every 30 sec")}</span></div>
      <p className="wf-bundle-description">{bundleIndustry === "ecommerce" ? t("Store operations, product and inventory questions, order workflows, and customer support when the required connections are active.") : bundleIndustry === "real_estate" ? t("Property enquiries, lead qualification, and viewing coordination configured for this workspace.") : bundleIndustry === "healthcare" ? t("Clinic reception, patient enquiries, and appointment coordination. The assistant does not provide medical diagnosis or treatment advice.") : t("Save your business details to show the bundle configured for this workspace.")}</p>
      <div className="wf-bundle-team-heading"><strong>{t("Your agents")} <span>{agents.length}</span></strong>{checkedAt && <time dateTime={checkedAt}>{t("Checked")} {new Date(checkedAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}</time>}</div>
      {agents.length ? <div className="wf-bundle-agent-list">{agents.map(agent => {
        const latest = agent.tasks[0];
        return <article className="wf-bundle-agent" key={agent.id}>
          <span className={`wf-bundle-agent-dot ${agent.isActive ? "is-active" : ""}`} aria-label={agent.isActive ? t("Active") : t("Paused")} />
          <div className="wf-bundle-agent-main"><strong>{agent.name}</strong><span>{departmentWork[agent.department.toLowerCase()] ? t(departmentWork[agent.department.toLowerCase()]) : t("{department} workflows", { department: agent.department.replace(/[_-]/g, " ") })}</span></div>
          <div className="wf-bundle-agent-work"><small>{latest ? t("Latest recorded task · {status}", { status: t(latest.status.replace(/[_-]/g, " ").replace(/^\w/, value => value.toUpperCase())) }) : t("{count} tasks recorded", { count: new Intl.NumberFormat(locale).format(agent._count.tasks) })}</small><span>{latest?.title || t(agent.isActive ? "Enabled for configured workflows" : "New automated work is paused")}</span></div>
        </article>;
      })}</div> : <p className="wf-bundle-no-agents">{t("No agents are deployed in this workspace yet. Choose a bundle in setup to get started.")}</p>}
    </section>
    <div className="wf-conversation" ref={log} role="log" aria-label={t("Assistant conversation")} aria-live="polite" aria-relevant="additions text">
      {exchanges.length === 0 ? <div className="wf-assistant-empty">
        <div className="wf-assistant-art" aria-hidden="true"><span className="wf-orbit wf-orbit-one" /><span className="wf-orbit wf-orbit-two" /><span className="wf-orbit-node"><Database size={16} /></span><span className="wf-orbit-message"><MessageSquareText size={16} /></span><div className="wf-assistant-core"><Sparkles size={30} strokeWidth={1.4} /></div><span className="wf-orbit-check"><Check size={13} /></span></div>
        <h3>{t("Less searching. More clarity.")}</h3><p>{t("Ask about your team, approvals or store inventory.")}<br />{t("Get answers grounded in your workspace.")}</p>
      </div> : exchanges.map(item => <div className="wf-exchange" key={item.id}>
        <div className="wf-question"><span className="wf-message-label">{t("You")}</span><p>{item.question}</p></div>
        <div className="wf-answer">
          <span className="wf-message-label"><Sparkles size={13} />  {t("Workforce")} {item.source && <span className="wf-answer-source">{t(sourceNames[item.source] || "Assistant")}</span>}</span>
          {item.error ? <div className="wf-chat-error" role="alert"><p><CircleAlert size={15} />{t(item.error)}</p><button disabled={busy || voiceBusy} onClick={() => void ask(item.question, item.requestId, item.requestQuestion)} className="wf-text-button"><RotateCcw size={13} />  {t("Try again")}</button></div> : item.answer ? <p>{item.answer}</p> : <span className="wf-thinking">{t("Checking your workspace")}<span>...</span></span>}
        </div>
      </div>)}
    </div>
    <div className="wf-assistant-bottom">
      <details className="wf-helper"><summary>{t("Questions you can ask")}</summary><p>{t("Stock for SKU: sku-managed-1")}<br />{t("Stock and price of product \"your exact product name\"")}<br />{t("Order #1001 status")}<br />{t("Sales summary today")}<br />{t("Daily report yesterday")}<br />{t("Top products this month")}<br />{t("Low-stock products below 10")}</p><p>{t("Product, order and sales questions use Shopify and your workspace permissions. WooCommerce supports exact-SKU stock. Each question is independent; use the full product or order name.")}</p><Link href="/dashboard/reports">{t("Preview a daily report or set up owner delivery →")}</Link></details>
      {exchanges.length === 0 && <div className="wf-suggestions">{suggestions.map(item => <button key={t(item.label)} disabled={busy || voiceBusy || !tenantId} onClick={() => void ask(item.question)}>{t(item.label)}<ArrowUp size={12} /></button>)}</div>}
      <form onSubmit={event => { event.preventDefault(); void ask(); }} className="wf-composer">
        <label htmlFor="workforce-question" className="sr-only">{t("Ask your workforce")}</label>
        <textarea ref={input} id="workforce-question" rows={2} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); } }} placeholder={t("What would you like to know?")} />
        <VoiceQuestionControl tenantId={tenantId} disabled={busy} onActivity={setVoiceBusy} onStatusChange={setVoiceStatus} onTranscript={value => {
          const prefix = promptRef.current.trim() ? `${promptRef.current.trim()}\n` : '';
          const draft = { transcript: prefix + value.transcript, question: prefix + value.question };
          setPrompt(draft.transcript); setVoiceDraft(draft); input.current?.focus();
        }} />
        <button type="submit" disabled={busy || voiceBusy || !tenantId || !prompt.trim() || prompt.length > 2000 || (voiceDraft?.transcript === prompt && voiceDraft.question.length > 2000)} aria-label={busy ? t("Waiting for answer") : t("Send question")}><ArrowUp size={19} /></button>
      </form>
      {voiceDraft && <p className="wf-helper" role="status">{t('Transcript ready. Review or edit your question, then send.')} {voiceDraft.transcript === prompt && voiceDraft.question !== prompt && <span dir="auto">{t('Agent interpretation:')} {voiceDraft.question}</span>}</p>}
      {(prompt.length > 2000 || (voiceDraft?.transcript === prompt && voiceDraft.question.length > 2000)) && <p className="wf-inline-error" role="alert">{t('Please shorten your question to 2000 characters before sending.')}</p>}
      <div className="wf-composer-note"><span>{t("Each question is answered independently.")}</span><span>{t("Enter to send")}</span></div>
    </div>
  </section>;
}
