"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { useDeskMeta } from "@/components/desk/useDeskMeta";

interface Player {
  id: string;
  username: string;
  fullName: string;
  email: string;
}

function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export default function AgentCreateAccountPage() {
  const api = useApi();
  const { games } = useDeskMeta();
  const [gameId, setGameId] = useState("");
  const [gameUsername, setGameUsername] = useState("");
  const [gamePassword, setGamePassword] = useState("");
  const [mode, setMode] = useState<"name" | "website">("name");
  const [playerName, setPlayerName] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Player[]>([]);
  const [linked, setLinked] = useState<Player | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ game: string; username: string; password: string; player: string } | null>(null);

  useEffect(() => {
    if (!gameId && games.length) setGameId(games.find((g) => g.isActive)?.id ?? games[0].id);
  }, [games, gameId]);

  useEffect(() => {
    if (mode !== "website" || linked || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ players: Player[] }>(`/api/agent/desk/players?q=${encodeURIComponent(query.trim())}`)
        .then((r) => setMatches(r.players))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [api, query, mode, linked]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "website" && !linked) return setError("Pick the website player to link, or switch to Player name.");
    setBusy(true);
    try {
      await api("/api/agent/desk/accounts", {
        method: "POST",
        body: JSON.stringify({
          gameId,
          gameUsername: gameUsername.trim(),
          gamePassword: gamePassword.trim(),
          ...(mode === "website" && linked ? { linkUserId: linked.id } : { playerName: playerName.trim() }),
        }),
      });
      setCreated({
        game: games.find((g) => g.id === gameId)?.name ?? "",
        username: gameUsername.trim(),
        password: gamePassword.trim(),
        player: mode === "website" && linked ? `@${linked.username}` : playerName.trim(),
      });
      setGameUsername("");
      setGamePassword("");
      setPlayerName("");
      setLinked(null);
      setQuery("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Create Account</h1>
      <p className="text-sm text-muted mb-6">
        Create the account on the game&apos;s back office first, then save its login here so it can be recharged and redeemed. Website players who ask
        for a game from the site show up under <Link href="/agent/requests" className="text-primary underline">Requests</Link> instead.
      </p>

      {created && (
        <div className="card mb-4 border-green-500/40">
          <p className="font-medium text-green-400 mb-2">Account saved. Share this login with {created.player}:</p>
          <p className="text-sm">
            Game: <strong>{created.game}</strong>
          </p>
          <p className="text-sm">
            Username: <span className="font-mono">{created.username}</span>
          </p>
          <p className="text-sm">
            Password: <span className="font-mono">{created.password}</span>
          </p>
          <Link href="/agent/transactions/recharge" className="btn-primary text-sm inline-block mt-3">
            Recharge this account →
          </Link>
        </div>
      )}

      <form onSubmit={submit} className="card space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-muted">
            Game
            <select className="input mt-1" value={gameId} onChange={(e) => setGameId(e.target.value)} required>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.isActive ? "" : " (hidden from site)"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Game username
            <input className="input mt-1" placeholder="Username you created on the game" value={gameUsername} onChange={(e) => setGameUsername(e.target.value)} required maxLength={100} />
          </label>
          <label className="text-xs text-muted">
            Game password
            <div className="flex gap-2 mt-1">
              <input className="input" placeholder="Password you set" value={gamePassword} onChange={(e) => setGamePassword(e.target.value)} required maxLength={100} />
              <button type="button" className="btn-ghost text-xs px-3 shrink-0" onClick={() => setGamePassword(randomPassword())}>
                Generate
              </button>
            </div>
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-muted">Player</p>
          <div className="flex gap-2">
            <button type="button" className={`px-3 py-1.5 rounded-lg text-sm ${mode === "name" ? "bg-primary text-white" : "bg-surface2 text-muted"}`} onClick={() => setMode("name")}>
              Not on the website
            </button>
            <button type="button" className={`px-3 py-1.5 rounded-lg text-sm ${mode === "website" ? "bg-primary text-white" : "bg-surface2 text-muted"}`} onClick={() => setMode("website")}>
              Website player
            </button>
          </div>
          {mode === "name" ? (
            <input className="input" placeholder="Player name (e.g. their Facebook name)" value={playerName} onChange={(e) => setPlayerName(e.target.value)} required maxLength={80} />
          ) : linked ? (
            <div className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2 text-sm">
              <span>
                {linked.fullName} <span className="text-muted">@{linked.username} · {linked.email}</span>
              </span>
              <button type="button" className="text-xs text-primary" onClick={() => setLinked(null)}>
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <input className="input" placeholder="Search website username or email…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {matches.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 card p-0 divide-y divide-border max-h-64 overflow-y-auto">
                  {matches.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface2"
                      onClick={() => {
                        setLinked(p);
                        setMatches([]);
                      }}
                    >
                      {p.fullName} <span className="text-muted">@{p.username} · {p.email}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !gameId}>
          {busy ? "Saving…" : "Create Account"}
        </button>
      </form>
    </AgentShell>
  );
}
