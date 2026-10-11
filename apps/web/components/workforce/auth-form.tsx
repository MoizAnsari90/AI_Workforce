"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowUpRight, Check, CircleAlert, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { AuthShell } from "./public-shell";

export function AuthForm({ register: isRegister = false }: { register?: boolean }) {
  const { login } = useAuth();
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);
  const lock = useRef(false);
  const schema = z.object({ tenantName: z.string().min(isRegister ? 2 : 0, "Use at least 2 characters for your workspace name."), email: z.string().email("Enter a valid email address."), password: z.string().min(1, "Enter your password.") });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { tenantName: "", email: "", password: "" } });
  async function submit(values: z.infer<typeof schema>) {
    if (lock.current || created) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (isRegister) {
        const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
        if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message || "Couldn't create your workspace. Please try again."); }
        setCreated(true);
      } else { await login({ email: values.email, password: values.password }); }
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't connect. Please try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <AuthShell register={isRegister}><p className="wf-eyebrow">{isRegister ? "YOUR NEXT CHAPTER STARTS HERE" : "WELCOME TO YOUR WORKSPACE"}</p><h1>{isRegister ? <>Make room for<br /><span>better work.</span></> : <>Welcome<br /><span>back.</span></>}</h1><p className="wf-auth-description">{isRegister ? "Create a workspace for your business and start building your AI team." : "Your business, your conversations and your AI team. Right where you left them."}</p>
    {error && <div className="wf-notice wf-notice-error" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}
    {created ? <div className="wf-registration-success" role="status"><span className="wf-empty-icon"><Check size={29} /></span><h2>Your workspace is ready.</h2><p>Sign in with your email and password to get started.</p><a className="wf-button wf-button-primary wf-button-full" href="/login">Continue to sign in <ArrowUpRight size={16} /></a></div> : <form noValidate onSubmit={form.handleSubmit(submit)} className="wf-auth-form">
      {isRegister && <div><label className="wf-field-label" htmlFor="tenantName">Workspace name</label><input className="wf-field" id="tenantName" placeholder="Your business name" autoComplete="organization" aria-invalid={!!form.formState.errors.tenantName} aria-describedby={form.formState.errors.tenantName ? "tenant-error" : undefined} {...form.register("tenantName")} />{form.formState.errors.tenantName && <p id="tenant-error" className="wf-field-error">{form.formState.errors.tenantName.message}</p>}</div>}
      <div><label className="wf-field-label" htmlFor="email">Work email</label><input className="wf-field" id="email" type="email" placeholder="you@company.com" autoComplete="email" aria-invalid={!!form.formState.errors.email} aria-describedby={form.formState.errors.email ? "email-error" : undefined} {...form.register("email")} />{form.formState.errors.email && <p id="email-error" className="wf-field-error">{form.formState.errors.email.message}</p>}</div>
      <div><label className="wf-field-label" htmlFor="password">Password</label><div className="wf-password-field"><input className="wf-field" id="password" type={showPassword ? "text" : "password"} placeholder={isRegister ? "Create your password" : "Enter your password"} autoComplete={isRegister ? "new-password" : "current-password"} aria-invalid={!!form.formState.errors.password} aria-describedby={form.formState.errors.password ? "password-error" : undefined} {...form.register("password")} /><button type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{form.formState.errors.password && <p id="password-error" className="wf-field-error">{form.formState.errors.password.message}</p>}</div>
      <button className="wf-button wf-button-primary wf-button-full" type="submit" disabled={busy}>{busy ? isRegister ? "Creating workspace…" : "Signing in…" : isRegister ? "Create workspace" : "Enter workspace"}<ArrowUpRight size={17} /></button>
      <p className="wf-auth-note"><LockKeyhole size={13} />{isRegister ? "Connect your business tools after signing in." : "Sign in to access your business workspace."}</p>
    </form>}
  </AuthShell>;
}
