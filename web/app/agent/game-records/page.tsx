"use client";

import { useEffect, useState, useCallback } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";

interface Account {
  id: string;
  gameUsername: string;
  balance: string;
  createdAt: string;
  user: { id: string; fullName: string; username: string };
  game: { id: string; name: string };
}

export default function AgentGameRecordsPage() {
  const api = useApi();
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  const load = useCallback(
    async (q: string) => {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      const res = await api<{ accounts: Account[] }>(`/api/agent/game-records?${params}`);
      setAccounts(res.accounts);
    },
    [api]
  );

  useEffect(() => {
    load("").catch(() => {});
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Game Records</h1>
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
      </div>
    </AgentShell>
  );
}
