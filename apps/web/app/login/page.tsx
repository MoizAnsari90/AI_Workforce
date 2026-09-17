"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import Link from "next/link";

const formSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const { login } = useAuth();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-slate-950 text-white">
      {/* Left Branding Panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 border-r border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/30">
            AI
          </div>
          <span className="text-xl font-semibold tracking-tight">AI Workforce</span>
        </div>

        <div className="space-y-6 max-w-lg">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
            Trusted by 1000+ businesses
          </div>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight">
            Build Your <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              AI-Powered Team
            </span> <br />
            Today
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Automate tasks, boost productivity, and scale your business with intelligent AI employees across Support, Sales, Operations, and Finance.
          </p>

          <div className="grid grid-cols-1 gap-4 pt-4">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">⚡</div>
              <div>
                <h4 className="text-sm font-semibold">24/7 Availability</h4>
                <p className="text-xs text-slate-400">Your AI team never sleeps.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">🛡️</div>
              <div>
                <h4 className="text-sm font-semibold">Secure & Isolated</h4>
                <p className="text-xs text-slate-400">Strict multi-tenant security.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-6">
          <span>Secure</span>
          <span>•</span>
          <span>Scalable</span>
          <span>•</span>
          <span>Intelligent</span>
          <span>•</span>
          <span>Global</span>
        </div>
      </div>

      {/* Right Login Form Panel */}
      <div className="flex items-center justify-center p-8 lg:p-16 bg-white text-slate-900">
        <div className="w-full max-w-md space-y-8">
          <div className="flex justify-between items-center">
            <div className="lg:hidden flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-sm">
                AI
              </div>
              <span className="font-semibold">AI Workforce</span>
            </div>
            <div className="text-xs text-slate-500 ml-auto">
              Don't have an account?{" "}
              <Link href="/register" className="text-indigo-600 font-semibold hover:underline">
                Register →
              </Link>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Sign in to your account</h2>
            <p className="text-sm text-slate-500">Enter your credentials to access your AI workforce.</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(login)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Email Address</FormLabel>
                    <FormControl>
                      <Input placeholder="you@company.com" className="h-11 bg-slate-50" {...field} />
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
                    <div className="flex justify-between items-center">
                      <FormLabel className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Password</FormLabel>
                      <span className="text-xs text-indigo-600 hover:underline cursor-pointer">Forgot password?</span>
                    </div>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" className="h-11 bg-slate-50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-lg shadow-indigo-500/20">
                Sign In
              </Button>
            </form>
          </Form>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="text-indigo-600 text-lg">🔒</div>
            <div>
              <h5 className="text-xs font-semibold text-slate-800">Your data is protected</h5>
              <p className="text-[11px] text-slate-500">Enterprise-grade security with tenant isolation.</p>
            </div>
          </div>

          <p className="text-center text-xs text-slate-400">
            © 2026 AI Workforce. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
