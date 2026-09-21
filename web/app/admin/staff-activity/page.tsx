"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";

interface AuditLogEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; fullName: string; username: string };
}

interface Actor {
  id: string;
  fullName: string;
  username: string;
}

const ACTIONS = [
  "CASHOUT_APPROVED",
  "CASHOUT_REJECTED",
  "BALANCE_ADJUSTED",
  "GAME_CREATED",
  "GAME_UPDATED",
  "GAME_DELETED",
  "BROADCAST_SENT",
  "STAFF_CREATED",
  "STAFF_REMOVED",
];

export default function AdminStaffActivityPage() {
  const api = useApi();
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (actorId) params.set("actorId", actorId);
    if (action) params.set("action", action);
    const res = await api<{ logs: AuditLogEntry[]; total: number; actors: Actor[] }>(`/api/admin/audit-logs?${params}`);
    setLogs(res.logs);
    setTotal(res.total);
    setActors(res.actors);
  }, [api, actorId, action]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Staff Activity</h1>

      <div className="card mb-4 flex flex-col sm:flex-row gap-3">
        <select className="input" value={actorId} onChange={(e) => setActorId(e.target.value)}>
          <option value="">All Staff</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.fullName} (@{a.username})
            </option>
          ))}
        </select>
        <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All Actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      <div className="card p-0 divide-y divide-border">
        {logs.map((l) => (
          <div key={l.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {l.actor.fullName} <span className="text-muted">@{l.actor.username}</span>
              </p>
              <p className="text-xs text-muted">{new Date(l.createdAt).toLocaleString()}</p>
            </div>
            <p className="text-primary text-xs mt-0.5">{l.action.replace(/_/g, " ")}</p>
            {l.meta && <p className="text-muted text-xs">{JSON.stringify(l.meta)}</p>}
          </div>
        ))}
        {logs.length === 0 && <p className="text-muted text-sm text-center py-8">No activity found.</p>}
      </div>
      {logs.length > 0 && <p className="text-muted text-xs mt-2">{total} total entries</p>}
    </AdminShell>
  );
}
