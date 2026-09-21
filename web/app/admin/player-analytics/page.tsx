"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";

interface Player {
  id: string;
  fullName: string;
  username: string;
  net: number;
  totalDeposited: number;
  totalPayout: number;
  gameBalance: number;
  referralCount: number;
  freePlay: number;
  daysSinceActivity: number | null;
}

interface Summary {
  totalPlayers: number;
  newSignups: number;
  activePlayers: number;
  depositors: number;
  fpOnly: number;
  estProfit: number;
}

interface Segments {
  profitPlayers: Player[];
  riskPlayers: Player[];
  heavyDepositors: Player[];
  gameLoaders: Player[];
  bigRedeemers: Player[];
  fpOnlyPlayers: Player[];
  newSignups: Player[];
  activePlayers: Player[];
  referralLeaders: Player[];
  riskWatch: Player[];
  inactiveCold: Player[];
}

const SEGMENT_TABS: { key: keyof Segments; label: string; icon: string; valueLabel: (p: Player) => string }[] = [
  { key: "profitPlayers", label: "Profit Players", icon: "📈", valueLabel: (p) => `+$${p.net.toFixed(2)}` },
  { key: "riskPlayers", label: "Loss / Risk", icon: "📉", valueLabel: (p) => `-$${Math.abs(p.net).toFixed(2)}` },
  { key: "heavyDepositors", label: "Heavy Depositors", icon: "🔥", valueLabel: (p) => `$${p.totalDeposited.toFixed(2)}` },
  { key: "gameLoaders", label: "Game Loaders", icon: "🎮", valueLabel: (p) => `$${p.gameBalance.toFixed(2)}` },
  { key: "bigRedeemers", label: "Big Redeemers", icon: "👑", valueLabel: (p) => `$${p.totalPayout.toFixed(2)}` },
  { key: "fpOnlyPlayers", label: "FP Only", icon: "🎁", valueLabel: (p) => `${p.freePlay.toFixed(2)} FP` },
  { key: "newSignups", label: "New Signups", icon: "➕", valueLabel: () => "" },
  { key: "activePlayers", label: "Active Players", icon: "⚡", valueLabel: (p) => `${p.daysSinceActivity ?? "-"}d ago` },
  { key: "referralLeaders", label: "Referral Leaders", icon: "👥", valueLabel: (p) => `${p.referralCount} refs` },
  { key: "riskWatch", label: "Risk Watch", icon: "⚠️", valueLabel: (p) => `${((p.totalPayout / p.totalDeposited) * 100).toFixed(0)}%` },
  { key: "inactiveCold", label: "Inactive / Cold", icon: "🧊", valueLabel: (p) => `${p.daysSinceActivity ?? "∞"}d ago` },
];

export default function AdminPlayerAnalyticsPage() {
  const api = useApi();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [segments, setSegments] = useState<Segments | null>(null);
  const [tab, setTab] = useState<keyof Segments>("profitPlayers");

  useEffect(() => {
    api<{ summary: Summary; segments: Segments }>("/api/admin/player-analytics")
      .then((res) => {
        setSummary(res.summary);
        setSegments(res.segments);
      })
      .catch(() => {});
  }, [api]);

  const activeTab = SEGMENT_TABS.find((t) => t.key === tab)!;
  const rows = segments?.[tab] ?? [];

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Player Analytics</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {summary && [
          { label: "Total Players", value: summary.totalPlayers },
          { label: "New (7d)", value: summary.newSignups },
          { label: "Active (7d)", value: summary.activePlayers },
          { label: "Depositors", value: summary.depositors },
          { label: "FP Only", value: summary.fpOnly },
          { label: "Est. Profit", value: `$${summary.estProfit.toFixed(2)}`, highlight: true },
        ].map((c) => (
          <div key={c.label} className="card">
            <p className="text-[11px] text-muted mb-1">{c.label}</p>
            <p className={`text-lg font-bold ${c.highlight ? "text-primary" : ""}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {SEGMENT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === t.key ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
          >
            {t.icon} {t.label} ({segments?.[t.key].length ?? 0})
          </button>
        ))}
      </div>

      <div className="card p-0 divide-y divide-border">
        {rows.map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <Link href={`/admin/users/${p.id}`} className="text-primary font-medium">
              {p.fullName} <span className="text-muted">@{p.username}</span>
            </Link>
            <span className="text-muted">{activeTab.valueLabel(p)}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-muted text-sm text-center py-8">No players in this segment.</p>}
      </div>
    </AdminShell>
  );
}
