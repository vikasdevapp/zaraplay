"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import AppShell from "@/components/AppShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Game {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  // Set by admins when adding/editing a game; opened by "Play Now".
  playUrl: string | null;
}

// Only plain web links are opened, never javascript: or other schemes.
function safePlayUrl(url: string | null) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function GameThumb({ game, className }: { game: Game; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-surface2 border border-border ${className ?? ""}`}>
      {game.imageUrl ? (
        <Image src={game.imageUrl} alt={game.name} fill unoptimized className="object-cover" sizes="200px" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/30 to-surface2 text-xl font-bold">
          {game.name.slice(0, 1)}
        </div>
      )}
    </div>
  );
}

interface UserGame {
  id: string;
  gameUsername: string;
  gamePassword: string;
  balance: string;
  game: Game;
}

export default function GamesPage() {
  const api = useApi();
  const [tab, setTab] = useState<"mine" | "available">("mine");
  const [catalog, setCatalog] = useState<Game[]>([]);
  const [mine, setMine] = useState<UserGame[]>([]);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [playNote, setPlayNote] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [catalogRes, mineRes] = await Promise.all([
      api<{ games: Game[] }>("/api/games/catalog"),
      api<{ userGames: UserGame[] }>("/api/games/mine"),
    ]);
    setCatalog(catalogRes.games);
    setMine(mineRes.userGames);
  }, [api]);

  useEffect(() => {
    loadAll().catch(() => {});
  }, [loadAll]);

  async function addGame(gameId: string) {
    setError(null);
    setBusyGameId(gameId);
    try {
      await api("/api/games/mine", { method: "POST", body: JSON.stringify({ gameId }) });
      await loadAll();
      setTab("mine");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add game.");
    } finally {
      setBusyGameId(null);
    }
  }

  async function resetPassword(userGameId: string) {
    await api(`/api/games/mine/${userGameId}/reset-password`, { method: "POST" });
    await loadAll();
  }

  const myGameIds = new Set(mine.map((m) => m.game.id));
  const available = catalog.filter((g) => !myGameIds.has(g.id));

  return (
    <AppShell>
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setTab("mine")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "mine" ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
        >
          My Games
        </button>
        <button
          onClick={() => setTab("available")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "available" ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
        >
          Available Games
        </button>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {tab === "mine" && (
        <div className="space-y-4">
          {mine.length === 0 && (
            <div className="card text-center text-muted py-10">
              You haven&apos;t added any games yet. Switch to <strong>Available Games</strong> to get started.
            </div>
          )}
          {mine.map((ug) => (
            <div key={ug.id} className="card">
              <div className="flex items-center gap-3 mb-3">
                <GameThumb game={ug.game} className="w-12 h-12 rounded-lg shrink-0" />
                <div className="flex-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400" />
                    <p className="font-bold">{ug.game.name}</p>
                  </div>
                  <p className="text-primary font-semibold">${Number(ug.balance).toFixed(2)}</p>
                </div>
              </div>
              <div className="text-sm space-y-2">
                <div className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
                  <span className="text-muted">Game ID</span>
                  <span className="font-mono">{ug.gameUsername}</span>
                </div>
                <div className="flex items-center justify-between bg-surface2 rounded-lg px-3 py-2">
                  <span className="text-muted">Password</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{revealed[ug.id] ? ug.gamePassword : "••••••••"}</span>
                    <button
                      className="text-xs text-primary-light"
                      onClick={() => setRevealed((r) => ({ ...r, [ug.id]: !r[ug.id] }))}
                    >
                      {revealed[ug.id] ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button onClick={() => resetPassword(ug.id)} className="btn-ghost text-sm py-2">
                  🔄 Reset Password
                </button>
                {safePlayUrl(ug.game.playUrl) ? (
                  <a
                    href={safePlayUrl(ug.game.playUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-sm py-2 text-center"
                  >
                    🎮 Play Now
                  </a>
                ) : (
                  <button
                    onClick={() => setPlayNote("Reach out to Support for the play link for this game.")}
                    className="btn-primary text-sm py-2"
                  >
                    🎮 Play Now
                  </button>
                )}
              </div>
            </div>
          ))}
          {playNote && <p className="text-sm text-center text-muted">{playNote}</p>}
        </div>
      )}

      {tab === "available" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {available.map((g) => (
            <div key={g.id} className="card flex flex-col items-center text-center gap-2">
              <GameThumb game={g} className="w-full aspect-square rounded-xl" />
              <p className="text-sm font-medium">{g.name}</p>
              <button
                onClick={() => addGame(g.id)}
                disabled={busyGameId === g.id}
                className="btn-gold text-xs py-2 px-3 w-full"
              >
                {busyGameId === g.id ? "Adding…" : "+ Add Game"}
              </button>
            </div>
          ))}
          {available.length === 0 && <p className="text-muted col-span-full text-center py-10">You&apos;ve added every available game.</p>}
        </div>
      )}
    </AppShell>
  );
}
