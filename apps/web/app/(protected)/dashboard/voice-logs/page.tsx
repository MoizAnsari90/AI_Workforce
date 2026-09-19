"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface VoiceSession {
  id: string;
  provider: string;
  callId: string;
  status: string;
  transcript: Array<{ speaker: string; text: string }>;
  metadata: any;
  createdAt: string;
}

export default function VoiceLogsPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.tenantId) return;
    fetch(`/api/proxy/tenants/${user.tenantId}/voice-sessions`)
      .then((res) => res.json())
      .then((json) => {
        if (json?.data) {
          setSessions(json.data);
        }
      })
      .catch((err) => console.error("Failed to load voice sessions", err))
      .finally(() => setLoading(false));
  }, [user?.tenantId]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto text-slate-100">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white font-serif">Real-Time Voice Call Logs</h1>
        <p className="text-slate-400 text-sm mt-1">
          Monitor inbound and outbound voice sessions powered by Vapi and Retell AI integrations.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading voice logs...</div>
      ) : sessions.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white">
          <CardContent className="text-center py-16">
            <div className="text-3xl mb-2">🎙️</div>
            <h3 className="text-sm font-semibold text-slate-200">No voice calls recorded yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              Voice transcripts and summaries will automatically appear here when Vapi or Retell AI triggers a call event webhook.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <Card key={session.id} className="border-slate-800 bg-slate-900/80 backdrop-blur text-white shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                      Call ID: <span className="font-mono font-medium text-cyan-300">{session.callId}</span>
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-400 mt-0.5">
                      Provider: <span className="font-semibold text-indigo-400">{session.provider}</span> • Date: {new Date(session.createdAt).toLocaleString()}
                    </CardDescription>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold self-start">
                    {session.status.toUpperCase()}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Call Transcript</h4>
                  {Array.isArray(session.transcript) && session.transcript.length > 0 ? (
                    <div className="bg-slate-950 text-slate-200 p-4 rounded-xl space-y-2 text-xs font-mono max-h-60 overflow-y-auto border border-slate-800">
                      {session.transcript.map((t, idx) => (
                        <div key={idx} className="flex gap-2">
                          <span className={`font-bold uppercase ${t.speaker === 'agent' ? 'text-cyan-400' : 'text-emerald-400'}`}>
                            [{t.speaker}]:
                          </span>
                          <span className="text-slate-300">{t.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No transcript recorded for this session.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
