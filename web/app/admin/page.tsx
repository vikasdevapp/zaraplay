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

interface GatewayStatus {
  configured: boolean;
  payEnabled: boolean;
  transferEnabled: boolean;
  healthy: boolean | null;
  accounts: { currency: string; balance: number; availableBalance: number; transferPendingAmount: number }[];
  balanceError?: string | null;
}

const cents = (v: number) => `$${(v / 100).toFixed(2)}`;

export default function AdminDashboardPage() {
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);

  useEffect(() => {
    api<Stats>("/api/admin/stats").then(setStats).catch(() => {});
    api<GatewayStatus>("/api/admin/payment-gateway").then(setGateway).catch(() => {});
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

      {gateway && (
        <div className="card mt-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold">Payment Gateway</h2>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                !gateway.configured
                  ? "bg-surface2 text-muted"
                  : gateway.healthy
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"
              }`}
            >
              {!gateway.configured ? "Not configured" : gateway.healthy ? "Online" : "Unreachable"}
            </span>
          </div>
          {gateway.configured && (
            <>
              <p className="text-xs text-muted mb-2">
                Deposits: {gateway.payEnabled ? "via gateway" : "manual"} · Payouts: {gateway.transferEnabled ? "via gateway" : "manual"}
              </p>
              {gateway.balanceError && <p className="text-xs text-red-400">{gateway.balanceError}</p>}
              {gateway.accounts.map((a) => (
                <p key={a.currency} className="text-sm">
                  <span className="uppercase font-medium">{a.currency}</span> · Available {cents(a.availableBalance)} · Balance{" "}
                  {cents(a.balance)} · Pending payouts {cents(a.transferPendingAmount)}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </AdminShell>
  );
}
