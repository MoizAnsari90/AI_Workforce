import Link from "next/link";
import { ArrowRight, Check, MessageCircle, Package, ShieldCheck, Sparkles } from "lucide-react";
import { WorkforceMark } from "./brand";
import "@/app/(protected)/dashboard/workforce.css";
import "./public.css";

export function PublicBrand() { return <Link href="/" className="wf-brand" aria-label="AI Workforce home"><WorkforceMark /><span>workforce<span className="wf-brand-sub">Your AI, at work.</span></span></Link>; }

export function ProductIllustration() {
  return <div className="wf-product-scene" aria-label="Illustration of connected business tools">
    <div className="wf-scene-orbit" /><div className="wf-scene-orbit wf-scene-orbit-two" />
    <div className="wf-scene-core"><WorkforceMark /><span>One connected<br /><strong>workforce.</strong></span></div>
    <div className="wf-scene-card wf-scene-store"><span className="wf-tone-mint"><Package size={21} /></span><div><strong>Your store</strong><small>Inventory & orders</small></div></div>
    <div className="wf-scene-card wf-scene-chat"><span className="wf-tone-blue"><MessageCircle size={21} /></span><div><strong>Your customers</strong><small>Conversations in context</small></div></div>
    <div className="wf-scene-card wf-scene-control"><span className="wf-tone-amber"><ShieldCheck size={21} /></span><div><strong>Your decisions</strong><small>Human approval, built in</small></div><Check size={16} /></div>
  </div>;
}

export function AuthShell({ children, register }: { children: React.ReactNode; register: boolean }) {
  return <div className="wf-shell wf-public wf-auth-shell"><section className="wf-auth-panel"><PublicBrand /><div className="wf-auth-form-wrap">{children}</div><div className="wf-auth-footer"><span>{register ? "Already have an account?" : "New to Workforce?"}</span><Link href={register ? "/login" : "/register"}>{register ? "Sign in" : "Create a workspace"}<ArrowRight size={14} /></Link></div></section><aside className="wf-auth-aside"><div className="wf-public-label"><Sparkles size={14} />MAKE ROOM FOR BETTER WORK</div><ProductIllustration /><div className="wf-auth-story"><h2>Less busywork.<br /><span>More business.</span></h2><p>Bring your store, customer conversations and AI team into one workspace.</p><div><ShieldCheck size={17} />Your tools. Your team. Your control.</div></div></aside></div>;
}
