"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, LockKeyhole, MessageCircle, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { ProviderMark } from "@/components/workforce/brand";
import { PageHeading } from "@/components/workforce/page-kit";
import { parseWhatsAppSignupEvent, signupWaitingMessage } from "@/lib/whatsapp-signup";

type Connection = { connected: boolean; deliveryVerified?: boolean; phoneNumber?: string | null; verifiedName?: string | null; status?: string; expiresAt?: string | null; registrationStatus?: string; verificationTest?: { id?: string; status: string; inboundReceived: boolean; replyStatus: string | null; expiresAt?: string; deliveredAt?: string | null } | null };
type SignupConfig = { appId: string; configId: string; graphApiVersion: string };
type MetaLoginResponse = { authResponse?: { code?: string } };
declare global { interface Window { FB?: { init: (options: Record<string, unknown>) => void; login: (callback: (response: MetaLoginResponse) => void, options: Record<string, unknown>) => void }; fbAsyncInit?: () => void } }

export default function WhatsAppSettingsPage() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loading, setLoading] = useState(true);
  const [sdkError, setSdkError] = useState(false);
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [registrationPin, setRegistrationPin] = useState("");
  const [confirmCloudApi, setConfirmCloudApi] = useState(false);
  const [confirmTestPhone, setConfirmTestPhone] = useState(false);
  const signupAssets = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string }>({});
  const completionStarted = useRef(false);
  const signupPending = useRef(false);
  const attempt = useRef(0);
  const signupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signupRequest = useRef<AbortController | null>(null);

  const cancelSignup = useCallback((message: string) => {
    attempt.current += 1;
    signupPending.current = false;
    completionStarted.current = false;
    signupAssets.current = {};
    if (signupTimer.current) clearTimeout(signupTimer.current);
    signupRequest.current?.abort();
    setBusy(false); setNotice(message);
  }, []);

  useEffect(() => () => {
    attempt.current += 1; signupPending.current = false;
    if (signupTimer.current) clearTimeout(signupTimer.current);
    signupRequest.current?.abort();
  }, [user?.tenantId]);

  const refresh = useCallback(async () => {
    if (!user?.tenantId) return;
    if (user.role !== "admin") { setLoading(false); return; }
    setLoading(true); setNotice("");
    try {
      const [configResponse, connectionResponse] = await Promise.all([
        fetch("/api/proxy/whatsapp/onboarding/config"),
        fetch("/api/proxy/whatsapp/onboarding/connection"),
      ]);
      const configJson = await configResponse.json();
      const connectionJson = await connectionResponse.json();
      if (configResponse.ok) setConfig(configJson.data);
      else { setConfig(null); setNotice(configJson.error?.message || "WhatsApp setup is not available yet."); }
      if (connectionResponse.ok) setConnection(connectionJson.data);
      else { setConnection(null); setNotice(connectionJson.error?.message || "Could not load WhatsApp connection status."); }
    } catch { setConnection(null); setNotice("Could not load WhatsApp connection status."); }
    finally { setLoading(false); }
  }, [user?.tenantId, user?.role]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const test = connection?.verificationTest;
    if (!test || !['awaiting_inbound', 'inbound_received'].includes(test.status) || test.replyStatus === 'failed' || test.replyStatus === 'unknown') return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch('/api/proxy/whatsapp/onboarding/connection');
        if (!response.ok) return;
        const json = await response.json();
        setConnection(json.data);
      } catch { /* Status can be refreshed manually if the connection is offline. */ }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connection?.verificationTest?.id, connection?.verificationTest?.status, connection?.verificationTest?.replyStatus]);

  const completeSignup = useCallback(async () => {
    const assets = signupAssets.current;
    if (!signupPending.current || !assets.code || !assets.wabaId || !assets.phoneNumberId || completionStarted.current) return;
    const currentAttempt = attempt.current;
    completionStarted.current = true;
    if (signupTimer.current) clearTimeout(signupTimer.current);
    const controller = new AbortController(); signupRequest.current = controller;
    signupTimer.current = setTimeout(() => controller.abort(), 60_000);
    setBusy(true);
    setNotice("Verifying your WhatsApp account and connecting message delivery…");
    try {
      const response = await fetch("/api/proxy/whatsapp/onboarding/embedded-signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ code: assets.code, wabaId: assets.wabaId, phoneNumberId: assets.phoneNumberId }),
      });
      const json = await response.json();
      if (currentAttempt !== attempt.current) return;
      if (!response.ok) throw new Error(json.error?.message || "WhatsApp connection could not be completed.");
      setConnection(json.data);
      setNotice("WhatsApp connection saved. Complete number setup and test message delivery before enabling automatic replies.");
    } catch (error) {
      if (currentAttempt !== attempt.current) return;
      completionStarted.current = false;
      setNotice(controller.signal.aborted ? "Setup took too long. Refresh status to check whether the connection was saved before starting again." : error instanceof Error ? error.message : "WhatsApp connection failed.");
    } finally { if (currentAttempt === attempt.current) { signupPending.current = false; signupAssets.current = {}; if (signupTimer.current) clearTimeout(signupTimer.current); setBusy(false); } }
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
      script.onerror = () => setSdkError(true);
      document.body.appendChild(script);
    }
    const onMessage = (event: MessageEvent) => {
      if (!signupPending.current || completionStarted.current) return;
      const result = parseWhatsAppSignupEvent(event.origin, event.data);
      if (!result) return;
      if (result.type !== 'finish') {
        cancelSignup(result.type === 'cancel' ? 'WhatsApp setup was cancelled. You can try again.' : result.type === 'unsupported' ? 'This number needs an assisted connection. Contact your workspace administrator; do not remove your existing WhatsApp account.' : result.type === 'needs_phone_number' ? 'Meta connected the business account, but no Cloud API phone number was selected. Restart setup and finish adding or selecting a phone number.' : 'Meta could not complete number selection. Restart setup and select your business number.');
        return;
      }
      signupAssets.current.wabaId = result.wabaId;
      signupAssets.current.phoneNumberId = result.phoneNumberId;
      if (!signupAssets.current.code) setNotice(signupWaitingMessage(signupAssets.current));
      void completeSignup();
    };
    window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("message", onMessage); if (window.fbAsyncInit === initSdk) window.fbAsyncInit = undefined; };
  }, [config, completeSignup, cancelSignup]);

  const beginSignup = () => {
    if (!config || !window.FB || !user || user.role !== "admin" || signupPending.current || busy) return;
    if (window.location.protocol !== 'https:') {
      setNotice('Meta requires HTTPS. Open this dashboard using https://localhost:3000 for local development, then sign in and retry.');
      return;
    }
    const currentAttempt = ++attempt.current;
    signupPending.current = true;
    signupAssets.current = {};
    completionStarted.current = false;
    setBusy(true); setNotice("Complete the secure Meta setup window to connect your business number.");
    signupTimer.current = setTimeout(() => cancelSignup(signupWaitingMessage(signupAssets.current, true)), 180_000);
    try { window.FB.login((response) => {
      if (currentAttempt !== attempt.current || !signupPending.current) return;
      const code = response.authResponse?.code;
      if (!code) { cancelSignup("WhatsApp setup was cancelled or not approved. You can try again."); return; }
      signupAssets.current.code = code;
      if (!signupAssets.current.wabaId || !signupAssets.current.phoneNumberId) setNotice(signupWaitingMessage(signupAssets.current));
      void completeSignup();
    }, {
      config_id: config.configId,
      auth_type: "rerequest",
      response_type: "code",
      override_default_response_type: true,
      // Embedded Signup v4 is selected in the Meta Login for Business config.
      // Do not send the v2/v3 sessionInfoVersion or a legacy version override.
      extras: {},
    }); } catch { cancelSignup('Meta setup could not open. Allow popups for this site and try again.'); }
  };

  const disconnect = async () => {
    if (!window.confirm(t("Disconnect this WhatsApp number from AI Workforce?"))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/proxy/whatsapp/onboarding/connection", { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "Could not disconnect WhatsApp.");
      setConnection({ connected: false }); setNotice("WhatsApp disconnected from this workspace.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not disconnect WhatsApp."); }
    finally { setBusy(false); }
  };

  const setNumberRegistration = async (mode: 'register' | 'already_registered') => {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/proxy/whatsapp/onboarding/connection/registration', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, confirmCloudApiNumber: confirmCloudApi, ...(mode === 'register' ? { pin: registrationPin } : {}) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || 'Could not confirm number registration.');
      setRegistrationPin(''); setConfirmCloudApi(false);
      await refresh();
      setNotice(json.data.message);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not register this number.'); }
    finally { setBusy(false); }
  };

  const beginDeliveryTest = async () => {
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/proxy/whatsapp/onboarding/connection/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmUseOfTestPhone: confirmTestPhone }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || 'Could not start the WhatsApp test.');
      setConfirmTestPhone(false);
      setConnection(current => current ? { ...current, verificationTest: json.data } : current);
      setNotice(`From another phone, send ${json.data.code} to ${json.data.phoneNumber || 'your connected WhatsApp number'} within 10 minutes.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not start the WhatsApp test.'); }
    finally { setBusy(false); }
  };

  return <div className="wf-page wf-whatsapp-page">
    <Link className="wf-back-link" href="/dashboard/integrations"><ArrowLeft size={15} />{t("All integrations")}</Link>
    <PageHeading eyebrow={t("CLOSER TO YOUR CUSTOMERS")} title={t("Connect the conversation.")} description={t("Bring your WhatsApp Business number into your workforce.")}><button className="wf-button wf-button-secondary" disabled={loading || busy || !isAdmin} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? "wf-spin" : ""} />{t("Refresh status")}</button></PageHeading>
    {notice && <div role="status" className="wf-notice">{t(notice)}</div>}
    <div className="wf-onboarding-grid">
      <section className="wf-panel wf-whatsapp-setup">
        <div className="wf-provider-top"><ProviderMark provider="whatsapp" /><span className={`wf-badge ${connection?.connected && connection.deliveryVerified ? "wf-badge-mint" : connection?.connected ? "wf-badge-amber" : ""}`}>{loading ? t("Checking connection") : !isAdmin ? t("Admin access") : connection?.status === 'reconnect_required' ? t("Reconnect required") : connection?.status === 'reconnect_soon' ? t("Reconnect soon") : connection?.connected && connection.deliveryVerified ? t("Delivery verified") : connection?.connected ? t("Connected · Test required") : connection ? t("Not connected") : t("Status unavailable")}</span></div>
        <h2>{t("WhatsApp Business")}</h2><p className="wf-setup-description">{t("Your customer conversations, connected to your AI team.")}</p>
        {connection?.connected ? <div className="wf-connected-whatsapp">
          <div className="wf-connected-account"><span className="wf-account-check"><Check size={16} /></span><div><strong>{connection.verifiedName || t("WhatsApp Business")}</strong><span>{connection.phoneNumber || t("Connected number")}</span></div></div>
          <div className="wf-access-note"><MessageCircle size={21} /><div><strong>{t("Connection saved. Delivery still needs testing.")}</strong><p>{t("Confirm this number is registered in WhatsApp Manager, configure your business workflow, then send a message from another phone. Check that the message arrives and the reply is delivered.")}</p></div></div>
          {connection.registrationStatus === 'required' ? <div className="wf-niche-section">
            <h3>{t("Register this Cloud API number")}</h3>
            <p>{t("Only continue if Meta Embedded Signup selected a number for the WhatsApp Cloud API. Do not use a number that is still active in WhatsApp Messenger or WhatsApp Business App, and do not migrate an existing number here. Coexistence or migration needs a separate supported Meta flow.")}</p>
            <label className="wf-permission"><input type="checkbox" checked={confirmCloudApi} disabled={busy} onChange={event => setConfirmCloudApi(event.target.checked)} /><span><strong>{t("I checked the number in WhatsApp Manager.")}</strong><small>{t("This is a Cloud API number and I am not migrating an app number through this step.")}</small></span></label>
            <label className="wf-field-label" htmlFor="whatsapp-registration-pin">{t("Choose a six-digit two-step verification PIN")}</label>
            <input id="whatsapp-registration-pin" className="wf-field" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={registrationPin} onChange={event => setRegistrationPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t("6 digits")} disabled={busy || !confirmCloudApi} />
            <p className="wf-field-hint">{t("Save this PIN somewhere secure. It is sent to Meta for number registration and is not stored by AI Workforce.")}</p>
            <button className="wf-button wf-button-primary" disabled={busy || !confirmCloudApi || registrationPin.length !== 6} onClick={() => void setNumberRegistration('register')}>{t("Register number with Meta")} <ArrowUpRight size={15} /></button>
            <button className="wf-text-button" disabled={busy || !confirmCloudApi} onClick={() => void setNumberRegistration('already_registered')}>{t("This number is already registered for Cloud API")}</button>
          </div> : <>
            <div className="wf-access-note"><ShieldCheck size={20} /><div><strong>{connection.registrationStatus === 'registered' ? t("Meta confirmed number registration.") : t("Existing registration noted; delivery test will verify it.")}</strong><p>{t("Next, test a real message exchange with a phone you control. This is separate from enabling automatic customer replies.")}</p></div></div>
            <div className="wf-niche-section">
              <h3>{t("Test messages both ways")}</h3>
              {connection.verificationTest?.status === 'passed' ? <div className="wf-access-note"><Check size={20} /><div><strong>{t("WhatsApp delivery test passed")}</strong><p>{t("Inbound message, reply and Meta delivery receipt were recorded")}{connection.verificationTest.deliveredAt ? t(" at {time}", { time: new Date(connection.verificationTest.deliveredAt).toLocaleString(locale) }) : ''}{t(". Automatic replies are still controlled separately in the business workflow.")}</p></div></div> : <>
                {connection.verificationTest && <p role="status" className="wf-setup-help">{connection.verificationTest.status === 'awaiting_inbound' ? t("Waiting for the test phrase on {phone}. Expires {time}.", { phone: connection.phoneNumber || t("your business number"), time: connection.verificationTest.expiresAt ? new Date(connection.verificationTest.expiresAt).toLocaleTimeString(locale) : t("soon") }) : connection.verificationTest.status === 'inbound_received' && !connection.verificationTest.replyStatus ? t("Inbound received. The secure reply is queued.") : connection.verificationTest.replyStatus === 'accepted' ? t("Meta accepted the reply. Waiting for its delivery receipt.") : connection.verificationTest.replyStatus === 'failed' || connection.verificationTest.replyStatus === 'unknown' ? t("Reply delivery needs attention. Check Meta activity before sending another test.") : connection.verificationTest.status === 'expired' ? t("The previous test expired. Start a new one.") : t("Start a test and follow the instructions shown here.")}</p>}
                <label className="wf-permission"><input type="checkbox" checked={confirmTestPhone} disabled={busy} onChange={event => setConfirmTestPhone(event.target.checked)} /><span><strong>{t("I will use a phone I control to send this test.")}</strong><small>{t("The test sends one reply to that phone. Do not use a customer number.")}</small></span></label>
                <button className="wf-button wf-button-secondary" disabled={busy || !confirmTestPhone || (connection.verificationTest?.status === 'inbound_received' && (!connection.verificationTest.replyStatus || ['pending', 'processing', 'accepted'].includes(connection.verificationTest.replyStatus)))} onClick={() => void beginDeliveryTest()}>{connection.verificationTest?.status === 'awaiting_inbound' ? t("Replace test phrase") : t("Start WhatsApp delivery test")} <ArrowUpRight size={15} /></button>
              </>}
            </div>
          </>}
          {connection.status === "reconnect_required" && <div role="alert" className="wf-notice wf-reconnect-notice">{t("Meta access has expired or cannot be verified. Reconnect before using this number.")}</div>}
          {connection.status === "reconnect_soon" && <div className="wf-notice wf-reconnect-notice">{t("Meta access may expire soon. Reconnect to keep message delivery working.")}</div>}
          <div className="wf-setup-actions">{isAdmin && <><button onClick={beginSignup} disabled={busy || loading || !config || !sdkLoaded} className="wf-button wf-button-secondary">{t("Reconnect with Meta")} <ArrowUpRight size={15} /></button><button onClick={() => void disconnect()} disabled={busy || loading} className="wf-disconnect"><Unplug size={14} />{t("Disconnect")}</button></>}</div>
        </div> : <div className="wf-setup-flow">
          <ol className="wf-setup-steps">{[
            ["Sign in to your business", "Use Meta's secure window to select your business account."],
            ["Choose your number", "Select or register the WhatsApp Business number you want to use."],
            ["Approve and connect", "Grant access and return here to verify the connection."]
          ].map(([title, description], index) => <li key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{t(title)}</h3><p>{t(description)}</p></div></li>)}</ol>
          <button onClick={beginSignup} disabled={!isAdmin || loading || !config || !sdkLoaded || busy} className="wf-button wf-button-primary wf-button-full">{busy ? t("Waiting for Meta…") : loading ? t("Checking setup…") : !isAdmin ? t("Admin access required") : !config ? t("Setup unavailable") : sdkError ? t("Meta could not load") : !sdkLoaded ? t("Loading Meta…") : t("Connect with Meta")}<ArrowUpRight size={16} /></button>
        </div>}
        {!isAdmin && <p className="wf-setup-help">{t("Ask a workspace admin to connect and manage WhatsApp.")}</p>}
        {busy && signupPending.current && <button className="wf-text-button" onClick={() => cancelSignup('Setup stopped. Close the Meta popup and refresh status before retrying.')}>{t("Stop waiting")}</button>}
        {connection?.connected && <Link className="wf-text-button" href="/dashboard/settings/business">{t("Continue business setup")} <ArrowUpRight size={15} /></Link>}
        {isAdmin && !loading && !config && <p className="wf-setup-help">{t("Contact your platform administrator to enable WhatsApp setup.")}</p>}
        {sdkError && <p role="alert" className="wf-setup-help">{t("Meta could not load. Check your connection or browser blockers, then reload this page.")}</p>}
        <div className="wf-setup-security"><LockKeyhole size={14} />{t("Secure authorization through Meta")}</div>
      </section>
      <aside className="wf-onboarding-aside">
        <div className="wf-chat-illustration" aria-hidden="true"><span className="wf-message-orbit" /><div className="wf-illustration-bubble"><MessageCircle size={33} strokeWidth={1.5} /></div><span className="wf-illustration-check"><Check size={21} /></span></div>
        <p className="wf-eyebrow">{t("LESS SETUP. MORE CONNECTION.")}</p><h2>{t("Meet customers where they already are.")}</h2><p>{t("Keep your store and customer conversations in the same workspace, with access you control.")}</p>
        <ul className="wf-benefit-list"><li><Check size={16} />{t("No API tokens to copy")}</li><li><Check size={16} />{t("Choose your business number")}</li><li><Check size={16} />{t("Disconnect from this workspace anytime")}</li></ul>
        <div className="wf-access-note"><ShieldCheck size={20} /><div><strong>{t("Your business, your permissions.")}</strong><p>{t("Review the access requested in Meta before confirming your connection.")}</p></div></div>
      </aside>
    </div>
  </div>;
}
