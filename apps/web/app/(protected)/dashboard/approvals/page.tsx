"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { useToast } from "@/contexts/ToastContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ApprovalRequest {
  id: string;
  actionType: string;
  actionPayload: any;
  status: string;
  createdAt: string;
  rejectionReason?: string;
}

export default function ApprovalsPage() {
  const { user, tenant } = useAuth();
  const { showToast } = useToast();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const getTenantId = async (): Promise<string | null> => {
    let tId = user?.tenantId || tenant?.id;
    if (!tId) {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          tId = data.data?.tenantId || data.data?.user?.tenantId;
        }
      } catch {}
    }
    return tId || null;
  };

  const fetchApprovals = async () => {
    const tenantId = await getTenantId();
    if (!tenantId) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/proxy/tenants/${tenantId}/approval-requests`);
      const json = await res.json();
      if (json?.data) {
        setApprovals(json.data);
      }
    } catch (err) {
      console.error("Failed to load approval requests", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 5000);
    return () => clearInterval(interval);
  }, [user?.tenantId, tenant?.id]);

  const handleReview = async (approvalId: string, decision: "approved" | "rejected") => {
    const tenantId = await getTenantId();
    if (!tenantId) {
      showToast("Workspace context missing. Please re-login.", "warning");
      return;
    }
    setActionLoading(approvalId);
    try {
      const payload: any = { decision };
      if (decision === "rejected") {
        payload.rejectionReason = rejectionReasons[approvalId] || "Rejected by administrator";
      }

      const res = await fetch(`/api/proxy/tenants/${tenantId}/approval-requests/${approvalId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (json.success) {
        showToast(
          decision === "approved"
            ? "Action approved and dispatched for execution."
            : "Action rejected.",
          decision === "approved" ? "success" : "info",
          "Approval Updated"
        );
        fetchApprovals();
      } else {
        showToast(json.error?.message || "Failed to review approval request", "error", "Review Error");
      }
    } catch (err: any) {
      showToast(err.message || "Network error while processing approval", "error", "Network Error");
    } finally {
      setActionLoading(null);
    }
  };

  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const pastApprovals = approvals.filter((a) => a.status !== "pending");

  return (
    <div className="space-y-8 max-w-7xl mx-auto text-slate-100">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white font-serif">HITL Approval Queue</h1>
        <p className="text-slate-400 text-sm mt-1">
          Review and authorize high-risk, sensitive, or high-value agent actions before external API execution.
        </p>
      </div>

      {/* Pending Approvals */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <span>Pending Review</span>
          <span className="px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-bold">
            {pendingApprovals.length}
          </span>
        </h2>

        {loading ? (
          <div className="text-center py-12 text-slate-400">Loading approval queue...</div>
        ) : pendingApprovals.length === 0 ? (
          <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white">
            <CardContent className="text-center py-12">
              <div className="text-3xl mb-2">🎉</div>
              <h3 className="text-sm font-semibold text-slate-200">No pending approvals</h3>
              <p className="text-xs text-slate-400 mt-1">All high-risk agent actions have been processed.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {pendingApprovals.map((req) => (
              <Card key={req.id} className="border-amber-500/30 bg-slate-900/90 backdrop-blur text-white shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-bold text-white flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                        Action Type: <span className="font-mono text-cyan-400">{req.actionType}</span>
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-400 mt-0.5">
                        Requested at: {new Date(req.createdAt).toLocaleString()} • ID: {req.id}
                      </CardDescription>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold self-start">
                      PENDING APPROVAL
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Action Payload</h4>
                    <pre className="bg-slate-950 text-slate-200 p-4 rounded-xl text-xs overflow-x-auto font-mono border border-slate-800">
                      {JSON.stringify(req.actionPayload, null, 2)}
                    </pre>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-end border-t border-slate-800">
                    <div className="flex-1 max-w-sm">
                      <Input
                        placeholder="Rejection reason (if rejecting)..."
                        value={rejectionReasons[req.id] || ""}
                        onChange={(e) =>
                          setRejectionReasons({ ...rejectionReasons, [req.id]: e.target.value })
                        }
                        className="text-xs bg-slate-950 border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        className="border-red-900/60 bg-red-950/20 text-red-400 hover:bg-red-950/40 text-xs"
                        disabled={actionLoading === req.id}
                        onClick={() => handleReview(req.id, "rejected")}
                      >
                        ❌ Reject
                      </Button>
                      <Button
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm"
                        disabled={actionLoading === req.id}
                        onClick={() => handleReview(req.id, "approved")}
                      >
                        ✅ Approve & Execute
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Past Approvals Log */}
      <div className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold text-white">History & Audit Log</h2>
        {pastApprovals.length === 0 ? (
          <p className="text-xs text-slate-400">No past approval records.</p>
        ) : (
          <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
            <div className="divide-y divide-slate-800">
              {pastApprovals.map((req) => (
                <div key={req.id} className="p-4 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-semibold text-white font-mono text-xs">{req.actionType}</div>
                    <div className="text-xs text-slate-400">ID: {req.id.slice(0, 8)}... • {new Date(req.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        req.status === "approved"
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-red-500/10 text-red-400 border border-red-500/20"
                      }`}
                    >
                      {req.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
