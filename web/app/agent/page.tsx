"use client";

import { useEffect, useState } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";

interface Stats {
  gameAccountCount: number;
  pendingCashouts: number;
  totalGameBalance: string;
}

export default function AgentDashboardPage() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>("/api/agent/stats").then(setStats).catch(() => {});
  }, [api]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Agent Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-muted text-xs mb-1">Game Accounts</p>
          <p className="text-2xl font-extrabold">{stats?.gameAccountCount ?? "—"}</p>
        </div>
        <div className="card">
          <p className="text-muted text-xs mb-1">Total Game Balance</p>
          <p className="text-2xl font-extrabold text-primary">${Number(stats?.totalGameBalance ?? 0).toFixed(2)}</p>
        </div>
        <div className="card">
          <p className="text-muted text-xs mb-1">Pending Cashouts</p>
          <p className="text-2xl font-extrabold">{stats?.pendingCashouts ?? "—"}</p>
        </div>
      </div>
      <p className="text-muted text-sm mt-6">
        Use the sidebar to check game balances, browse game records, review the recharge/redeem ledger, or see your
        own recent activity.
      </p>
    </AgentShell>
  );
}
