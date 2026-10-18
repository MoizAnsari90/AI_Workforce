"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import Link from "next/link";
import { ArrowUpRight, MessageCircle, Package, ShieldCheck, Sparkles } from "lucide-react";
import { ProductIllustration, PublicBrand } from "@/components/workforce/public-shell";
import { LanguageControl } from "@/components/language-control";
import { AppearanceControl } from "@/components/appearance-control";

export default function Home() {
  const { t } = useTranslation();
  return <div className="wf-shell wf-public wf-landing">
    <header className="wf-public-nav"><PublicBrand /><div><LanguageControl /><AppearanceControl /><Link className="wf-button wf-button-quiet" href="/login">{t("Sign in")}</Link><Link className="wf-button wf-button-primary" href="/register">{t("Get started")} <ArrowUpRight size={15} /></Link></div></header>
    <main><section className="wf-hero"><div className="wf-hero-copy"><div className="wf-public-label"><Sparkles size={15} />{t("AI WORKFORCE FOR YOUR BUSINESS")}</div><h1>{t("Your next hire")}<br />{t("is a")} <span>{t("workforce.")}</span></h1><p>{t("Bring your store, customer conversations and AI team together. Get clearer answers and keep the important decisions in your hands.")}</p><div className="wf-hero-actions"><Link href="/register" className="wf-button wf-button-primary">{t("Create your workspace")} <ArrowUpRight size={17} /></Link><Link href="/login" className="wf-button wf-button-secondary">{t("Enter your workspace")} <ArrowUpRight size={17} /></Link></div><div className="wf-hero-caption">{t("Built around your business. Managed by you.")}</div></div><div className="wf-hero-visual"><div className="wf-public-label">{t("YOUR BUSINESS, CONNECTED")}</div><ProductIllustration /><p>{t("Store context. Customer conversations. Human control.")}</p></div></section>
    <section className="wf-home-features" aria-label={t("What you can do")}><article className="wf-home-feature"><Package size={25} strokeWidth={1.6} /><h2>{t("Connect your store.")}</h2><p>{t("Connect Shopify or WooCommerce and ask your workforce about inventory using an exact product SKU.")}</p></article><article className="wf-home-feature"><MessageCircle size={25} strokeWidth={1.6} /><h2>{t("Bring conversations closer.")}</h2><p>{t("Connect WhatsApp Business through Meta and bring customer messaging into your workspace.")}</p></article><article className="wf-home-feature"><ShieldCheck size={25} strokeWidth={1.6} /><h2>{t("Keep the final say.")}</h2><p>{t("Review approval requests, check your team's activity and choose when your agents are active.")}</p></article></section></main>
    <footer className="wf-public-footer"><span>{t("AI Workforce · Your AI, at work.")}</span><Link href="/register">{t("Start building your team")} <ArrowUpRight size={13} style={{ display:"inline", verticalAlign:"middle" }} /></Link></footer>
  </div>;
}
