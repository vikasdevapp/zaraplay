"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import Link from "next/link";

interface Stats {
  totalUsers: number;
  activeGames: number;
  pendingCashouts: number;
  totalDeposited: string;
  totalPaidOut: string;
  walletLiability: string;
  freePlayLiability: string;
}

export default function AdminDashboardPage() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>("/api/admin/stats").then(setStats).catch(() => {});
  }, [api]);

  const cards = stats
    ? [
        { label: "Total Users", value: stats.totalUsers, isCurrency: false },
        { label: "Active Games", value: stats.activeGames, isCurrency: false },
        { label: "Pending Cashouts", value: stats.pendingCashouts, isCurrency: false, href: "/admin/cashouts" },
        { label: "Total Deposited", value: `$${Number(stats.totalDeposited).toFixed(2)}`, isCurrency: true },
        { label: "Total Paid Out", value: `$${Number(stats.totalPaidOut).toFixed(2)}`, isCurrency: true },
        { label: "Wallet Liability", value: `$${Number(stats.walletLiability).toFixed(2)}`, isCurrency: true },
        { label: "Free Play Liability", value: `$${Number(stats.freePlayLiability).toFixed(2)}`, isCurrency: true },
      ]
    : [];

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => {
          const content = (
            <div className="card">
              <p className="text-muted text-xs mb-1">{c.label}</p>
              <p className={`text-2xl font-extrabold ${c.isCurrency ? "text-primary" : ""}`}>{c.value}</p>
            </div>
          );
          return c.href ? (
            <Link key={c.label} href={c.href}>
              {content}
            </Link>
          ) : (
            <div key={c.label}>{content}</div>
          );
        })}
      </div>

      {stats && stats.pendingCashouts > 0 && (
        <div className="card mt-6 border-yellow-500/40">
          <p className="font-semibold">
            ⚠ {stats.pendingCashouts} cashout request{stats.pendingCashouts === 1 ? "" : "s"} awaiting review.
          </p>
          <Link href="/admin/cashouts" className="text-primary text-sm font-medium">
            Review now →
          </Link>
        </div>
      )}
    </AdminShell>
  );
}
