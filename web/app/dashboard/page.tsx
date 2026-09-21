"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useAuth, useApi } from "@/context/AuthContext";

interface Wallet {
  balance: string;
  freePlay: string;
  totalDeposited: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const api = useApi();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showBalance, setShowBalance] = useState(true);

  useEffect(() => {
    if (!user) return;
    api<{ wallet: Wallet }>("/api/wallet")
      .then((res) => setWallet(res.wallet))
      .catch(() => {});
  }, [user, api]);

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-muted text-sm">Good to see you,</p>
          <h1 className="text-2xl font-bold">{user?.fullName}</h1>
        </div>

        <div className="card bg-gradient-to-br from-surface2 to-surface border-primary/40">
          <div className="flex items-center justify-between mb-1">
            <p className="text-muted text-sm">Wallet Balance</p>
            <button onClick={() => setShowBalance((s) => !s)} className="text-muted text-sm">
              {showBalance ? "🙈 Hide" : "👁 Show"}
            </button>
          </div>
          <p className="text-4xl font-extrabold text-primary">
            {showBalance ? `$${Number(wallet?.balance ?? 0).toFixed(2)}` : "••••"}
          </p>
          <p className="text-sm text-muted mt-2">
            Free Play: <span className="text-white font-medium">{Number(wallet?.freePlay ?? 0).toFixed(2)} FP</span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="card">
            <p className="font-semibold mb-1">🔔 Allow notifications</p>
            <p className="text-sm text-muted">Never miss a bonus, payment or chat alert.</p>
          </div>
          <div className="card">
            <p className="font-semibold mb-1">📱 Verify your number</p>
            <p className="text-sm text-muted">Get $5 free play after phone verification.</p>
          </div>
          <div className="card">
            <p className="font-semibold mb-1">🎁 Weekly bonus</p>
            <p className="text-sm text-muted">50% deposit bonus every Tuesday.</p>
          </div>
        </div>

        <div>
          <h2 className="font-bold text-lg mb-3">🔥 Hot Games</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {["Fortune Coins", "Golden Reels", "Vault Masters", "Celestial Stars"].map((name) => (
              <div key={name} className="card aspect-square flex items-end justify-center bg-gradient-to-br from-primary/30 to-surface">
                <p className="text-sm font-medium text-center pb-1">{name}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
