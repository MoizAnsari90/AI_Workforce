"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";

type Connection = { connected: boolean; phoneNumber?: string | null; verifiedName?: string | null; status?: string; expiresAt?: string | null };
type SignupConfig = { appId: string; configId: string; graphApiVersion: string };
type MetaLoginResponse = { authResponse?: { code?: string } };
declare global { interface Window { FB?: { init: (options: Record<string, unknown>) => void; login: (callback: (response: MetaLoginResponse) => void, options: Record<string, unknown>) => void }; fbAsyncInit?: () => void } }

export default function WhatsAppSettingsPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const signupAssets = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});
  const completionStarted = useRef(false);

  const refresh = useCallback(async () => {
    if (!user?.tenantId) return;
    try {
      const [configResponse, connectionResponse] = await Promise.all([
        fetch("/api/proxy/whatsapp/onboarding/config"),
        fetch("/api/proxy/whatsapp/onboarding/connection"),
      ]);
      const configJson = await configResponse.json();
      const connectionJson = await connectionResponse.json();
      if (configResponse.ok) setConfig(configJson.data);
      else setNotice(configJson.error?.message || "WhatsApp setup is not available yet.");
      if (connectionResponse.ok) setConnection(connectionJson.data);
    } catch { setNotice("Could not load WhatsApp connection status."); }
  }, [user?.tenantId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const completeSignup = useCallback(async () => {
    const assets = signupAssets.current;
    if (!assets.code || !assets.wabaId || !assets.phoneNumberId || completionStarted.current) return;
    completionStarted.current = true;
    setBusy(true);
    setNotice("Verifying your WhatsApp account and connecting message delivery…");
    try {
      const response = await fetch("/api/proxy/whatsapp/onboarding/embedded-signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: assets.code, wabaId: assets.wabaId, phoneNumberId: assets.phoneNumberId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "WhatsApp connection could not be completed.");
      setConnection(json.data);
      setNotice("WhatsApp connected. Send a message from your phone to test the connection.");
    } catch (error) {
      completionStarted.current = false;
      setNotice(error instanceof Error ? error.message : "WhatsApp connection failed.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!config) return;
    const scriptId = "facebook-jssdk";
    const initSdk = () => {
      window.FB?.init({ appId: config.appId, cookie: true, xfbml: false, version: config.graphApiVersion });
      setSdkLoaded(Boolean(window.FB));
    };
    if (window.FB) initSdk();
    else window.fbAsyncInit = initSdk;
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId; script.async = true; script.defer = true; script.crossOrigin = "anonymous";
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      document.body.appendChild(script);
    }
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith(".facebook.com") && event.origin !== "https://facebook.com") return;
      if (event.data?.type !== "WA_EMBEDDED_SIGNUP" || event.data?.event !== "FINISH") return;
      const data = event.data.data || {};
      signupAssets.current.wabaId = String(data.waba_id || "");
      signupAssets.current.phoneNumberId = String(data.phone_number_id || "");
      void completeSignup();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [config, completeSignup]);

  const beginSignup = () => {
    if (!config || !window.FB || !user || user.role !== "admin") return;
    signupAssets.current = {};
    completionStarted.current = false;
    setBusy(true); setNotice("Complete the secure Meta setup window to connect your business number.");
    window.FB.login((response) => {
      const code = response.authResponse?.code;
      if (!code) { setBusy(false); setNotice("WhatsApp setup was cancelled or not approved. You can try again."); return; }
      signupAssets.current.code = code;
      void completeSignup();
    }, {
      config_id: config.configId,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {} },
    });
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect this WhatsApp number from AI Workforce?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/proxy/whatsapp/onboarding/connection", { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "Could not disconnect WhatsApp.");
      setConnection({ connected: false }); setNotice("WhatsApp disconnected from this workspace.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not disconnect WhatsApp."); }
    finally { setBusy(false); }
  };

  const isAdmin = user?.role === "admin";
  return <main className="mx-auto max-w-5xl space-y-8 text-slate-100">
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Workspace connections</p>
      <h1 className="mt-2 font-serif text-3xl font-bold text-white">Connect WhatsApp</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">Use Meta’s secure setup to choose your WhatsApp Business account and number. AI Workforce never asks you to copy API tokens or Phone Number IDs.</p>
    </header>
    {notice && <div role="status" className="rounded-xl border border-cyan-900 bg-cyan-950/40 px-4 py-3 text-sm text-cyan-100">{notice}</div>}
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold text-white">WhatsApp Business Platform</h2><p className="mt-1 text-sm text-slate-400">Connect a number for customer support and AI replies.</p></div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connection?.connected ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{connection?.connected ? "Connected" : "Not connected"}</span>
      </div>
      {connection?.connected ? <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
        <div><p className="font-medium text-white">{connection.verifiedName || "WhatsApp Business"}</p><p className="text-sm text-slate-400">{connection.phoneNumber || "Connected number"}</p></div>
        {isAdmin && <button onClick={() => void disconnect()} disabled={busy} className="rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300 disabled:opacity-50">Disconnect</button>}
        <div className="mt-4 flex flex-wrap gap-3">
          {isAdmin && <button onClick={beginSignup} disabled={busy || !config || !sdkLoaded} className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50">Reconnect with Meta</button>}
          {connection.status === "reconnect_soon" && <p className="self-center text-xs text-amber-300">Meta access may expire soon. Reconnect to avoid message delivery stopping.</p>}
        </div>
      </div> : <div className="mt-6 space-y-4 border-t border-slate-800 pt-5">
        <ol className="list-inside list-decimal space-y-2 text-sm text-slate-300"><li>Sign in to Meta and select your business.</li><li>Select or register the WhatsApp number you want to connect.</li><li>Approve access and return here; we will verify the connection.</li></ol>
        <button onClick={beginSignup} disabled={!isAdmin || !config || !sdkLoaded || busy} className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Waiting for Meta…" : !sdkLoaded ? "Loading Meta…" : "Connect with Meta"}</button>
        {!isAdmin && <p className="text-xs text-amber-300">Ask a workspace admin to connect WhatsApp.</p>}
        {isAdmin && !config && <p className="text-xs text-amber-300">Meta Embedded Signup needs to be configured by the AI Workforce platform administrator first.</p>}
      </div>}
    </section>
  </main>;
}
