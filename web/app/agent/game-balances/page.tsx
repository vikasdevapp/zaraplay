"use client";

import { useCallback, useEffect, useState } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi, useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { money } from "@/lib/desk";

interface GameBalance {
  id: string;
  name: string;
  isActive: boolean;
  backendBalance: number;
  backendLowAt: number;
  backendUpdatedAt: string | null;
  low: boolean;
  accounts: number;
  playerBalance: number;
}

function GameRow({ g, isAdmin, onChanged }: { g: GameBalance; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [mode, setMode] = useState<"view" | "topup" | "set">("view");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [balance, setBalance] = useState("");
  const [lowAt, setLowAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "topup") {
        await api(`/api/agent/desk/games/${g.id}/topups`, { method: "POST", body: JSON.stringify({ amount: Number(amount), ...(note.trim() ? { note: note.trim() } : {}) }) });
      } else {
        await api(`/api/agent/desk/games/${g.id}/backend`, {
          method: "POST",
          body: JSON.stringify({ balance: Number(balance), ...(isAdmin && lowAt !== "" ? { lowAt: Number(lowAt) } : {}) }),
        });
      }
      setMode("view");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium">{g.name}</p>
        {!g.isActive && <p className="text-[10px] text-muted">hidden from site</p>}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <p className={`font-semibold ${g.low ? "text-red-400" : ""}`}>
          {g.low && "⚠ "}
          {money(g.backendBalance)}
        </p>
        <p className="text-[10px] text-muted">
          {g.backendLowAt > 0 ? `alert at ${money(g.backendLowAt)}` : "no alert set"}
          {g.backendUpdatedAt && ` · set ${new Date(g.backendUpdatedAt).toLocaleDateString()}`}
        </p>
      </td>
      <td className="px-3 py-3 text-right">{g.accounts}</td>
      <td className="px-3 py-3 text-right">{money(g.playerBalance)}</td>
      <td className="px-4 py-3 min-w-[240px]">
        {mode === "view" ? (
          <div className="flex gap-2 justify-end">
            <button className="btn-ghost text-xs px-2 py-1" onClick={() => setMode("topup")}>
              + Top-up
            </button>
            <button
              className="btn-ghost text-xs px-2 py-1"
              onClick={() => {
                setBalance(g.backendBalance.toFixed(2));
                setLowAt(g.backendLowAt ? g.backendLowAt.toFixed(2) : "");
                setMode("set");
              }}
            >
              Set balance
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {mode === "topup" ? (
              <>
                <input className="input" type="number" step="0.01" min="0.01" placeholder="Credits added to the backend" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              </>
            ) : (
              <>
                <label className="text-[11px] text-muted block">
                  Balance the backend shows now
                  <input className="input mt-1" type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} />
                </label>
                {isAdmin && (
                  <label className="text-[11px] text-muted block">
                    Warn when at or below (0 = off)
                    <input className="input mt-1" type="number" step="0.01" min="0" value={lowAt} onChange={(e) => setLowAt(e.target.value)} />
                  </label>
                )}
              </>
            )}
            <div className="flex gap-2 justify-end">
              <button className="btn-primary text-xs px-3 py-1.5" disabled={busy} onClick={save}>
                Save
              </button>
              <button className="btn-ghost text-xs px-3 py-1.5" disabled={busy} onClick={() => setMode("view")}>
                Cancel
              </button>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}
      </td>
    </tr>
  );
}

export default function AgentGameBalancesPage() {
  const api = useApi();
  const { user } = useAuth();
  const [games, setGames] = useState<GameBalance[]>([]);

  const load = useCallback(async () => {
    const r = await api<{ games: GameBalance[] }>("/api/agent/desk/games-balance");
    setGames(r.games);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const isAdmin = user?.role === "ADMIN" || user?.role === "MASTER_ADMIN";
  const lowCount = games.filter((g) => g.low).length;

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Games Balance</h1>
      <p className="text-sm text-muted mb-6">
        Our credits on each game&apos;s backend. Recharges, bonuses and free play take from it; redeems give back. Record a top-up when you buy credits,
        or set the balance to what the backend shows.
      </p>

      {lowCount > 0 && (
        <div className="card mb-4 border-red-500/40 text-sm text-red-300">
          ⚠ {lowCount} game backend{lowCount > 1 ? "s are" : " is"} low on credits — top up before players run into failed loads.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card">
          <p className="text-xs text-muted">Total backend credits</p>
          <p className="text-2xl font-extrabold">{money(games.reduce((n, g) => n + g.backendBalance, 0))}</p>
        </div>
        <div className="card">
          <p className="text-xs text-muted">Held by players (recorded)</p>
          <p className="text-2xl font-extrabold text-primary">{money(games.reduce((n, g) => n + g.playerBalance, 0))}</p>
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Game</th>
              <th className="px-3 py-3 font-medium text-right">Backend balance</th>
              <th className="px-3 py-3 font-medium text-right">Accounts</th>
              <th className="px-3 py-3 font-medium text-right">Player balances</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {games.map((g) => (
              <GameRow key={g.id} g={g} isAdmin={isAdmin} onChanged={load} />
            ))}
          </tbody>
        </table>
        {games.length === 0 && <p className="text-muted text-sm text-center py-10">No games yet.</p>}
      </div>
    </AgentShell>
  );
}
