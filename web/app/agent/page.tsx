"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";

interface Stats {
  gameAccountCount: number;
  totalGameBalance: string;
  pendingRequests: number;
  pendingByType: Partial<Record<"CREATE_ACCOUNT" | "RECHARGE" | "REDEEM" | "PASSWORD_RESET", number>>;
  myOpenRequests: number;
  handledToday: number;
  pendingCashouts: number;
}

const TYPE_LABELS = {
  CREATE_ACCOUNT: "New accounts",
  RECHARGE: "Loads",
  REDEEM: "Redeems",
  PASSWORD_RESET: "Password resets",
} as const;

export default function AgentDashboardPage() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () => api<Stats>("/api/agent/stats").then(setStats).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [api]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Agent Dashboard</h1>

      <Link href="/agent/requests" className="card block mb-4 hover:border-primary transition-colors">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-muted text-xs mb-1">Requests waiting</p>
            <p className={`text-3xl font-extrabold ${stats?.pendingRequests ? "text-primary" : ""}`}>{stats?.pendingRequests ?? "—"}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).map((t) => (
              <span key={t} className="bg-surface2 rounded-lg px-2.5 py-1.5">
                {TYPE_LABELS[t]}: <strong>{stats?.pendingByType[t] ?? 0}</strong>
              </span>
            ))}
          </div>
          <span className="btn-primary text-sm">Open requests →</span>
        </div>
      </Link>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-muted text-xs mb-1">On my plate</p>
          <p className="text-2xl font-extrabold">{stats?.myOpenRequests ?? "—"}</p>
        </div>
        <div className="card">
          <p className="text-muted text-xs mb-1">I finished today</p>
          <p className="text-2xl font-extrabold">{stats?.handledToday ?? "—"}</p>
        </div>
        <div className="card">
          <p className="text-muted text-xs mb-1">Active game accounts</p>
          <p className="text-2xl font-extrabold">{stats?.gameAccountCount ?? "—"}</p>
        </div>
        <div className="card">
          <p className="text-muted text-xs mb-1">Recorded game balance</p>
          <p className="text-2xl font-extrabold text-primary">${Number(stats?.totalGameBalance ?? 0).toFixed(2)}</p>
        </div>
      </div>

      <div className="card mt-6 text-sm space-y-2">
        <p className="font-bold">How it works</p>
        <ol className="list-decimal pl-5 space-y-1 text-muted">
          <li>Open <strong>Requests</strong>, pick the oldest one and press <strong>Claim</strong> so no other agent works it at the same time.</li>
          <li>Do the work on the game&apos;s own back office (create the account, load or redeem credits, reset the password).</li>
          <li>Come back and confirm it here. Players see the result instantly; loads were already paid from their wallet, redeems are credited to it.</li>
          <li>Can&apos;t do it? <strong>Reject</strong> with a reason — any money held for it goes back to the player&apos;s wallet automatically.</li>
          <li>Use <strong>Game Records → Update balance</strong> whenever you check a player&apos;s real balance, so their card stays accurate.</li>
        </ol>
      </div>
    </AgentShell>
  );
}
