"use client";

import { useCallback, useEffect, useState, FormEvent } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface StaffMember {
  id: string;
  fullName: string;
  username: string;
  email: string;
  createdAt: string;
  staffGame: { id: string; name: string } | null;
}

interface GameOption {
  id: string;
  name: string;
}

const emptyForm = { fullName: "", username: "", email: "", gameId: "", password: "" };

export default function AgentStaffPage() {
  const api = useApi();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [games, setGames] = useState<GameOption[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password?: string } | null>(null);

  const load = useCallback(async () => {
    const [s, g] = await Promise.all([
      api<{ staff: StaffMember[] }>("/api/agent/staff"),
      api<{ games: GameOption[] }>("/api/agent/staff/my-games"),
    ]);
    setStaff(s.staff);
    setGames(g.games);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    setBusy(true);
    try {
      const res = await api<{ member: StaffMember; password?: string }>("/api/agent/staff", {
        method: "POST",
        body: JSON.stringify({
          fullName: form.fullName,
          username: form.username,
          email: form.email,
          gameId: form.gameId,
          ...(form.password ? { password: form.password } : {}),
        }),
      });
      setCreated({ username: res.member.username, password: res.password });
      setForm(emptyForm);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create staff member.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(m: StaffMember) {
    setError(null);
    setCreated(null);
    try {
      const res = await api<{ password?: string }>(`/api/agent/staff/${m.id}/password`, { method: "POST", body: JSON.stringify({}) });
      setCreated({ username: m.username, password: res.password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset password.");
    }
  }

  async function remove(m: StaffMember) {
    if (!window.confirm(`Remove staff @${m.username}? They become a regular player and lose dashboard access.`)) return;
    setError(null);
    try {
      await api(`/api/agent/staff/${m.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove staff member.");
    }
  }

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-2">My Staff</h1>
      <p className="text-sm text-muted mb-6">
        Create support staff for the games you manage. Each staff member can handle support and
        cashouts for their assigned game only.
      </p>

      {games.length === 0 ? (
        <div className="card text-sm text-muted">
          No games are assigned to you yet. Ask an admin to assign you as the agent for a game
          (Admin → Games).
        </div>
      ) : (
        <form onSubmit={create} className="card space-y-3 mb-6">
          <h2 className="font-bold">Add staff member</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className="input" placeholder="Full name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} required />
            <input className="input" placeholder="Username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
            <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
            <select className="input" value={form.gameId} onChange={(e) => setForm((f) => ({ ...f, gameId: e.target.value }))} required>
              <option value="" disabled>
                Assign to game…
              </option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <input
            className="input"
            placeholder="Password (leave blank to auto-generate)"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create staff login"}
          </button>
        </form>
      )}

      {created && (
        <div className="card mb-6 border border-primary/40">
          <p className="font-semibold text-primary mb-1">Login ready</p>
          <p className="text-sm">
            Username: <span className="font-mono">{created.username}</span>
          </p>
          {created.password ? (
            <p className="text-sm">
              Temporary password: <span className="font-mono">{created.password}</span>
            </p>
          ) : (
            <p className="text-sm text-muted">Password set to what you entered.</p>
          )}
          <p className="text-xs text-muted mt-1">Share these once — the password isn&apos;t shown again.</p>
        </div>
      )}

      <div className="card p-0">
        <h2 className="font-bold px-4 pt-4">Staff ({staff.length})</h2>
        {staff.length === 0 ? (
          <p className="text-sm text-muted px-4 py-6">No staff yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {staff.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">
                    {m.fullName} <span className="text-muted">@{m.username}</span>
                  </p>
                  <p className="text-xs text-muted truncate">
                    {m.email} · {m.staffGame?.name ?? "no game"}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-sm">
                  <button onClick={() => resetPassword(m)} className="text-muted hover:text-white underline">
                    Reset password
                  </button>
                  <button onClick={() => remove(m)} className="text-red-400 hover:text-red-300 underline">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AgentShell>
  );
}
