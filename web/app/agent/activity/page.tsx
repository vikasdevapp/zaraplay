"use client";

import { useEffect, useState } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";

interface LogEntry {
  id: string;
  action: string;
  targetType: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export default function AgentActivityPage() {
  const api = useApi();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    api<{ logs: LogEntry[] }>("/api/agent/activity")
      .then((res) => setLogs(res.logs))
      .catch(() => {});
  }, [api]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">My Activity</h1>
      <div className="card p-0 divide-y divide-border">
        {logs.map((l) => (
          <div key={l.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="text-primary font-medium">{l.action.replace(/_/g, " ")}</p>
              <p className="text-xs text-muted">{new Date(l.createdAt).toLocaleString()}</p>
            </div>
            {l.meta && <p className="text-muted text-xs mt-0.5">{JSON.stringify(l.meta)}</p>}
          </div>
        ))}
        {logs.length === 0 && <p className="text-muted text-sm text-center py-8">No activity recorded yet.</p>}
      </div>
    </AgentShell>
  );
}
