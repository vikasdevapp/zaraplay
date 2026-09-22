"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import { useApi } from "@/context/AuthContext";

interface Entry {
  rank: number;
  userId: string;
  username: string;
  totalDeposited: string;
  isMe: boolean;
}

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function LeaderboardPage() {
  const api = useApi();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ entries: Entry[] }>("/api/leaderboard")
      .then((res) => setEntries(res.entries))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  return (
    <AppShell>
      <div className="card mb-5">
        <h1 className="font-bold text-lg mb-1">🏆 Leaderboard</h1>
        <p className="text-sm text-muted">Top players by lifetime deposits.</p>
      </div>

      <div className="card p-0 divide-y divide-border">
        {loading && <p className="text-muted text-sm text-center py-10">Loading…</p>}
        {!loading && entries.length === 0 && <p className="text-muted text-sm text-center py-10">No deposits yet — be the first!</p>}
        {entries.map((e) => (
          <div key={e.userId} className={`flex items-center justify-between px-4 py-3 ${e.isMe ? "bg-primary/10" : ""}`}>
            <div className="flex items-center gap-3">
              <span className="w-8 text-center font-bold text-muted">{MEDALS[e.rank] ?? `#${e.rank}`}</span>
              <span className={`font-medium ${e.isMe ? "text-primary" : ""}`}>
                {e.username}
                {e.isMe && <span className="text-xs text-muted"> (you)</span>}
              </span>
            </div>
            <span className="font-semibold text-primary">${Number(e.totalDeposited).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
