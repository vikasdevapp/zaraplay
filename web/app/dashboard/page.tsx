"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import AppShell from "@/components/AppShell";
import NotificationCard from "@/components/NotificationCard";
import { useAuth, useApi } from "@/context/AuthContext";

interface Wallet {
  balance: string;
  freePlay: string;
  totalDeposited: string;
}

interface Game {
  id: string;
  name: string;
  imageUrl: string | null;
}

interface LeaderEntry {
  rank: number;
  userId: string;
  username: string;
  totalDeposited: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const api = useApi();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showBalance, setShowBalance] = useState(true);
  const [hotGames, setHotGames] = useState<Game[]>([]);
  const [leaders, setLeaders] = useState<LeaderEntry[]>([]);
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ wallet: Wallet }>("/api/wallet")
      .then((res) => setWallet(res.wallet))
      .catch(() => {});
    api<{ games: Game[] }>("/api/games/catalog")
      .then((res) => setHotGames(res.games.slice(0, 4)))
      .catch(() => {});
    api<{ entries: LeaderEntry[] }>("/api/leaderboard")
      .then((res) => setLeaders(res.entries.slice(0, 3)))
      .catch(() => {});
    api<{ user: { phoneVerified: boolean } }>("/api/profile")
      .then((res) => setPhoneVerified(res.user.phoneVerified))
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
          <NotificationCard />
          {phoneVerified ? (
            <div className="card">
              <p className="font-semibold mb-1">✅ Number verified</p>
              <p className="text-sm text-muted">You&apos;re all set — thanks for confirming your number.</p>
            </div>
          ) : (
            <Link href="/verify-phone" className="card block hover:border-primary transition-colors">
              <p className="font-semibold mb-1">📱 Verify your number</p>
              <p className="text-sm text-muted">Get free play after phone verification.</p>
            </Link>
          )}
          <div className="card">
            <p className="font-semibold mb-1">🎁 Weekly bonus</p>
            <p className="text-sm text-muted">50% deposit bonus every Tuesday.</p>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">🔥 Hot Games</h2>
            <Link href="/games" className="text-sm text-primary font-medium">
              See all
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {hotGames.map((g) => (
              <Link key={g.id} href="/games" className="card p-0 aspect-square relative overflow-hidden group">
                {g.imageUrl ? (
                  <Image
                    src={g.imageUrl}
                    alt={g.name}
                    fill
                    unoptimized
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 45vw, 20vw"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/30 to-surface text-2xl font-bold">
                    {g.name.slice(0, 1)}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                  <p className="text-xs font-medium text-center truncate">{g.name}</p>
                </div>
              </Link>
            ))}
            {hotGames.length === 0 && <p className="text-muted text-sm col-span-full text-center py-6">No games yet.</p>}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-lg">🏆 Leaderboard</h2>
            <Link href="/leaderboard" className="text-sm text-primary font-medium">
              See all
            </Link>
          </div>
          <div className="card p-0 divide-y divide-border">
            {leaders.map((e) => (
              <div key={e.userId} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">
                  {e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : "🥉"} {e.username}
                </span>
                <span className="text-primary font-semibold">${Number(e.totalDeposited).toFixed(2)}</span>
              </div>
            ))}
            {leaders.length === 0 && <p className="text-muted text-sm text-center py-6">No deposits yet — be the first!</p>}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
