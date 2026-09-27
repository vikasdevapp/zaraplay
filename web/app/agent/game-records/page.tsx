"use client";

import { useEffect, useState, useCallback } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Account {
  id: string;
  status: "PENDING" | "ACTIVE";
  gameUsername: string | null;
  gamePassword: string | null;
  balance: string;
  balanceSyncedAt: string | null;
  balanceSyncedBy: { username: string } | null;
  createdAt: string;
  user: { id: string; fullName: string; username: string };
  game: { id: string; name: string };
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function AccountRow({ a, onChanged }: { a: Account; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [mode, setMode] = useState<"view" | "balance" | "login">("view");
  const [balance, setBalance] = useState(Number(a.balance).toFixed(2));
  const [username, setUsername] = useState(a.gameUsername ?? "");
  const [password, setPassword] = useState(a.gamePassword ?? "");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "balance") {
        await api(`/api/agent/game-accounts/${a.id}/balance`, { method: "POST", body: JSON.stringify({ balance: Number(balance) }) });
      } else {
        await api(`/api/agent/game-accounts/${a.id}/credentials`, { method: "PUT", body: JSON.stringify({ gameUsername: username, gamePassword: password }) });
      }
      setMode("view");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const active = a.status === "ACTIVE";

  return (
    <div className="px-4 py-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-medium">
            {a.user.fullName} <span className="text-muted">@{a.user.username}</span>
          </p>
          <p className="text-xs text-muted">
            {a.game.name} · added {new Date(a.createdAt).toLocaleDateString()}
            {!active && <span className="ml-1 text-yellow-400">· waiting for account creation</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="text-primary font-semibold">${Number(a.balance).toFixed(2)}</p>
          <p className="text-[10px] text-muted">
            synced {ago(a.balanceSyncedAt)}
            {a.balanceSyncedBy && ` by @${a.balanceSyncedBy.username}`}
          </p>
        </div>
      </div>

      {active && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
          <span>
            <span className="text-muted font-sans">ID </span>
            {a.gameUsername}
          </span>
          <span>
            <span className="text-muted font-sans">PW </span>
            {showPw ? a.gamePassword : "••••••"}
            <button className="ml-1 text-primary font-sans" onClick={() => setShowPw((s) => !s)}>
              {showPw ? "hide" : "show"}
            </button>
          </span>
        </div>
      )}

      {active && mode === "view" && (
        <div className="flex gap-2">
          <button className="btn-ghost text-xs px-2 py-1" onClick={() => {
              setBalance(Number(a.balance).toFixed(2));
              setMode("balance");
            }}>
            Update balance
          </button>
          <button className="btn-ghost text-xs px-2 py-1" onClick={() => {
              setUsername(a.gameUsername ?? "");
              setPassword(a.gamePassword ?? "");
              setMode("login");
            }}>
            Edit login
          </button>
        </div>
      )}

      {mode !== "view" && (
        <div className="flex flex-wrap items-end gap-2">
          {mode === "balance" ? (
            <label className="text-xs text-muted">
              Balance on the game platform right now
              <input className="input mt-1 w-40" type="number" step="0.01" min="0" value={balance} onChange={(e) => setBalance(e.target.value)} />
            </label>
          ) : (
            <>
              <input className="input w-44" placeholder="Game username" value={username} onChange={(e) => setUsername(e.target.value)} />
              <input className="input w-44" placeholder="Game password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          )}
          <button className="btn-primary text-xs px-3 py-2" disabled={busy} onClick={save}>
            Save
          </button>
          <button className="btn-ghost text-xs px-3 py-2" disabled={busy} onClick={() => setMode("view")}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export default function AgentGameRecordsPage() {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    const res = await api<{ accounts: Account[] }>(`/api/agent/game-records?${params}`);
    setAccounts(res.accounts);
  }, [api, search]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-2">Game Records</h1>
      <p className="text-sm text-muted mb-4">
        Every player&apos;s game login. Use <strong>Update balance</strong> after checking their real balance on the game platform, so the player sees the
        right amount.
      </p>
      <input className="input mb-4" placeholder="Search by player username, email or game ID…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="card p-0 divide-y divide-border">
        {accounts.map((a) => (
          <AccountRow key={a.id} a={a} onChanged={load} />
        ))}
        {accounts.length === 0 && <p className="text-muted text-sm text-center py-8">No game accounts found.</p>}
      </div>
    </AgentShell>
  );
}
