"use client";

import { useEffect, useState } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";

interface GameBalance {
  game: { id: string; name: string } | null;
  totalBalance: string;
  accountCount: number;
}

export default function AgentGameBalancesPage() {
  const api = useApi();
  const [balances, setBalances] = useState<GameBalance[]>([]);

  useEffect(() => {
    api<{ balances: GameBalance[] }>("/api/agent/game-balances")
      .then((res) => setBalances(res.balances))
      .catch(() => {});
  }, [api]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Game Balances</h1>
      <p className="text-muted text-sm mb-4">
        Aggregate balance stored per game across all players. This reads our own database only — no live
        third-party balance check.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {balances.map((b) => (
          <div key={b.game?.id} className="card">
            <p className="text-sm font-medium mb-1">{b.game?.name}</p>
            <p className="text-xl font-bold text-primary">${Number(b.totalBalance).toFixed(2)}</p>
            <p className="text-xs text-muted">{b.accountCount} accounts</p>
          </div>
        ))}
        {balances.length === 0 && <p className="text-muted text-sm">No game accounts yet.</p>}
      </div>
    </AgentShell>
  );
}
