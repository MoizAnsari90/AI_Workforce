import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#040914] text-white flex flex-col justify-between overflow-hidden relative">
      {/* Navbar */}
      <header className="border-b border-slate-900 bg-[#040914]/80 backdrop-blur-md sticky top-0 z-50 px-6 lg:px-16 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center font-bold text-cyan-400 glow-cyan">
            ✦
          </div>
          <div>
            <span className="text-base font-bold tracking-wider uppercase block text-white">workforce</span>
            <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-medium">Autonomous Operations</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button variant="ghost" className="text-slate-300 hover:text-white hover:bg-slate-900 text-xs font-semibold">
              Sign in ↗
            </Button>
          </Link>
          <Link href="/register">
            <Button className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg glow-cyan text-xs font-semibold rounded-xl">
              Register ↗
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section Split Layout */}
      <main className="flex-1 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center px-6 lg:px-16 py-12 lg:py-20">
        {/* Left Copy & Actions */}
        <div className="space-y-8 z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            AUTONOMOUS OPERATIONS, IN MOTION
          </div>

          <h1 className="text-5xl lg:text-7xl font-bold tracking-tight leading-none font-serif text-white">
            Let your AI team <br />
            <span className="text-cyan-400">work together.</span>
          </h1>

          <p className="text-slate-400 text-base lg:text-lg leading-relaxed max-w-lg">
            Agents talk, delegate, and complete work together — so your team can focus on the decisions that matter.
          </p>

          <div className="flex items-center gap-3 p-2 rounded-2xl bg-slate-900/80 border border-slate-800 max-w-md">
            <div className="px-3 py-1.5 rounded-xl bg-slate-800 text-cyan-300 text-xs font-medium">Support AI</div>
            <div className="text-slate-500 text-xs font-bold uppercase tracking-wider">DELEGATES</div>
            <div className="px-3 py-1.5 rounded-xl bg-slate-800 text-indigo-300 text-xs font-medium">Ops AI</div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <Link href="/register" className="w-full sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto px-8 h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold shadow-lg glow-cyan rounded-xl">
                Register ↗
              </Button>
            </Link>
            <Link href="/login" className="w-full sm:w-auto">
              <Button size="lg" variant="outline" className="w-full sm:w-auto px-8 h-12 border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl">
                Sign in ↗
              </Button>
            </Link>
          </div>
        </div>

        {/* Right Animated Upright Orbital Graph */}
        <div className="relative flex items-center justify-center h-[520px]">
          <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-[11px] font-medium text-slate-300 z-30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            LIVE SYSTEM
          </div>

          {/* Concentric Orbital Rings */}
          <div className="absolute w-[460px] h-[460px] rounded-full border border-cyan-500/15"></div>
          <div className="absolute w-[320px] h-[320px] rounded-full border border-indigo-500/20"></div>
          <div className="absolute w-[180px] h-[180px] rounded-full border border-cyan-400/30"></div>

          {/* Central AI Brain Node */}
          <div className="relative z-10 w-20 h-20 rounded-full bg-cyan-500/10 border-2 border-cyan-400 flex items-center justify-center text-cyan-300 text-2xl animate-pulse-glow glow-cyan-lg">
            🧠
          </div>

          {/* 6 Upright Orbiting Agent Cards */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="absolute orbit-1 pointer-events-auto">
              <div className="p-3 rounded-2xl bg-slate-900/95 border border-cyan-500/60 text-xs space-y-0.5 glow-cyan shadow-2xl">
                <div className="flex items-center gap-2 font-semibold text-cyan-300">
                  <span>🤖</span> Support AI
                </div>
                <div className="text-[10px] text-slate-400">New ticket needs routing</div>
              </div>
            </div>
            <div className="absolute orbit-2 pointer-events-auto">
              <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-indigo-500/60 text-xs font-medium text-indigo-300 flex items-center gap-2 glow-cyan shadow-xl">
                <span>⚙️</span> Ops AI <span className="text-[10px] text-emerald-400 bg-emerald-950 px-1 py-0.5 rounded">ACTIVE</span>
              </div>
            </div>
            <div className="absolute orbit-3 pointer-events-auto">
              <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-purple-500/60 text-xs font-medium text-purple-300 flex items-center gap-2 glow-cyan shadow-xl">
                <span>💼</span> Sales AI <span className="text-[10px] text-cyan-400 bg-cyan-950 px-1 py-0.5 rounded">READY</span>
              </div>
            </div>
            <div className="absolute orbit-4 pointer-events-auto">
              <div className="p-3 rounded-2xl bg-slate-900/95 border border-emerald-500/60 text-xs space-y-0.5 glow-cyan shadow-2xl">
                <div className="flex items-center gap-2 font-semibold text-emerald-300">
                  <span>⚙️</span> Ops AI
                </div>
                <div className="text-[10px] text-slate-400">On it — assigning workflow</div>
              </div>
            </div>
            <div className="absolute orbit-5 pointer-events-auto">
              <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-amber-500/60 text-xs font-medium text-amber-300 flex items-center gap-2 glow-cyan shadow-xl">
                <span>💳</span> Finance AI
              </div>
            </div>
            <div className="absolute orbit-6 pointer-events-auto">
              <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-cyan-400/60 text-xs font-medium text-cyan-200 flex items-center gap-2 glow-cyan shadow-xl">
                <span>🎙️</span> Voice AI
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer tagline */}
      <footer className="border-t border-slate-900 py-6 px-6 lg:px-16 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500">
        <p>© 2026 AI Workforce. No forms. No setup friction. Just a smarter way to work.</p>
        <div className="flex items-center gap-6 mt-2 sm:mt-0">
          <Link href="/login" className="hover:text-slate-300">Sign in</Link>
          <Link href="/register" className="hover:text-slate-300">Register</Link>
        </div>
      </footer>
    </div>
  );
}
