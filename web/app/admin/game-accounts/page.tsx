"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Account {
  id: string;
  gameUsername: string | null;
  gamePassword: string | null;
  balance: string;
  createdAt: string;
  user: { id: string; fullName: string; username: string };
  game: { id: string; name: string };
}

interface GameBalance {
  game: { id: string; name: string } | null;
  totalBalance: string;
  accountCount: number;
}

function AccountRow({ a, onChanged }: { a: Account; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ linked?: boolean; reason?: string }>(`/api/admin/game-accounts/${a.id}/credentials`, {
        method: "PUT",
        body: JSON.stringify({ gameUsername: username, gamePassword: password }),
      });
      if (res.reason) {
        setErr(`Saved, but couldn't link to the game account (${res.reason}). Make sure the username exists on the game platform, or loads/withdraws may go to the wrong account.`);
        return;
      }
      setEditing(false);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update login.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr className="bg-surface2 align-top">
        <td className="px-4 py-3">
          {a.user.fullName} <span className="text-muted">@{a.user.username}</span>
        </td>
        <td className="px-4 py-3">{a.game.name}</td>
        <td className="px-4 py-3" colSpan={3}>
          <div className="flex flex-col sm:flex-row gap-2">
            <input className="input" placeholder="Game ID (username)" value={username} onChange={(e) => setUsername(e.target.value)} />
            <input className="input" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {err && <p className="text-xs text-red-400 mt-1">{err}</p>}
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-2">
            <button className="btn-primary text-xs px-3 py-1.5" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="btn-ghost text-xs px-3 py-1.5" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-surface2">
      <td className="px-4 py-3">
        {a.user.fullName} <span className="text-muted">@{a.user.username}</span>
      </td>
      <td className="px-4 py-3">{a.game.name}</td>
      <td className="px-4 py-3 font-mono text-xs">{a.gameUsername ?? <span className="text-muted font-sans">being created</span>}</td>
      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
        {a.gamePassword ? (
          <>
            {showPw ? a.gamePassword : "••••••"}{" "}
            <button className="text-primary font-sans" onClick={() => setShowPw((s) => !s)}>
              {showPw ? "hide" : "show"}
            </button>
          </>
        ) : (
          <span className="text-muted font-sans">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-primary">${Number(a.balance).toFixed(2)}</td>
      <td className="px-4 py-3">
        <button
          className="text-xs text-primary underline"
          onClick={() => {
            setUsername(a.gameUsername ?? "");
            setPassword(a.gamePassword ?? "");
            setErr(null);
            setEditing(true);
          }}
        >
          Edit login
        </button>
      </td>
    </tr>
  );
}

export default function AdminGameAccountsPage() {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [balances, setBalances] = useState<GameBalance[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    const res = await api<{ accounts: Account[]; total: number }>(`/api/admin/game-accounts?${params}`);
    setAccounts(res.accounts);
    setTotal(res.total);
  }, [api, search]);

  useEffect(() => {
    api<{ balances: GameBalance[] }>("/api/admin/game-accounts/balances")
      .then((res) => setBalances(res.balances))
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Game Accounts</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {balances.map((b) => (
          <div key={b.game?.id} className="card">
            <p className="text-xs text-muted mb-1">{b.game?.name}</p>
            <p className="text-lg font-bold text-primary">${Number(b.totalBalance).toFixed(2)}</p>
            <p className="text-xs text-muted">{b.accountCount} accounts</p>
          </div>
        ))}
      </div>

      <input className="input mb-4" placeholder="Search by username or email…" value={search} onChange={(e) => setSearch(e.target.value)} />

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-border">
              <th className="px-4 py-3">Player</th>
              <th className="px-4 py-3">Game</th>
              <th className="px-4 py-3">Game ID</th>
              <th className="px-4 py-3">Password</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((a) => (
              <AccountRow key={a.id} a={a} onChanged={load} />
            ))}
          </tbody>
        </table>
        {accounts.length === 0 && <p className="text-muted text-sm text-center py-8">No game accounts found.</p>}
        {accounts.length > 0 && <p className="text-muted text-xs px-4 py-2">{total} total</p>}
      </div>
    </AdminShell>
  );
}
