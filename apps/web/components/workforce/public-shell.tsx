"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import Link from "next/link";
import { ArrowRight, Check, MessageCircle, Package, ShieldCheck, Sparkles } from "lucide-react";
import { WorkforceMark } from "./brand";
import "@/app/(protected)/dashboard/workforce.css";
import "./public.css";
import { LanguageControl } from "@/components/language-control";
import { AppearanceControl } from "@/components/appearance-control";

export function PublicBrand() {
  const { t } = useTranslation(); return <Link href="/" className="wf-brand" aria-label={t("AI Workforce home")}><WorkforceMark /><span>workforce<span className="wf-brand-sub">{t("Your AI, at work.")}</span></span></Link>; }

export function ProductIllustration() {
  const { t } = useTranslation();
  return <div className="wf-product-scene" aria-label={t("Illustration of connected business tools")}>
    <div className="wf-scene-orbit" /><div className="wf-scene-orbit wf-scene-orbit-two" />
    <div className="wf-scene-core"><WorkforceMark /><span>{t("One connected")}<br /><strong>{t("workforce.")}</strong></span></div>
    <div className="wf-scene-card wf-scene-store"><span className="wf-tone-mint"><Package size={21} /></span><div><strong>{t("Your store")}</strong><small>{t("Inventory & orders")}</small></div></div>
    <div className="wf-scene-card wf-scene-chat"><span className="wf-tone-blue"><MessageCircle size={21} /></span><div><strong>{t("Your customers")}</strong><small>{t("Conversations in context")}</small></div></div>
    <div className="wf-scene-card wf-scene-control"><span className="wf-tone-amber"><ShieldCheck size={21} /></span><div><strong>{t("Your decisions")}</strong><small>{t("Human approval, built in")}</small></div><Check size={16} /></div>
  </div>;
}

export function AuthShell({ children, register }: { children: React.ReactNode; register: boolean }) {
  const { t } = useTranslation();
  return <div className="wf-shell wf-public wf-auth-shell"><section className="wf-auth-panel"><div className="wf-auth-heading"><PublicBrand /><div className="wf-header-controls"><LanguageControl /><AppearanceControl /></div></div><div className="wf-auth-form-wrap">{children}</div><div className="wf-auth-footer"><span>{register ? t("Already have an account?") : t("New to Workforce?")}</span><Link href={register ? "/login" : "/register"}>{register ? t("Sign in") : t("Create a workspace")}<ArrowRight size={14} /></Link></div></section><aside className="wf-auth-aside"><div className="wf-public-label"><Sparkles size={14} />{t("MAKE ROOM FOR BETTER WORK")}</div><ProductIllustration /><div className="wf-auth-story"><h2>{t("Less busywork.")}<br /><span>{t("More business.")}</span></h2><p>{t("Bring your store, customer conversations and AI team into one workspace.")}</p><div><ShieldCheck size={17} />{t("Your tools. Your team. Your control.")}</div></div></aside></div>;
}
