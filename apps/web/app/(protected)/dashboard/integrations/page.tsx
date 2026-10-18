"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, CircleAlert, LockKeyhole, MessageCircle, Plug, RefreshCw, ShieldCheck, Sparkles, Unplug } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { ProviderMark, WorkforceMark } from "@/components/workforce/brand";
import { workforceRequest } from "@/lib/workforce-api";

type ShopifyConnection = { connected: boolean; shop?: string; name?: string; scopes?: string[]; allowWrites?: boolean };
type WooConnection = { connected: boolean; storeUrl?: string; needsReconnect?: boolean };
type WhatsAppConnection = { connected: boolean; deliveryVerified?: boolean; phoneNumber?: string; verifiedName?: string; status?: string };
type Provider = "shopify" | "woocommerce" | "whatsapp";

export default function IntegrationsPage() {
  const { t } = useTranslation();
  const { user, tenant } = useAuth();
  const tenantId = user?.tenantId || tenant?.id;
  const isAdmin = user?.role === "admin";
  const [shop, setShop] = useState("");
  const [wooStoreUrl, setWooStoreUrl] = useState("");
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [woo, setWoo] = useState<WooConnection | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppConnection | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Provider, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const request = useRef<AbortController | null>(null);
  const actionLock = useRef(false);

  const load = useCallback(async () => {
    if (!tenantId) {
      setErrors({ shopify: "Workspace connection is unavailable. Refresh the page and sign in again.", woocommerce: "Workspace connection is unavailable. Refresh the page and sign in again.", whatsapp: "Workspace connection is unavailable. Refresh the page and sign in again." });
      setLoading(false);
      return;
    }
    if (!isAdmin) { setLoading(false); return; }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        workforceRequest<ShopifyConnection>(`/api/proxy/tenants/${tenantId}/shopify/connection`, { signal: controller.signal }),
        workforceRequest<WooConnection>("/api/proxy/woocommerce/connection", { signal: controller.signal }),
        workforceRequest<WhatsAppConnection>("/api/proxy/whatsapp/onboarding/connection", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted && !timedOut) return;
      setConnection(results[0].status === "fulfilled" ? results[0].value : null);
      setWoo(results[1].status === "fulfilled" ? results[1].value : null);
      setWhatsapp(results[2].status === "fulfilled" ? results[2].value : null);
      const nextErrors: Partial<Record<Provider, string>> = {};
      (["shopify", "woocommerce", "whatsapp"] as const).forEach((provider, index) => {
        const result = results[index];
        if (result.status === "rejected") nextErrors[provider] = timedOut ? "Checking timed out. Use Refresh status to try again." : result.reason instanceof Error ? result.reason.message : "Connection status is unavailable.";
      });
      setErrors(nextErrors);
    } finally {
      window.clearTimeout(timeout);
      if (!controller.signal.aborted || timedOut) setLoading(false);
    }
  }, [tenantId, isAdmin]);

  useEffect(() => { setConnection(null); setWoo(null); setWhatsapp(null); setErrors({}); void load(); return () => request.current?.abort(); }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shopifyResult = params.get("shopify"); const wooResult = params.get("woocommerce");
    if (!shopifyResult && !wooResult) return;
    const messages: Record<string, string> = {
      connected: "Shopify connected. Your workspace can now access your store.",
      invalid_callback: "Shopify couldn't verify the connection. Please try again.",
      expired_or_mismatched_state: "This connection request expired or the store didn't match. Please try again.",
      missing_permissions: "Shopify needs additional permissions. Please reconnect your store.",
      store_already_connected: "Disconnect the current Shopify store before choosing another.",
      connection_failed: "Shopify couldn't connect. Please try again or contact your workspace admin.",
    };
    setNotice(wooResult ? { message: wooResult === "connected" ? "WooCommerce authorization completed. Refreshing connection status..." : "WooCommerce connection wasn't completed.", error: wooResult !== "connected" } : { message: messages[shopifyResult!] || "Shopify connection wasn't completed.", error: shopifyResult !== "connected" });
    window.history.replaceState({}, "", "/dashboard/integrations");
    const timeout = window.setTimeout(() => void load(), 800);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function perform(name: string, action: () => Promise<void>) {
    if (!isAdmin || actionLock.current) return;
    actionLock.current = true; setBusy(name); setNotice(null);
    try { await action(); }
    catch (error) { setNotice({ message: error instanceof Error ? error.message : "The connection couldn't be updated. Please try again.", error: true }); }
    finally { actionLock.current = false; setBusy(null); }
  }
  const connectShopify = (selectedShop = shop) => perform("shopify-connect", async () => {
    const raw = selectedShop.trim().toLowerCase();
    const domain = raw.endsWith(".myshopify.com") ? raw : `${raw}.myshopify.com`;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new Error("Enter your Shopify store name or its myshopify.com domain, without https:// or a path.");
    const result = await workforceRequest<{ authorizationUrl: string }>(`/api/proxy/shopify/oauth/start?shop=${encodeURIComponent(domain)}`);
    window.location.assign(result.authorizationUrl);
  });
  const connectWoo = () => perform("woocommerce-connect", async () => {
    const result = await workforceRequest<{ authorizationUrl: string }>(`/api/proxy/woocommerce/oauth/start?storeUrl=${encodeURIComponent(wooStoreUrl.trim())}`);
    window.location.assign(result.authorizationUrl);
  });
  const disconnect = async (provider: "shopify" | "woocommerce") => {
    const message = provider === "shopify" ? "Disconnect Shopify? To fully revoke access, also uninstall AI Workforce from Shopify Admin > Apps." : "Disconnect this WooCommerce store from your workspace?";
    if (!window.confirm(t(message))) return;
    await perform(`${provider}-disconnect`, async () => {
      await workforceRequest(provider === "shopify" ? `/api/proxy/tenants/${tenantId}/shopify/connection` : "/api/proxy/woocommerce/connection", { method: "DELETE" });
      if (provider === "shopify") setConnection({ connected: false }); else setWoo({ connected: false });
      setNotice({ message: `${provider === "shopify" ? "Shopify" : "WooCommerce"} disconnected from your workspace.` });
    });
  };
  const setWrites = (enabled: boolean) => perform("shopify-writes", async () => {
    await workforceRequest(`/api/proxy/tenants/${tenantId}/shopify/connection/writes`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    setConnection(current => current ? { ...current, allowWrites: enabled } : current);
    setNotice({ message: enabled ? "Store changes enabled. Refunds and cancellations still require your approval." : "Store changes disabled." });
  });

  const status = (provider: Provider, connected?: boolean, reconnect = false) => <span className={`wf-badge ${reconnect || (provider === 'whatsapp' && connected && !whatsapp?.deliveryVerified) ? "wf-badge-amber" : connected && !errors[provider] ? "wf-badge-mint" : ""}`}>
    {loading ? <><RefreshCw size={11} className="wf-spin" />  {t("Checking")}</> : !isAdmin ? t("Admin access") : errors[provider] ? t("Status unavailable") : provider === 'whatsapp' && whatsapp?.status === 'reconnect_required' ? t("Reconnect required") : reconnect ? t("Reconnect soon") : provider === 'whatsapp' && connected && whatsapp?.deliveryVerified ? t("Delivery verified") : provider === 'whatsapp' && connected ? t("Connected · Test required") : connected ? <><span className="wf-status-dot" />  {t("Connected")}</> : t("Not connected")}
  </span>;
  const busyLabel = (action: string, label: string) => <>{busy === action ? <RefreshCw size={15} className="wf-spin" /> : <ArrowUpRight size={15} />}{busy === action ? t("Please wait...") : t(label)}</>;
  const storeConnected = Boolean(connection?.connected || woo?.connected);
  const connectionCount = Number(storeConnected) + Number(Boolean(whatsapp?.connected));

  return <div className="wf-page wf-integrations-page">
    <div className="wf-page-heading"><div><p className="wf-eyebrow">{t("YOUR TOOLS, WORKING TOGETHER")}</p><h1>{t("Connect your")} <span>{t("business.")}</span></h1><p>{t("Bring your store and customer conversations into one workspace.")}</p></div><button className="wf-button wf-button-secondary" disabled={loading || !isAdmin || !!busy} onClick={() => void load()}><RefreshCw size={15} className={loading ? "wf-spin" : ""} />  {t("Refresh status")}</button></div>
    <div className="wf-connection-banner"><div className="wf-connection-illustration" aria-hidden="true"><ProviderMark provider="shopify" /><span className="wf-connection-line" /><WorkforceMark /><span className="wf-connection-line" /><ProviderMark provider="whatsapp" /></div><div><h2>{t("A connected business starts here.")}</h2><p>{t("Choose your store, connect WhatsApp, then ask your workforce a question.")}</p></div><div className="wf-setup-count"><strong>{loading || !isAdmin || Object.keys(errors).length ? "—" : `${connectionCount}/2`}</strong><span>{t("channels connected")}</span></div></div>
    {!isAdmin && user && <div className="wf-notice"><LockKeyhole size={17} /><span>{t("A workspace admin can view and manage these connections.")}</span></div>}
    {notice && <div className={`wf-notice ${notice.error ? "wf-notice-error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.error ? <CircleAlert size={17} /> : <Check size={17} />}<span>{t(notice.message)}</span></div>}
    <div className="wf-integration-section-heading"><div><span className="wf-step-number">01</span><h2>{t("Your online store")}</h2></div><span>{t("Choose one store for this workspace")}</span></div>
    <div className="wf-store-grid">
      <section className={`wf-panel wf-provider-card ${connection?.connected ? "is-connected" : ""}`} aria-labelledby="shopify-title">
        <div className="wf-provider-top"><ProviderMark provider="shopify" />{status("shopify", connection?.connected)}</div>
        <h3 id="shopify-title">{t("Shopify")}</h3><p className="wf-provider-description">{t("Give your workforce access to inventory, orders and approved store actions.")}</p>
        <div className="wf-capabilities"><span><Check size={12} />  {t("Inventory lookup")}</span><span><ShieldCheck size={12} />  {t("Approval controls")}</span></div>
        {errors.shopify && <p role="alert" className="wf-inline-error">{errors.shopify}</p>}
        <div className="wf-provider-content">
          {loading ? <p className="wf-muted">{t("Checking your store connection...")}</p> : connection?.connected ? <>
            <div className="wf-connected-account"><span className="wf-account-check"><Check size={16} /></span><div><strong>{connection.name || t("Your Shopify store")}</strong><span>{connection.shop}</span></div></div>
            {!connection.scopes?.some(scope => scope === "read_products" || scope === "write_products") && <div className="wf-inline-error"><p>{t("Product-name search and low-stock reports need product access. Update permissions to enable them; your existing SKU lookup remains available.")}</p>{isAdmin && <button className="wf-button wf-button-secondary" disabled={!!busy || !connection.shop} onClick={() => void connectShopify(connection.shop)}>{busyLabel("shopify-connect", "Update Shopify permissions")}</button>}</div>}
            <label className="wf-permission"><input type="checkbox" checked={connection.allowWrites === true} disabled={!isAdmin || !!busy || !connection.scopes?.includes("write_orders")} onChange={event => void setWrites(event.target.checked)} /><span><strong>{t("Allow AI to make store changes")}</strong><small>{t("Refunds and cancellations still need your approval.")}</small></span></label>
            <details className="wf-permission-details"><summary>{t("View granted permissions")} <ChevronDown size={14} /></summary><div className="wf-scope-list">{connection.scopes?.map(scope => <span key={scope}>{readScope(scope)}</span>)}</div></details>
            <div className="wf-provider-footer"><span><ShieldCheck size={13} />  {t("Approval protected")}</span>{isAdmin && <button className="wf-disconnect" disabled={!!busy} onClick={() => void disconnect("shopify")}><Unplug size={13} />  {t("Disconnect")}</button>}</div>
          </> : <form onSubmit={event => { event.preventDefault(); void connectShopify(); }}>
            <label className="wf-field-label" htmlFor="shop-domain">{t("Store domain")}</label><input id="shop-domain" className="wf-field" value={shop} onChange={event => setShop(event.target.value)} placeholder={t("your-store.myshopify.com")} autoCapitalize="none" spellCheck={false} disabled={!isAdmin || !!busy || !!woo?.connected} required />
            <p className="wf-field-hint">{woo?.connected ? t("WooCommerce is connected. Disconnect it before switching to Shopify.") : t("Approve access securely on Shopify. No API keys to copy.")}</p>
            <button type="submit" disabled={!isAdmin || !!busy || !shop.trim() || !!woo?.connected} className="wf-button wf-button-primary wf-button-full">{busyLabel("shopify-connect", "Connect Shopify")}</button>
          </form>}
        </div>
      </section>
      <section className={`wf-panel wf-provider-card ${woo?.connected ? "is-connected" : ""}`} aria-labelledby="woo-title">
        <div className="wf-provider-top"><ProviderMark provider="woocommerce" />{status("woocommerce", woo?.connected, woo?.needsReconnect)}</div>
        <h3 id="woo-title">{t("WooCommerce")}</h3><p className="wf-provider-description">{t("Connect your WordPress store for product information and inventory answers.")}</p>
        <div className="wf-capabilities"><span><Check size={12} />  {t("Product data")}</span><span><LockKeyhole size={12} />  {t("Read-only access")}</span></div>
        {errors.woocommerce && <p role="alert" className="wf-inline-error">{errors.woocommerce}</p>}
        <div className="wf-provider-content">
          {loading ? <p className="wf-muted">{t("Checking your store connection...")}</p> : woo?.connected && !woo.needsReconnect ? <>
            <div className="wf-connected-account"><span className="wf-account-check"><Check size={16} /></span><div><strong>{t("Your WooCommerce store")}</strong><span>{woo.storeUrl}</span></div></div>
            <div className="wf-access-note"><ShieldCheck size={20} /><div><strong>{t("Your store stays in your control.")}</strong><p>{t("This connection reads store information. It doesn't make changes to your products or orders.")}</p></div></div>
            <div className="wf-provider-footer"><span><LockKeyhole size={13} />  {t("Read-only connection")}</span>{isAdmin && <button className="wf-disconnect" disabled={!!busy} onClick={() => void disconnect("woocommerce")}><Unplug size={13} />  {t("Disconnect")}</button>}</div>
          </> : <form onSubmit={event => { event.preventDefault(); void connectWoo(); }}>
            <label className="wf-field-label" htmlFor="woo-store-url">{t("Store address")}</label><input id="woo-store-url" type="url" className="wf-field" value={wooStoreUrl} onChange={event => setWooStoreUrl(event.target.value)} placeholder="https://your-store.com" autoCapitalize="none" spellCheck={false} required disabled={!isAdmin || !!busy || !!connection?.connected} />
            <p className="wf-field-hint">{connection?.connected ? t("Shopify is connected. Disconnect it before switching to WooCommerce.") : t("Approve read-only access on your own WordPress store.")}</p>
            <button type="submit" disabled={!isAdmin || !!busy || !wooStoreUrl.trim() || !!connection?.connected} className="wf-button wf-button-secondary wf-button-full">{busyLabel("woocommerce-connect", woo?.needsReconnect ? "Reconnect WooCommerce" : "Connect WooCommerce")}</button>
          </form>}
        </div>
      </section>
    </div>
    <div className="wf-integration-section-heading"><div><span className="wf-step-number">02</span><h2>{t("Customer conversations")}</h2></div><span>{t("Meet customers where they are")}</span></div>
    <section className="wf-panel wf-whatsapp-card"><div className="wf-whatsapp-main"><ProviderMark provider="whatsapp" /><div><div className="wf-whatsapp-title"><h3>{t("WhatsApp Business")}</h3>{status("whatsapp", whatsapp?.connected, whatsapp?.status === "reconnect_soon")}</div><p>{whatsapp?.connected ? [whatsapp.verifiedName, whatsapp.phoneNumber].filter(Boolean).join(" · ") || t("Your business number is connected.") : t("Connect your business number for AI-assisted customer support.")}</p>{errors.whatsapp && <p className="wf-inline-error" role="alert">{errors.whatsapp}</p>}</div></div><Link href="/dashboard/settings/whatsapp" className="wf-button wf-button-secondary">{whatsapp?.connected ? t("Manage WhatsApp") : t("Set up WhatsApp")}<ArrowUpRight size={15} /></Link></section>
    <div className="wf-test-callout"><span className="wf-test-icon"><Sparkles size={21} /></span><div><h3>{t("Set your hours. Connect your calendar.")}</h3><p>{t("Configure your country, timezone and appointment availability.")}</p></div><Link href="/dashboard/settings/business" className="wf-text-button">{t("Business setup")} <ArrowRight size={16} /></Link></div>
    <div className="wf-test-callout"><span className="wf-test-icon"><Check size={21} /></span><div><h3>{t("Continue your bundle setup.")}</h3><p>{t("Return to your checklist to confirm connections and activate your AI bundle.")}</p></div><Link href="/dashboard/onboarding" className="wf-text-button">{t("Setup checklist")} <ArrowRight size={16} /></Link></div>
    <div className="wf-test-callout"><span className="wf-test-icon"><Sparkles size={21} /></span><div><h3>{t("Connected? Put it to work.")}</h3><p>{t("Ask your assistant about a product's exact SKU or your workspace activity.")}</p></div><Link href="/dashboard#assistant" className="wf-text-button">{t("Ask your workforce")} <ArrowRight size={16} /></Link></div>
    <p className="wf-integration-footnote"><ShieldCheck size={14} />  {t("Connections belong to this workspace. You choose what your AI can access.")}</p>
  </div>;
}
function readScope(scope: string) { return scope.replace(/_/g, " ").replace(/^\w/, letter => letter.toUpperCase()); }
