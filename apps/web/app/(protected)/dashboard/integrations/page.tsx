"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";

type ShopifyConnection = { connected: boolean; shop?: string; name?: string; scopes?: string[]; allowWrites?: boolean };
type WooConnection = { connected: boolean; storeUrl?: string; needsReconnect?: boolean };

export default function IntegrationsPage() {
  const { user } = useAuth();
  const [shop, setShop] = useState("");
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [wooConnection, setWooConnection] = useState<WooConnection | null>(null);
  const [wooStoreUrl, setWooStoreUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    try {
      const [response, wooResponse] = await Promise.all([
        fetch(`/api/proxy/tenants/${user.tenantId}/shopify/connection`),
        fetch("/api/proxy/woocommerce/connection"),
      ]);
      const [json, wooJson] = await Promise.all([response.json(), wooResponse.json()]);
      if (response.ok) setConnection(json.data);
      else setNotice(json.error?.message || "Shopify connection status could not be loaded.");
      if (wooResponse.ok) setWooConnection(wooJson.data);
    } catch { setNotice("Shopify connection status could not be loaded."); }
    finally { setLoading(false); }
  }, [user?.tenantId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("shopify");
    const wooResult = new URLSearchParams(window.location.search).get("woocommerce");
    if (!result && !wooResult) return;
    const messages: Record<string, string> = {
      connected: "Shopify connected successfully.",
      invalid_callback: "Shopify could not verify this callback. Please try connecting again.",
      expired_or_mismatched_state: "This connection request expired or the store did not match. Please try again.",
      missing_permissions: "The Shopify app is missing required permissions. Update the app scopes and reconnect.",
      store_already_connected: "Another Shopify store is already connected to this workspace. Disconnect it before connecting a different store.",
      connection_failed: "Shopify connection failed. Check the app configuration and try again.",
    };
    setNotice(wooResult === "connected" ? "WooCommerce authorization completed; checking the store connection…" : (result ? messages[result] : "Shopify connection was not completed."));
    window.history.replaceState({}, "", "/dashboard/integrations");
    if (result === "connected" || wooResult === "connected") window.setTimeout(() => void load(), 700);
  }, [load]);

  const beginConnect = async () => {
    if (!user?.tenantId || user.role !== "admin") return;
    setBusy(true); setNotice("");
    try {
      const domain = shop.trim().toLowerCase().endsWith(".myshopify.com") ? shop.trim().toLowerCase() : `${shop.trim().toLowerCase()}.myshopify.com`;
      const response = await fetch(`/api/proxy/shopify/oauth/start?shop=${encodeURIComponent(domain)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || json.error || "Unable to start Shopify authorization");
      window.location.assign(json.data.authorizationUrl);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to start Shopify authorization"); setBusy(false); }
  };

  const beginWooConnect = async () => {
    if (!user?.tenantId || user.role !== "admin") return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/proxy/woocommerce/oauth/start?storeUrl=${encodeURIComponent(wooStoreUrl.trim())}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "Unable to start WooCommerce authorization.");
      window.location.assign(json.data.authorizationUrl);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to start WooCommerce authorization."); setBusy(false); }
  };

  const disconnectWoo = async () => {
    if (!window.confirm("Disconnect this WooCommerce store from your workspace?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/proxy/woocommerce/connection", { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "Unable to disconnect WooCommerce.");
      setWooConnection({ connected: false }); setNotice("WooCommerce store disconnected.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to disconnect WooCommerce."); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!user?.tenantId || !window.confirm("Remove this Shopify connection from your workspace? To fully revoke the app, also uninstall it from Shopify Admin > Apps.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/proxy/tenants/${user.tenantId}/shopify/connection`, { method: "DELETE" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "Unable to disconnect Shopify");
      setConnection({ connected: false }); setNotice("Shopify store disconnected.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to disconnect Shopify"); }
    finally { setBusy(false); }
  };

  const setWrites = async (enabled: boolean) => {
    if (!user?.tenantId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/proxy/tenants/${user.tenantId}/shopify/connection/writes`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "Unable to update Shopify permissions");
      setConnection(current => current ? { ...current, allowWrites: enabled } : current);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to update Shopify permissions"); }
    finally { setBusy(false); }
  };

  const isAdmin = user?.role === "admin";
  return (
    <div className="mx-auto max-w-5xl space-y-8 text-slate-100">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Workspace connections</p>
        <h1 className="mt-2 font-serif text-3xl font-bold text-white">Integrations</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">Connect the tools your AI workforce uses. Each connection is isolated to this workspace.</p>
      </div>
      {notice && <div role="status" className="rounded-xl border border-cyan-900 bg-cyan-950/40 px-4 py-3 text-sm text-cyan-100">{notice}</div>}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-800 bg-emerald-950 text-2xl">🛍️</div>
            <div><h2 className="text-lg font-semibold text-white">Shopify</h2><p className="mt-1 text-sm text-slate-400">Orders, inventory, and approved store operations</p></div>
          </div>
          {!loading && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${connection?.connected ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{connection?.connected ? "Connected" : "Not connected"}</span>}
        </div>
        {loading ? <p className="mt-6 text-sm text-slate-500">Checking connection…</p> : connection?.connected ? (
          <div className="mt-6 space-y-5 border-t border-slate-800 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-white">{connection.name || connection.shop}</p><p className="text-sm text-slate-400">{connection.shop}</p></div>{isAdmin && <button onClick={disconnect} disabled={busy} className="rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50">Disconnect</button>}</div>
            <div className="flex flex-wrap gap-2">{(connection.scopes || []).map(scope => <span key={scope} className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">{scope}</span>)}</div>
            <label className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <input type="checkbox" checked={connection.allowWrites === true} disabled={!isAdmin || busy || !connection.scopes?.includes("write_orders")} onChange={event => void setWrites(event.target.checked)} className="h-4 w-4 accent-cyan-500" />
              <span><span className="block text-sm font-medium text-white">Allow AI to perform store changes</span><span className="mt-1 block text-xs text-slate-400">Refunds and order cancellations remain behind the human approval queue.</span></span>
            </label>
          </div>
        ) : (
          <div className="mt-6 space-y-4 border-t border-slate-800 pt-5">
            <div className="max-w-xl"><label htmlFor="shop-domain" className="mb-2 block text-sm font-medium text-slate-300">Shopify store domain</label><div className="flex rounded-lg border border-slate-700 bg-slate-950 focus-within:border-cyan-600"><input id="shop-domain" value={shop} onChange={event => setShop(event.target.value)} placeholder="your-store.myshopify.com" className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600" /><span className="self-center pr-3 text-xs text-slate-500">.myshopify.com</span></div><p className="mt-2 text-xs text-slate-500">You’ll be redirected to Shopify to review and approve access. Your app credentials stay on our server.</p></div>
            <button onClick={beginConnect} disabled={!isAdmin || busy || !shop.trim()} className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Redirecting…" : "Connect Shopify"}</button>
            {!isAdmin && <p className="text-xs text-amber-300">Ask a workspace admin to connect Shopify.</p>}
          </div>
        )}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-lg font-semibold text-white">WooCommerce</h2><p className="mt-1 text-sm text-slate-400">Read product and order information from your WordPress store.</p></div>
          {wooConnection && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${wooConnection.connected ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{wooConnection.connected ? "Connected" : "Not connected"}</span>}
        </div>
        {wooConnection?.connected ? <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
          <div><p className="font-medium text-white">{wooConnection.storeUrl}</p><p className="text-sm text-slate-400">Read access verified</p></div>
          {isAdmin && <button onClick={() => void disconnectWoo()} disabled={busy} className="rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300 disabled:opacity-50">Disconnect</button>}
        </div> : <div className="mt-6 space-y-4 border-t border-slate-800 pt-5">
          <div className="max-w-xl"><label htmlFor="woo-store-url" className="mb-2 block text-sm font-medium text-slate-300">WooCommerce store address</label><input id="woo-store-url" type="url" value={wooStoreUrl} onChange={event => setWooStoreUrl(event.target.value)} placeholder="https://your-store.com" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-600" /><p className="mt-2 text-xs text-slate-500">You’ll be redirected to WordPress to approve read-only store access. API keys stay on the server.</p></div>
          <button onClick={() => void beginWooConnect()} disabled={!isAdmin || busy || !wooStoreUrl.trim()} className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50">Connect WooCommerce</button>
          {!isAdmin && <p className="text-xs text-amber-300">Ask a workspace admin to connect WooCommerce.</p>}
        </div>}
      </section>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-cyan-900/70 bg-cyan-950/20 p-5">
        <div><h2 className="font-semibold text-white">Next: connect WhatsApp</h2><p className="mt-1 text-sm text-slate-400">Use Meta’s secure signup to connect your business number.</p></div>
        <a href="/dashboard/settings/whatsapp" className="rounded-lg border border-cyan-800 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-950">Set up WhatsApp</a>
      </section>
      <p className="text-xs text-slate-500">Each workspace connects one store per provider. Shopify changes remain off by default, and sensitive actions still need human approval.</p>
      <p className="text-xs text-slate-500">More connectors can be added here. Shopify write access is off by default and sensitive actions require human approval.</p>
    </div>
  );
}
