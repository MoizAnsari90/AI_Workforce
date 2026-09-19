"use client";

import { useAuth } from "@/contexts/AuthContext.hooks";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, tenant, logout } = useAuth();
  const pathname = usePathname();

  const navItems = [
    { label: "Overview", href: "/dashboard", icon: "📊" },
    { label: "Approval Queue", href: "/dashboard/approvals", icon: "✋", badge: "HITL" },
    { label: "Niche Templates", href: "/dashboard/templates", icon: "📦", badge: "Bundles" },
    { label: "Voice Logs", href: "/dashboard/voice-logs", icon: "🎙️", badge: "Vapi" },
    { label: "WhatsApp Settings", href: "/dashboard/settings/whatsapp", icon: "⚙️", badge: "Meta" },
    { label: "Support AI", href: "#", icon: "💬" },
    { label: "Sales CRM", href: "#", icon: "💼" },
    { label: "Operations", href: "#", icon: "⚙️" },
    { label: "Finance", href: "#", icon: "💳" },
    { label: "Marketing", href: "#", icon: "🚀" },
    { label: "Audit Logs", href: "#", icon: "🛡️" },
  ];

  return (
    <div className="flex min-h-screen bg-[#040914] text-slate-100">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-900 bg-[#040914] flex flex-col justify-between p-4 sticky top-0 h-screen shadow-sm hidden md:flex">
        <div className="space-y-6">
          {/* Logo */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center font-bold text-cyan-400 glow-cyan">
              ✦
            </div>
            <div>
              <span className="font-bold text-white text-base leading-tight block tracking-wider uppercase">workforce</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold block">Autonomous Operations</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold glow-cyan"
                      : "text-slate-400 hover:bg-slate-900 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-cyan-300 font-medium">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Account / Logout */}
        <div className="border-t border-slate-900 pt-4 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-semibold text-xs text-cyan-300">
              {user?.email?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate">{user?.email || "Signed In"}</p>
              <p className="text-[11px] text-slate-500 truncate">{tenant?.name || "Workspace"}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-red-400 hover:bg-red-950/40 rounded-xl transition-colors"
          >
            <span>🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#040914]">
        {/* Mobile Header */}
        <header className="md:hidden border-b border-slate-900 bg-[#040914] p-4 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center font-bold text-cyan-400 text-xs">
              ✦
            </div>
            <span className="font-bold text-white text-sm">AI Workforce</span>
          </div>
          <button
            onClick={() => logout()}
            className="text-xs text-red-400 font-medium hover:underline"
          >
            Sign Out
          </button>
        </header>

        <main className="flex-1 p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
