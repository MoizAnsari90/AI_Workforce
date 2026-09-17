"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import Link from "next/link";

const formSchema = z.object({
  tenantName: z.string().min(2, "Tenant name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export default function RegisterPage() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { tenantName: "", email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(values),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        alert("Registration successful! Please log in with your new account.");
        window.location.href = "/login";
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error?.message || "Registration failed. Email might already be in use.");
      }
    } catch (e: any) {
      alert("Network error during registration: " + (e.message || "Unknown error"));
    }
  }

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
            Multi-Tenant Autonomous SaaS
          </div>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight">
            Deploy Your <br />
            <span className="bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              AI Employees
            </span> <br />
            in Minutes
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            Create your tenant organization and provision autonomous agents for support, sales, marketing, operations, and finance.
          </p>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-6">
          <span>Tenant Isolated</span>
          <span>•</span>
          <span>RBAC Protected</span>
          <span>•</span>
          <span>Audit Logged</span>
        </div>
      </div>

      {/* Right Register Form Panel */}
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
              Already have an account?{" "}
              <Link href="/login" className="text-indigo-600 font-semibold hover:underline">
                Sign in →
              </Link>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">Create your tenant account</h2>
            <p className="text-sm text-slate-500">Register your organization and administrator profile.</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="tenantName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Tenant Name / Organization</FormLabel>
                    <FormControl>
                      <Input placeholder="NovaMart Electronics" className="h-11 bg-slate-50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Admin Email</FormLabel>
                    <FormControl>
                      <Input placeholder="admin@novamart.com" className="h-11 bg-slate-50" {...field} />
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
                    <FormLabel className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" className="h-11 bg-slate-50" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-lg shadow-indigo-500/20">
                Register Organization
              </Button>
            </form>
          </Form>

          <p className="text-center text-xs text-slate-400">
            © 2026 AI Workforce. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
