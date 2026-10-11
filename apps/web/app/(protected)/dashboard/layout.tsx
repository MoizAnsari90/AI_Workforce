"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Building2, ChevronRight, CircleCheck, HeartPulse, LayoutDashboard, LogOut, Menu, MessageCircle, MessageSquareText, Mic, Plug, Sparkles, X } from "lucide-react";
import { WorkforceMark } from "@/components/workforce/brand";
import "./workforce.css";

const groups = [
  { title: "Workspace", items: [
    { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { label: "Daily reports", href: "/dashboard/reports", icon: LayoutDashboard },
    { label: "Approvals", href: "/dashboard/approvals", icon: CircleCheck },
    { label: "Support inbox", href: "/dashboard/support-inbox", icon: MessageSquareText },
    { label: "AI templates", href: "/dashboard/templates", icon: Sparkles },
    { label: "Voice logs", href: "/dashboard/voice-logs", icon: Mic },
    { label: "Billing", href: "/dashboard/billing", icon: CircleCheck },
  ] },
  { title: "Business workflows", items: [
    { label: "Real estate", href: "/dashboard/real-estate", icon: Building2 },
    { label: "Clinic reception", href: "/dashboard/healthcare", icon: HeartPulse },
  ] },
  { title: "Connections", items: [
    { label: "Business setup", href: "/dashboard/settings/business", icon: Building2 },
    { label: "Integrations", href: "/dashboard/integrations", icon: Plug },
    { label: "WhatsApp", href: "/dashboard/settings/whatsapp", icon: MessageCircle },
  ] },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, tenant, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageName = groups.flatMap(group => group.items).find(item => item.href === pathname)?.label || "Workspace";
  const navigation = (mobile = false) => <nav aria-label={mobile ? "Mobile workspace" : "Workspace"} className="wf-nav">
    {groups.map(group => <div className="wf-nav-group" key={group.title}>
      <p className="wf-nav-label">{group.title}</p>
      {group.items.map(({ label, href, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} aria-current={pathname === href ? "page" : undefined} className={`wf-nav-item ${pathname === href ? "is-active" : ""}`}>
        <Icon size={18} strokeWidth={1.7} /><span>{label}</span>{pathname === href && <span className="wf-nav-dot" />}
      </Link>)}
    </div>)}
  </nav>;

  return <div className="wf-shell">
    <a href="#workspace-content" className="wf-skip">Skip to content</a>
    <aside className="wf-sidebar">
      <Link href="/dashboard" className="wf-brand" aria-label="AI Workforce overview"><WorkforceMark /><span>AI Workforce<span className="wf-brand-sub">Your AI, at work.</span></span></Link>
      <div className="wf-workspace-switch"><span className="wf-workspace-avatar">{tenant?.name?.[0]?.toUpperCase() || "W"}</span><span><strong>{tenant?.name || "Your workspace"}</strong><small>Business workspace</small></span></div>
      {navigation()}
      <div className="wf-sidebar-bottom">
        <div className="wf-sidebar-tip"><Sparkles size={19} /><strong>Make room for better work.</strong><p>Start with an AI template built for your business.</p><Link href="/dashboard/templates">Explore templates <ArrowUpRight size={15} /></Link></div>
        <div className="wf-profile"><span className="wf-avatar">{user?.email?.[0]?.toUpperCase() || "U"}</span><span className="wf-profile-copy"><strong>{user?.email?.split("@")[0] || "Your account"}</strong><small>{user?.role || "Workspace member"}</small></span><button onClick={() => logout()} className="wf-icon-button" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div>
      </div>
    </aside>
    <div className="wf-workspace-main">
      <header className="wf-topbar">
        <div className="wf-breadcrumb"><button className="wf-icon-button wf-mobile-toggle" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="mobile-navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button><span className="wf-breadcrumb-workspace">Workspace</span><ChevronRight size={14} /><strong>{pageName}</strong></div>
        <div className="wf-topbar-right"><span className="wf-topbar-name">{tenant?.name || "AI Workforce"}</span><span className="wf-avatar wf-avatar-small">{user?.email?.[0]?.toUpperCase() || "W"}</span></div>
      </header>
      {mobileOpen && <div id="mobile-navigation" className="wf-mobile-navigation" onKeyDown={event => { if (event.key === "Escape") setMobileOpen(false); }}>{navigation(true)}<button className="wf-button wf-button-quiet" onClick={() => logout()}><LogOut size={16} /> Sign out</button></div>}
      <main id="workspace-content" className="wf-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
