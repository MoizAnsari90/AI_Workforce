import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-between selection:bg-indigo-500 selection:text-white">
      {/* Navbar */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 lg:px-16 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/30">
            AI
          </div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            AI Workforce
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-900">
              Sign In
            </Button>
          </Link>
          <Link href="/register">
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/25">
              Register Tenant
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 px-6 lg:px-16 py-16 lg:py-24 max-w-7xl mx-auto w-full flex flex-col items-center text-center justify-center space-y-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold tracking-wide uppercase">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
          Autonomous Multi-Agent Enterprise Platform
        </div>

        <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight max-w-4xl leading-none">
          Your AI Team, <br />
          <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
            Working 24/7.
          </span>
        </h1>

        <p className="text-slate-400 text-lg lg:text-xl max-w-2xl leading-relaxed">
          Scale your business with autonomous AI employees specialized in Support, Sales, Operations, Finance, and Marketing. Fully isolated and secured.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md justify-center pt-4">
          <Link href="/register" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto px-8 h-12 bg-indigo-600 hover:bg-indigo-700 text-white text-base font-semibold shadow-xl shadow-indigo-500/30">
              Get Started Free →
            </Button>
          </Link>
          <Link href="/login" className="w-full sm:w-auto">
            <Button size="lg" variant="outline" className="w-full sm:w-auto px-8 h-12 border-slate-700 bg-slate-900/50 hover:bg-slate-800 text-white text-base font-semibold">
              Sign In
            </Button>
          </Link>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-16 w-full text-left">
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur hover:border-indigo-500/50 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
              ⚡
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">24/7 Autonomous Agents</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Support customers, qualify leads, and detect low stock automatically without human intervention.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur hover:border-indigo-500/50 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
              🛡️
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Strict Tenant Isolation</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Multi-tenant architecture ensuring complete data privacy, RBAC permissions, and encrypted webhooks.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur hover:border-indigo-500/50 transition-all group">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
              📊
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">HITL & Verification</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Human-in-the-loop approval gates for high-value actions, discounts, and purchase orders.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 px-6 lg:px-16 text-center text-xs text-slate-500">
        <p>© 2026 AI Workforce Platform. Production Ready — All rights reserved.</p>
      </footer>
    </div>
  );
}
