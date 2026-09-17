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
    { label: "Support AI", href: "#", icon: "💬", badge: "24/7" },
    { label: "Sales CRM", href: "#", icon: "💼", badge: "Live" },
    { label: "Operations", href: "#", icon: "📦" },
    { label: "Finance & PO", href: "#", icon: "💳" },
    { label: "Marketing", href: "#", icon: "🚀" },
    { label: "Audit Logs", href: "#", icon: "🛡️" },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-white flex flex-col justify-between p-4 sticky top-0 h-screen shadow-sm hidden md:flex">
        <div className="space-y-6">
          {/* Logo */}
          <div className="flex items-center gap-3 px-2 py-1">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-white shadow-md shadow-indigo-500/30">
              AI
            </div>
            <div>
              <span className="font-bold text-slate-900 text-base leading-tight block">AI Workforce</span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block">Enterprise Platform</span>
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
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    active
                      ? "bg-indigo-50 text-indigo-700 font-semibold"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">{item.icon}</span>
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* User Account / Logout */}
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center font-semibold text-xs text-slate-700">
              {user?.email?.[0]?.toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{user?.email || "Signed In"}</p>
              <p className="text-[11px] text-slate-400 truncate">{tenant?.name || "Workspace"}</p>
            </div>
          </div>
          <button
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
          >
            <span>🚪</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden border-b border-slate-200 bg-white p-4 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-xs">
              AI
            </div>
            <span className="font-bold text-slate-900 text-sm">AI Workforce</span>
          </div>
          <button
            onClick={() => logout()}
            className="text-xs text-red-600 font-medium hover:underline"
          >
            Sign Out
          </button>
        </header>

        <main className="flex-1 p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
