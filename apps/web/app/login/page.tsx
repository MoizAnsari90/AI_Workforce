"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { useToast } from "@/contexts/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import Link from "next/link";
import { useState } from "react";

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const { login } = useAuth();
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });

  async function handleLogin(values: z.infer<typeof formSchema>) {
    setSubmitting(true);
    try {
      await login(values);
      showToast("Signed in successfully! Redirecting to command center...", "success", "Welcome");
    } catch (err: any) {
      showToast(err.message || "Invalid credentials. Please verify your email and password.", "error", "Sign In Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-[#040914] text-white">
      {/* Left Form Panel */}
      <div className="flex flex-col justify-between p-8 lg:p-16 border-r border-slate-900">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center font-bold text-cyan-400 glow-cyan">
            ✦
          </div>
          <div>
            <span className="text-base font-bold tracking-wider uppercase block text-white">workforce</span>
            <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-medium">Autonomous Operations</span>
          </div>
        </div>

        <div className="space-y-6 max-w-md mx-auto w-full py-10">
          <div className="space-y-2">
            <span className="text-xs font-semibold text-cyan-400 tracking-wider uppercase">Your AI command center</span>
            <h1 className="text-4xl lg:text-5xl font-bold tracking-tight font-serif text-white">
              Welcome back.
            </h1>
            <p className="text-slate-400 text-sm">
              Sign in to continue orchestrating your autonomous operations.
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleLogin)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Work email</FormLabel>
                    <FormControl>
                      <Input placeholder="you@company.com" className="h-12 bg-slate-900/80 border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500 focus:ring-cyan-500 rounded-xl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" className="h-12 bg-slate-900/80 border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500 focus:ring-cyan-500 rounded-xl" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold shadow-lg glow-cyan rounded-xl transition-all"
              >
                {submitting ? "Signing in..." : "Enter workspace ↗"}
              </Button>
            </form>
          </Form>

          <div className="relative flex py-2 items-center">
            <div className="flex-grow border-t border-slate-800"></div>
            <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase tracking-wider">or continue with</span>
            <div className="flex-grow border-t border-slate-800"></div>
          </div>

          <button className="w-full h-12 bg-slate-900/80 border border-slate-800 hover:bg-slate-800 rounded-xl text-xs font-semibold flex items-center justify-center gap-3 transition-colors text-slate-200">
            <span>🌐</span>
            <span>Continue with Google</span>
          </button>
        </div>

        <div className="text-xs text-slate-500 flex items-center justify-between">
          <span>New to workforce?</span>
          <Link href="/register" className="text-cyan-400 font-semibold hover:underline">
            Create an account
          </Link>
        </div>
      </div>

      {/* Right Animated Upright Orbital Cyberpunk Panel */}
      <div className="hidden lg:flex flex-col items-center justify-center relative p-12 bg-[#040914] overflow-hidden">
        {/* Concentric Orbital Rings */}
        <div className="absolute w-[500px] h-[500px] rounded-full border border-cyan-500/15"></div>
        <div className="absolute w-[360px] h-[360px] rounded-full border border-indigo-500/20"></div>
        <div className="absolute w-[220px] h-[220px] rounded-full border border-cyan-400/30"></div>

        {/* Central Glowing Brain Node */}
        <div className="relative z-10 flex flex-col items-center justify-center">
          <div className="w-24 h-24 rounded-full bg-cyan-500/10 border-2 border-cyan-400 flex items-center justify-center text-cyan-300 text-3xl animate-pulse-glow glow-cyan-lg">
            🧠
          </div>
        </div>

        {/* 6 Upright Orbiting Agent Nodes */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute orbit-1 pointer-events-auto">
            <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-cyan-500/60 text-xs font-medium text-cyan-300 flex items-center gap-2 glow-cyan shadow-xl">
              <span>🤖</span> Support AI
            </div>
          </div>
          <div className="absolute orbit-2 pointer-events-auto">
            <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-indigo-500/60 text-xs font-medium text-indigo-300 flex items-center gap-2 glow-cyan shadow-xl">
              <span>⚙️</span> Ops AI
            </div>
          </div>
          <div className="absolute orbit-3 pointer-events-auto">
            <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-purple-500/60 text-xs font-medium text-purple-300 flex items-center gap-2 glow-cyan shadow-xl">
              <span>💼</span> Sales AI
            </div>
          </div>
          <div className="absolute orbit-4 pointer-events-auto">
            <div className="px-3.5 py-2 rounded-xl bg-slate-900/95 border border-emerald-500/60 text-xs font-medium text-emerald-300 flex items-center gap-2 glow-cyan shadow-xl">
              <span>🚀</span> Mktg AI
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

        <div className="absolute bottom-12 text-center space-y-1 z-25">
          <div className="text-xs text-slate-400">6 specialized agents ready to work</div>
          <div className="text-sm font-semibold text-white tracking-wide">Autonomous, connected, always on.</div>
          <div className="text-[11px] text-slate-500">Your operation moves forward while you focus on what matters.</div>
        </div>
      </div>
    </div>
  );
}
