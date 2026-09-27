"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface MemberStats {
  repliesToday: number;
  replies7d: number;
  replies30d: number;
  repliesTotal: number;
  chats7d: number;
  avgResponseMins: number | null;
  lastReplyAt: string | null;
}

interface Member {
  id: string;
  fullName: string;
  username: string;
  email: string;
  createdAt: string;
  stats: MemberStats;
}

interface Reply {
  id: string;
  body: string;
  createdAt: string;
  agent: { name: string };
  user: { fullName: string; username: string };
}

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

export default function AdminSupportTeamPage() {
  const api = useApi();
  const [team, setTeam] = useState<Member[]>([]);
  const [pending, setPending] = useState<{ count: number; oldestWaitingAt: string | null }>({ count: 0, oldestWaitingAt: null });
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Member | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);

  const load = useCallback(async () => {
    const res = await api<{ team: Member[]; pending: { count: number; oldestWaitingAt: string | null } }>("/api/admin/support-team");
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
      await api("/api/admin/support-team", { method: "POST", body: JSON.stringify({ fullName, username, email, password }) });
      setCreated({ username, email, password });
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create support account.");
    } finally {
      setBusy(false);
    }
  }

  async function viewReplies(member: Member) {
    setViewing(member);
    setReplies([]);
    const res = await api<{ replies: Reply[] }>(`/api/admin/support-team/${member.id}/replies`);
    setReplies(res.replies);
  }

  async function resetPassword(member: Member) {
    const pw = window.prompt(`New password for ${member.fullName} (min 8 characters):`);
    if (!pw) return;
    try {
      await api(`/api/admin/support-team/${member.id}/password`, { method: "POST", body: JSON.stringify({ password: pw }) });
      window.alert(`Password updated. ${member.fullName} has been signed out and must log in with the new password.`);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Could not reset password.");
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove support access for ${member.fullName}? They will be signed out immediately.`)) return;
    try {
      await api(`/api/admin/support-team/${member.id}`, { method: "DELETE" });
      if (viewing?.id === member.id) setViewing(null);
      await load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Could not remove support access.");
    }
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-2">Support Team</h1>
      <p className="text-sm text-muted mb-6">
        Support accounts can only open the Support inbox. Share the login below with your team member; they sign in at{" "}
        <span className="text-white">/login</span>.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="card">
          <p className="text-xs text-muted">Chats waiting for reply</p>
          <p className={`text-2xl font-bold ${pending.count > 0 ? "text-primary" : ""}`}>{pending.count}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted">Oldest waiting</p>
          <p className="text-2xl font-bold">{pending.oldestWaitingAt ? timeAgo(pending.oldestWaitingAt) : "—"}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted">Team replies today</p>
          <p className="text-2xl font-bold">{team.reduce((n, m) => n + m.stats.repliesToday, 0)}</p>
        </div>
      </div>

      <form onSubmit={handleCreate} className="card mb-6 space-y-3">
        <h2 className="font-bold">Create Support Login</h2>
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
            <p className="font-medium text-green-400 mb-1">Support login created. Share these details:</p>
            <p>
              Login: <span className="font-mono">{created.email}</span> or <span className="font-mono">{created.username}</span>
            </p>
            <p>
              Password: <span className="font-mono">{created.password}</span>
            </p>
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create Support Login"}
        </button>
      </form>

      <div className="card p-0 overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-3 py-3 font-medium">Today</th>
              <th className="px-3 py-3 font-medium">7 days</th>
              <th className="px-3 py-3 font-medium">Chats (7d)</th>
              <th className="px-3 py-3 font-medium">Avg response</th>
              <th className="px-3 py-3 font-medium">Last reply</th>
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
                <td className="px-3 py-3">{m.stats.repliesToday}</td>
                <td className="px-3 py-3">{m.stats.replies7d}</td>
                <td className="px-3 py-3">{m.stats.chats7d}</td>
                <td className="px-3 py-3">{formatMins(m.stats.avgResponseMins)}</td>
                <td className="px-3 py-3 whitespace-nowrap">{timeAgo(m.stats.lastReplyAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2 whitespace-nowrap">
                    <button onClick={() => viewReplies(m)} className="btn-ghost text-xs px-2 py-1">
                      Replies
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
        {team.length === 0 && <p className="text-muted text-sm text-center py-8">No support logins yet. Create one above.</p>}
      </div>
      <p className="text-xs text-muted -mt-4 mb-6">
        Avg response is measured over the last 30 days, from a user&apos;s first unanswered message to the reply.
      </p>

      {viewing && (
        <div className="card p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <p className="font-semibold text-sm">Latest replies by {viewing.fullName}</p>
              <p className="text-xs text-muted">{viewing.stats.repliesTotal} replies in total</p>
            </div>
            <button onClick={() => setViewing(null)} className="text-muted hover:text-white text-sm">
              Close
            </button>
          </div>
          <div className="divide-y divide-border max-h-[60vh] overflow-y-auto">
            {replies.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <p className="text-xs text-muted mb-1">
                  To {r.user.fullName} (@{r.user.username}) as {r.agent.name} · {new Date(r.createdAt).toLocaleString()}
                </p>
                <p className="text-sm whitespace-pre-wrap">{r.body}</p>
              </div>
            ))}
            {replies.length === 0 && <p className="text-muted text-sm text-center py-8">No replies yet.</p>}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
