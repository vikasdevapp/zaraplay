"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface MemberStats {
  openNow: number;
  doneToday: number;
  completed7d: number;
  rejected7d: number;
  loaded7d: number;
  redeemed7d: number;
  avgHandlingMins: number | null;
  totalHandled: number;
  lastActionAt: string | null;
}

interface Member {
  id: string;
  fullName: string;
  username: string;
  email: string;
  createdAt: string;
  stats: MemberStats;
}

interface HandledRequest {
  id: string;
  type: "CREATE_ACCOUNT" | "RECHARGE" | "REDEEM" | "PASSWORD_RESET" | "BALANCE_CHECK";
  status: "COMPLETED" | "REJECTED" | "CANCELLED" | "PENDING";
  amount: string;
  completedAmount: string | null;
  agentNote: string | null;
  createdAt: string;
  completedAt: string | null;
  user: { fullName: string; username: string };
  userGame: { game: { name: string } };
}

const TYPE_LABELS = { CREATE_ACCOUNT: "Create account", RECHARGE: "Load", REDEEM: "Redeem", PASSWORD_RESET: "Password reset", BALANCE_CHECK: "Balance check" } as const;

function formatMins(mins: number | null) {
  if (mins === null) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function AdminAgentTeamPage() {
  const api = useApi();
  const [team, setTeam] = useState<Member[]>([]);
  const [pending, setPending] = useState<{ count: number; oldestAt: string | null }>({ count: 0, oldestAt: null });
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Member | null>(null);
  const [handled, setHandled] = useState<HandledRequest[]>([]);

  const load = useCallback(async () => {
    const res = await api<{ team: Member[]; pending: { count: number; oldestAt: string | null } }>("/api/admin/agent-team");
    setTeam(res.team);
    setPending(res.pending);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setBusy(true);
    try {
      await api("/api/admin/agent-team", { method: "POST", body: JSON.stringify({ fullName, username, email, password }) });
      setCreated({ username, email, password });
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create agent account.");
    } finally {
      setBusy(false);
    }
  }

  async function viewWork(member: Member) {
    setViewing(member);
    setHandled([]);
    const res = await api<{ requests: HandledRequest[] }>(`/api/admin/agent-team/${member.id}/requests`);
    setHandled(res.requests);
  }

  async function resetPassword(member: Member) {
    const pw = window.prompt(`New password for ${member.fullName} (min 8 characters):`);
    if (!pw) return;
    try {
      await api(`/api/admin/agent-team/${member.id}/password`, { method: "POST", body: JSON.stringify({ password: pw }) });
      window.alert(`Password updated. ${member.fullName} has been signed out and must log in with the new password.`);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Could not reset password.");
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove agent access for ${member.fullName}? They will be signed out immediately and any requests they claimed go back to the queue.`)) return;
    try {
      await api(`/api/admin/agent-team/${member.id}`, { method: "DELETE" });
      if (viewing?.id === member.id) setViewing(null);
      await load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Could not remove agent access.");
    }
  }

  const money = (v: number | string) => `$${Number(v).toFixed(2)}`;

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-2">Agent Team</h1>
      <p className="text-sm text-muted mb-6">
        Agents create players&apos; game accounts and load / redeem their credits from the{" "}
        <a href="/agent/requests" className="text-primary underline">
          Agent Desk
        </a>
        . Agent logins can only open the Agent Desk. Share the login below with your agent; they sign in at <span className="text-white">/login</span>.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="card">
          <p className="text-xs text-muted">Requests waiting</p>
          <p className={`text-2xl font-bold ${pending.count > 0 ? "text-primary" : ""}`}>{pending.count}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted">Oldest waiting</p>
          <p className="text-2xl font-bold">{pending.oldestAt ? timeAgo(pending.oldestAt) : "—"}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted">Team finished today</p>
          <p className="text-2xl font-bold">{team.reduce((n, m) => n + m.stats.doneToday, 0)}</p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="card mb-6 space-y-3">
        <h2 className="font-bold">Create Agent Login</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="input" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            className="input"
            type="text"
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {created && (
          <div className="rounded-lg bg-surface2 px-3 py-2 text-sm">
            <p className="font-medium text-green-400 mb-1">Agent login created. Share these details:</p>
            <p>
              Login: <span className="font-mono">{created.email}</span> or <span className="font-mono">{created.username}</span>
            </p>
            <p>
              Password: <span className="font-mono">{created.password}</span>
            </p>
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create Agent Login"}
        </button>
      </form>

      <div className="card p-0 overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-3 py-3 font-medium">Working now</th>
              <th className="px-3 py-3 font-medium">Today</th>
              <th className="px-3 py-3 font-medium">Done (7d)</th>
              <th className="px-3 py-3 font-medium">Rejected (7d)</th>
              <th className="px-3 py-3 font-medium">Loaded / Redeemed (7d)</th>
              <th className="px-3 py-3 font-medium">Avg handling</th>
              <th className="px-3 py-3 font-medium">Last action</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {team.map((m) => (
              <tr key={m.id} className={viewing?.id === m.id ? "bg-surface2" : ""}>
                <td className="px-4 py-3">
                  <p className="font-medium">{m.fullName}</p>
                  <p className="text-xs text-muted">
                    @{m.username} · {m.email}
                  </p>
                </td>
                <td className="px-3 py-3">{m.stats.openNow}</td>
                <td className="px-3 py-3">{m.stats.doneToday}</td>
                <td className="px-3 py-3">{m.stats.completed7d}</td>
                <td className="px-3 py-3">{m.stats.rejected7d}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {money(m.stats.loaded7d)} / {money(m.stats.redeemed7d)}
                </td>
                <td className="px-3 py-3">{formatMins(m.stats.avgHandlingMins)}</td>
                <td className="px-3 py-3 whitespace-nowrap">{timeAgo(m.stats.lastActionAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    <button onClick={() => viewWork(m)} className="btn-ghost text-xs px-2 py-1">
                      Work
                    </button>
                    <button onClick={() => resetPassword(m)} className="btn-ghost text-xs px-2 py-1">
                      Reset password
                    </button>
                    <button onClick={() => removeMember(m)} className="text-xs px-2 py-1 text-red-400 hover:text-red-300">
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {team.length === 0 && <p className="text-muted text-sm text-center py-8">No agent logins yet. Create one above.</p>}
      </div>
      <p className="text-xs text-muted -mt-4 mb-6">
        Avg handling is over the last 30 days, from when the player made the request to when the agent finished it.
      </p>

      {viewing && (
        <div className="card p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <p className="font-semibold text-sm">Latest work by {viewing.fullName}</p>
              <p className="text-xs text-muted">{viewing.stats.totalHandled} requests handled in total</p>
            </div>
            <button onClick={() => setViewing(null)} className="text-muted hover:text-white text-sm">
              Close
            </button>
          </div>
          <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
            {handled.map((r) => (
              <div key={r.id} className="px-4 py-3 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {TYPE_LABELS[r.type]} · {r.userGame.game.name}
                  </p>
                  <p className="text-xs text-muted">
                    {r.user.fullName} (@{r.user.username}) · {r.completedAt ? new Date(r.completedAt).toLocaleString() : ""}
                  </p>
                  {r.agentNote && <p className="text-xs text-muted mt-0.5">“{r.agentNote}”</p>}
                </div>
                <div className="text-right shrink-0">
                  {Number(r.completedAmount ?? r.amount) > 0 && <p>{money(r.completedAmount ?? r.amount)}</p>}
                  <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${r.status === "COMPLETED" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {r.status}
                  </span>
                </div>
              </div>
            ))}
            {handled.length === 0 && <p className="text-muted text-sm text-center py-8">No finished requests yet.</p>}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
