"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { useToast } from "@/contexts/ToastContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Template {
  id: string;
  name: string;
  category: string;
  description: string;
  definition: any;
}

export default function TemplatesPage() {
  const { user, tenant } = useAuth();
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [deployingId, setDeployingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/proxy/templates")
      .then((res) => res.json())
      .then((json) => {
        if (json?.data) {
          setTemplates(json.data);
        }
      })
      .catch((err) => {
        console.error("Failed to load templates", err);
        showToast("Failed to load templates from server", "error");
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDeploy = async (templateId: string) => {
    let tenantId = user?.tenantId || tenant?.id;

    // Fallback: If tenantId is not in React state yet, fetch directly from /api/auth/me
    if (!tenantId) {
      try {
        const meRes = await fetch("/api/auth/me");
        if (meRes.ok) {
          const meData = await meRes.json();
          tenantId = meData.data?.tenantId || meData.data?.user?.tenantId || meData.data?.tenant?.id;
        }
      } catch (err) {
        console.error("Failed to refresh session context", err);
      }
    }

    if (!tenantId) {
      showToast("Workspace context could not be resolved. Please sign in again.", "warning", "Session Expired");
      return;
    }

    setDeployingId(templateId);
    try {
      const res = await fetch(`/api/proxy/tenants/${tenantId}/templates/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(`"${json.data.templateName}" bundle deployed successfully! Autonomous workflow and agent initialized.`, "success", "Template Activated");
      } else {
        showToast(json.error?.message || "Deployment failed on server", "error", "Deployment Error");
      }
    } catch (err: any) {
      showToast(err.message || "Network error while deploying template", "error", "Network Error");
    } finally {
      setDeployingId(null);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto text-slate-100">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white font-serif">Vertical Niche Workflow Templates</h1>
        <p className="text-slate-400 text-sm mt-1">
          Deploy pre-configured multi-agent bundles tailored for specific industry verticals in one click.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading niche templates...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 bg-slate-900/60 rounded-2xl border border-slate-800">
          <p className="text-slate-400 text-sm">No workflow templates available.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="border-slate-800 bg-slate-900/80 backdrop-blur text-white shadow-sm hover:border-cyan-500/40 transition-all flex flex-col justify-between">
              <div>
                <CardHeader>
                  <div className="flex items-center justify-between mb-2">
                    <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold uppercase tracking-wider">
                      {tpl.category}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">v1.0</span>
                  </div>
                  <CardTitle className="text-lg font-bold text-white">{tpl.name}</CardTitle>
                  <CardDescription className="text-xs text-slate-400 mt-1">
                    {tpl.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800/80">
                    <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Workflow Graph Nodes</div>
                    <div className="flex flex-wrap gap-1.5">
                      {tpl.definition?.nodes?.map((node: any, idx: number) => (
                        <span key={idx} className="px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[11px] font-medium text-cyan-300">
                          {node.type}: {node.agentName || node.tool || node.source || node.provider}
                        </span>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </div>
              <div className="p-6 pt-0">
                <Button
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold text-xs shadow-lg glow-cyan rounded-xl h-11"
                  disabled={deployingId === tpl.id}
                  onClick={() => handleDeploy(tpl.id)}
                >
                  {deployingId === tpl.id ? "Deploying Bundle..." : "🚀 Deploy Bundle to Tenant"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
