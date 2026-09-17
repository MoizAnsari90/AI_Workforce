"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface DashboardData {
  inventoryCount: number;
  lowStockAlerts: number;
  pendingApprovals: number;
  recentPo: Array<{
    id: string;
    status: string;
    totalValue?: number;
    currency?: string;
    createdAt?: string;
  }>;
}

export default function DashboardPage() {
  const { user, tenant } = useAuth();
  const [data, setData] = useState<DashboardData>({
    inventoryCount: 0,
    lowStockAlerts: 0,
    pendingApprovals: 0,
    recentPo: [],
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.tenantId) return;

    setLoading(true);
    fetch(`/api/v1/tenants/${user.tenantId}/operations/dashboard`)
      .then((res) => res.json())
      .then((res) => {
        if (res?.data) {
          setData(res.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, [user?.tenantId]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white border border-slate-800 shadow-xl">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-medium mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Organization: {tenant?.name || "Active Workspace"}
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
            Welcome back, {user?.email?.split("@")[0] || "Team Member"}! 👋
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Here is what your autonomous workforce has accomplished today.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/60 text-right">
            <div className="text-xs text-slate-400">System Status</div>
            <div className="text-sm font-semibold text-emerald-400">All Agents Online</div>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-slate-200/80 shadow-sm hover:shadow transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Active AI Agents</CardTitle>
            <span className="p-2 rounded-lg bg-indigo-50 text-indigo-600 text-xs">🤖</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">5</div>
            <p className="text-xs text-emerald-600 font-medium mt-1">Support, Sales, Ops, Finance, Mktg</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-sm hover:shadow transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Inventory Items</CardTitle>
            <span className="p-2 rounded-lg bg-blue-50 text-blue-600 text-xs">📦</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">
              {loading ? "..." : data.inventoryCount}
            </div>
            <p className="text-xs text-slate-500 mt-1">Managed across warehouses</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-sm hover:shadow transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Low Stock Alerts</CardTitle>
            <span className="p-2 rounded-lg bg-red-50 text-red-600 text-xs">⚠️</span>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${data.lowStockAlerts > 0 ? "text-red-600" : "text-slate-900"}`}>
              {loading ? "..." : data.lowStockAlerts}
            </div>
            <p className="text-xs text-slate-500 mt-1">Requires reorder attention</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-sm hover:shadow transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Pending HITL Approvals</CardTitle>
            <span className="p-2 rounded-lg bg-amber-50 text-amber-600 text-xs">✋</span>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${data.pendingApprovals > 0 ? "text-amber-600" : "text-slate-900"}`}>
              {loading ? "..." : data.pendingApprovals}
            </div>
            <p className="text-xs text-slate-500 mt-1">High-value gates awaiting review</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity / Purchase Orders */}
      <Card className="border-slate-200/80 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold text-slate-900">Recent Purchase Orders & Operations</CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Automated operations events and reorder requests
              </CardDescription>
            </div>
            <span className="text-xs text-slate-400">Live sync</span>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentPo && data.recentPo.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {data.recentPo.map((po) => (
                <div key={po.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    <div>
                      <div className="text-sm font-medium text-slate-800">Order #{po.id.slice(0, 8)}</div>
                      <div className="text-xs text-slate-400">Status: {po.status}</div>
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-slate-700">
                    {po.totalValue ? `${po.totalValue} ${po.currency || "USD"}` : "Processed"}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 border border-dashed border-slate-200 rounded-xl">
              <div className="text-2xl mb-2">📋</div>
              <h4 className="text-sm font-semibold text-slate-700">No active purchase orders</h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                Your AI Operations Agent will automatically generate purchase orders when inventory items fall below the reorder point.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
