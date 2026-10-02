"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { useToast } from "@/contexts/ToastContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Link from "next/link";

interface Agent {
  id: string;
  name: string;
  department: string;
  isActive: boolean;
}

interface DashboardData {
  inventoryCount: number;
  lowStockAlerts: number;
  pendingApprovals: number;
  tasksCompleted: number;
  aiRepliesPer100Inbound: number | null;
  agents: Agent[];
  recentActivity: Array<{
    id: string;
    operation: string;
    entityType: string;
    createdAt: string;
  }>;
  recentPo: Array<{
    id: string;
    status: string;
    totalValue?: number;
    currency?: string;
    createdAt?: string;
  }>;
}

function getTimeGreeting(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { user, tenant } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState<DashboardData>({
    inventoryCount: 0,
    lowStockAlerts: 0,
    pendingApprovals: 0,
    tasksCompleted: 0,
    aiRepliesPer100Inbound: null,
    agents: [],
    recentActivity: [],
    recentPo: [],
  });
  const [loading, setLoading] = useState(false);
  const [chatPrompt, setChatPrompt] = useState("");
  const [assistantAnswer, setAssistantAnswer] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [timeGreeting, setTimeGreeting] = useState("Good morning");

  useEffect(() => {
    const updateGreeting = () => setTimeGreeting(getTimeGreeting(new Date()));
    updateGreeting();
    const intervalId = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const fetchDashboard = () => {
    if (!user?.tenantId) return;
    setLoading(true);
    fetch(`/api/proxy/tenants/${user.tenantId}/operations/dashboard`)
      .then((res) => res.json())
      .then((res) => {
        if (res?.data) {
          setData(res.data);
        } else {
          // Handle cases where response is not ok or data is missing
          showToast(res.error?.message || "Failed to load dashboard data", "error", "Dashboard Load Error");
        }
      })
      .catch((err) => {
        console.error("Error fetching dashboard data:", err);
        showToast(err.message || "Network error loading dashboard", "error", "Network Error");
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDashboard();
    // Optional: Poll for updates if real-time is not fully implemented
    // const interval = setInterval(fetchDashboard, 15000); // Poll every 15 seconds
    // return () => clearInterval(interval);
  }, [user?.tenantId]);

  const toggleAgentStatus = async (agentId: string, currentStatus: boolean) => {
    const tenantId = user?.tenantId || tenant?.id;
    if (!tenantId) {
      showToast("Workspace context missing. Please re-login.", "warning", "Session Expired");
      return;
    }

    try {
      const res = await fetch(`/api/proxy/tenants/${tenantId}/agents/${agentId}/toggle`, {
        method: "PATCH",
      });

      let jsonResponse;
      try {
        const responseText = await res.text(); // Read response as text first
        if (!res.ok) { // Handle non-success status codes
          // Attempt to parse error message from backend if it's JSON, otherwise use raw text
          try {
            const errorData = JSON.parse(responseText);
            throw new Error(errorData.error?.message || errorData.message || `API request failed with status ${res.status}`);
          } catch {
            throw new Error(responseText || `API request failed with status ${res.status}`);
          }
        }
        jsonResponse = JSON.parse(responseText);
      } catch (e: any) {
        // Catch errors from parsing or the initial throw
        throw new Error(e.message || "Failed to process response");
      }

      if (jsonResponse.success) {
        showToast(
          currentStatus ? "Agent paused successfully." : "Agent resumed and set to working.",
          currentStatus ? "warning" : "success",
          "Agent Status Updated"
        );
        fetchDashboard();
      } else {
        showToast(jsonResponse.error?.message || "Failed to update agent status", "error", "Status Update Error");
      }
    } catch (err: any) {
      console.error("Error updating agent status:", err);
      showToast(err.message || "Network error while updating agent status", "error", "Network Error");
    }
  };

  const askWorkforce = async () => {
    const question = chatPrompt.trim();
    const tenantId = user?.tenantId || tenant?.id;
    if (!question || assistantLoading) return;
    if (!tenantId) {
      showToast("Workspace context missing. Please re-login.", "warning", "Session Expired");
      return;
    }

    setAssistantLoading(true);
    setAssistantAnswer("");
    try {
      const response = await fetch(`/api/proxy/tenants/${tenantId}/workforce/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const result = await response.json();
      if (!response.ok || !result?.data?.answer) {
        throw new Error(result.error?.message || "The workforce assistant could not answer.");
      }
      setAssistantAnswer(result.data.answer);
      setChatPrompt("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The workforce assistant could not answer.";
      showToast(message, "error", "Assistant Error");
    } finally {
      setAssistantLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-24 text-slate-100">
      {/* Top Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/60 to-slate-900 text-white border border-slate-800 shadow-xl glow-cyan">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Workspace: {tenant?.name || "Active Workspace"}
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight font-serif">
            {timeGreeting}, {user?.email?.split("@")[0] || "Team Member"}.
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Review current stock, agent task results, and approval requests.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-xl bg-slate-900/90 border border-slate-800 text-right">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Live Command Center</div>
            <div className="text-sm font-semibold text-emerald-400">{data.agents.filter((agent) => agent.isActive).length} active agents</div>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400 uppercase tracking-wider">Agent tasks completed</CardTitle>
            <span className="text-emerald-400 text-xs font-semibold">Live DB</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {loading ? "..." : (data.tasksCompleted ?? 0).toLocaleString()}
            </div>
            <p className="text-xs text-slate-500 mt-1">Completed tasks assigned to an agent</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400 uppercase tracking-wider">AI replies per 100 inbound</CardTitle>
            <span className="text-cyan-400 text-xs font-semibold">Live DB</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {loading ? "..." : data.aiRepliesPer100Inbound == null ? "—" : data.aiRepliesPer100Inbound}
            </div>
            <p className="text-xs text-slate-500 mt-1">Counted from inbound and outbound message records</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400 uppercase tracking-wider">Approval queue</CardTitle>
            <span className="text-amber-400 text-xs font-semibold">Needs review</span>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${data.pendingApprovals > 0 ? "text-amber-400" : "text-white"}`}>
              {loading ? "..." : data.pendingApprovals}
            </div>
            <p className="text-xs text-slate-500 mt-1">Pending HITL gates</p>
          </CardContent>
        </Card>

        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium text-slate-400 uppercase tracking-wider">Inventory records</CardTitle>
            <span className="text-emerald-400 text-xs font-semibold">Live DB</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">
              {loading ? "..." : data.inventoryCount.toLocaleString()}
            </div>
            <p className="text-xs text-slate-500 mt-1">Stock records tracked across locations</p>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Workforce Performance Chart / Operations */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-white">Workforce performance</CardTitle>
                <CardDescription className="text-xs text-slate-400">History will appear here as task executions are recorded</CardDescription>
              </div>
              <span className="text-xs text-slate-400 bg-slate-800 px-3 py-1 rounded-xl">Execution history</span>
            </CardHeader>
            <CardContent>
              <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-700 text-sm text-slate-400">
                Activity charts require timestamped workflow execution records.
              </div>
            </CardContent>
          </Card>

          {/* Real-time Feed */}
          <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-white">Recent activity</CardTitle>
                <CardDescription className="text-xs text-slate-400">Live feed of database audit logs & executions</CardDescription>
              </div>
              <Link href="/dashboard/approvals" className="text-xs text-cyan-400 hover:underline">View approvals →</Link>
            </CardHeader>
            <CardContent>
              {data.recentActivity && data.recentActivity.length > 0 ? (
                <div className="divide-y divide-slate-800/80">
                  {data.recentActivity.map((act) => (
                    <div key={act.id} className="py-3 flex items-center justify-between text-sm">
                      <div className="flex items-center gap-3">
                        <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">⚡</span>
                        <div>
                          <div className="font-semibold text-white text-xs uppercase">{act.operation}</div>
                          <div className="text-xs text-slate-400">Entity: {act.entityType}</div>
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 font-mono">{new Date(act.createdAt).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-xs text-slate-400">No recent activity logged yet.</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right 1 Col: AI Employees & HITL */}
        <div className="space-y-6">
          <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-white">AI employees</CardTitle>
                <CardDescription className="text-xs text-slate-400">Active workforce units</CardDescription>
              </div>
              <Link href="/dashboard/templates" className="text-xs text-cyan-400 hover:underline">+ Deploy</Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.agents && data.agents.length > 0 ? (
                data.agents.map((ag) => (
                  <div key={ag.id} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{ag.name}</div>
                      <div className="text-[11px] text-slate-400 truncate">Dept: {ag.department}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${ag.isActive ? "text-emerald-400 bg-emerald-950/80 border border-emerald-500/30" : "text-amber-400 bg-amber-950/80 border border-amber-500/30"}`}>
                        {ag.isActive ? "● Working" : "⏸ Paused"}
                      </span>
                      <button
                        onClick={() => toggleAgentStatus(ag.id, ag.isActive)}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200 font-medium transition-colors"
                        title={ag.isActive ? "Pause Agent" : "Resume Agent"}
                      >
                        {ag.isActive ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400">
                  No agents deployed yet. <Link href="/dashboard/templates" className="text-cyan-400 underline">Deploy a template</Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* HITL Needs Attention */}
          <Card className="border-amber-500/30 bg-gradient-to-br from-amber-950/20 to-slate-900/60 backdrop-blur text-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-bold text-amber-300">Needs your attention</CardTitle>
              <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-bold text-[10px]">
                {data.pendingApprovals}
              </span>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
              {data.pendingApprovals > 0 ? (
                <div className="p-3 rounded-xl bg-slate-950/80 border border-amber-500/20 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">Pending High-Risk Actions</div>
                    <div className="text-[10px] text-slate-400">{data.pendingApprovals} request(s) awaiting HITL review</div>
                  </div>
                  <Link href="/dashboard/approvals" className="px-3 py-1 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs hover:bg-cyan-400">
                    Review
                  </Link>
                </div>
              ) : (
                <div className="text-center py-4 text-xs text-slate-400">All approval gates cleared.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Floating AI Command Bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-50">
        {assistantAnswer && <div role="status" className="mb-2 max-h-48 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950/95 p-4 text-sm leading-relaxed text-slate-100 shadow-xl">{assistantAnswer}</div>}
        <form onSubmit={(event) => { event.preventDefault(); void askWorkforce(); }} className="p-2 rounded-2xl bg-slate-900/90 border border-cyan-500/40 backdrop-blur shadow-2xl glow-cyan flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm">
            ✦
          </div>
          <input
            type="text"
            placeholder="Ask your workforce anything..."
            value={chatPrompt}
            onChange={(e) => setChatPrompt(e.target.value)}
            disabled={assistantLoading}
            aria-label="Ask your workforce"
            className="flex-1 bg-transparent border-none text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <button type="submit" disabled={assistantLoading || !chatPrompt.trim()} className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs transition-colors flex items-center gap-1">
            <span>{assistantLoading ? "Thinking…" : "Send"}</span>
            <span>↗</span>
          </button>
        </form>
      </div>
    </div>
  );
}
