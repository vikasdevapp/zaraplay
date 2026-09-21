"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";

interface Account {
  id: string;
  gameUsername: string;
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
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {accounts.map((a) => (
              <tr key={a.id} className="hover:bg-surface2">
                <td className="px-4 py-3">{a.user.fullName} <span className="text-muted">@{a.user.username}</span></td>
                <td className="px-4 py-3">{a.game.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{a.gameUsername}</td>
                <td className="px-4 py-3 text-primary">${Number(a.balance).toFixed(2)}</td>
                <td className="px-4 py-3 text-muted">{new Date(a.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {accounts.length === 0 && <p className="text-muted text-sm text-center py-8">No game accounts found.</p>}
        {accounts.length > 0 && <p className="text-muted text-xs px-4 py-2">{total} total</p>}
      </div>
    </AdminShell>
  );
}
