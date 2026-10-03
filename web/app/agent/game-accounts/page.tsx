"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { DeskFilters, FilterState, Pager, PageSizeSelect, emptyFilters } from "@/components/desk/DeskFilters";
import { useDeskMeta } from "@/components/desk/useDeskMeta";
import { dayRangeParams, money } from "@/lib/desk";

interface Account {
  id: string;
  gameUsername: string | null;
  gamePassword: string | null;
  playerName: string | null;
  balance: string;
  balanceSyncedAt: string | null;
  createdAt: string;
  game: { id: string; name: string };
  user: { id: string; username: string; fullName: string } | null;
  createdBy: { username: string } | null;
  balanceSyncedBy: { username: string } | null;
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function Row({ a, onChanged }: { a: Account; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [mode, setMode] = useState<"view" | "balance" | "login">("view");
  const [balance, setBalance] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (mode === "balance") {
        await api(`/api/agent/game-accounts/${a.id}/balance`, { method: "POST", body: JSON.stringify({ balance: Number(balance) }) });
      } else {
        await api(`/api/agent/game-accounts/${a.id}/credentials`, { method: "PUT", body: JSON.stringify({ gameUsername: username, gamePassword: password }) });
      }
      setMode("view");
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function warn() {
    if (!a.user) return;
    const message = window.prompt(`Warning message for @${a.user.username} (shown in their notifications):`);
    if (!message?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/agent/players/${a.user.id}/warn`, { method: "POST", body: JSON.stringify({ message }) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send warning.");
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    if (!a.user) return;
    const reason = window.prompt(`Reason for blocking @${a.user.username} (shown to them):`);
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/agent/players/${a.user.id}/block`, { method: "POST", body: JSON.stringify({ reason: reason || undefined }) });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not block.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3 whitespace-nowrap">{a.game.name}</td>
      <td className="px-3 py-3 font-mono text-xs">{a.gameUsername}</td>
      <td className="px-3 py-3 font-mono text-xs whitespace-nowrap">
        {showPw ? a.gamePassword : "••••••"}{" "}
        <button className="text-primary font-sans" onClick={() => setShowPw((s) => !s)}>
          {showPw ? "hide" : "show"}
        </button>
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {a.user ? (
          <>
            {a.user.fullName} <span className="text-muted">@{a.user.username}</span>
          </>
        ) : (
          <>
            {a.playerName || "—"} <span className="text-[10px] text-muted">not on site</span>
          </>
        )}
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <p className="font-semibold text-primary">{money(a.balance)}</p>
        <p className="text-[10px] text-muted">
          {ago(a.balanceSyncedAt)}
          {a.balanceSyncedBy && ` · @${a.balanceSyncedBy.username}`}
        </p>
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-xs text-muted">
        {new Date(a.createdAt).toLocaleDateString()}
        {a.createdBy && <p>@{a.createdBy.username}</p>}
      </td>
      <td className="px-4 py-3 min-w-[220px]">
        {mode === "view" ? (
          <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2 justify-end flex-wrap">
            <button
              className="btn-ghost text-xs px-2 py-1"
              onClick={() => {
                setBalance(Number(a.balance).toFixed(2));
                setMode("balance");
              }}
            >
              Update balance
            </button>
            <button
              className="btn-ghost text-xs px-2 py-1"
              onClick={() => {
                setUsername(a.gameUsername ?? "");
                setPassword(a.gamePassword ?? "");
                setMode("login");
              }}
            >
              Edit login
            </button>
            {a.user && (
              <>
                <button className="btn-ghost text-xs px-2 py-1 text-yellow-400" disabled={busy} onClick={warn} title="Warn player">
                  ⚠️ Warn
                </button>
                <button className="btn-ghost text-xs px-2 py-1 text-red-400" disabled={busy} onClick={block} title="Block player">
                  Block
                </button>
              </>
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            {mode === "balance" ? (
              <input className="input" type="number" step="0.01" min="0" value={balance} onChange={(e) => setBalance(e.target.value)} aria-label="Balance the game shows" />
            ) : (
              <>
                <input className="input" placeholder="Game username" value={username} onChange={(e) => setUsername(e.target.value)} />
                <input className="input" placeholder="Game password" value={password} onChange={(e) => setPassword(e.target.value)} />
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

export default function AgentGameAccountsPage() {
  const api = useApi();
  const { games, staff } = useDeskMeta();
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.gameId) params.set("gameId", filters.gameId);
    if (filters.staffId) params.set("staffId", filters.staffId);
    dayRangeParams(filters.from, filters.to, params);
    const r = await api<{ rows: Account[]; total: number }>(`/api/agent/desk/accounts?${params}`);
    setRows(r.rows);
    setTotal(r.total);
  }, [api, filters, page, pageSize]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Game Accounts</h1>
      <p className="text-sm text-muted mb-6">View and manage all game accounts. Update a balance whenever you check it on the game&apos;s back office.</p>

      <div className="card mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-bold">All Game Accounts</h2>
          <div className="flex items-center gap-3">
            <Link href="/agent/create-account" className="btn-primary text-xs px-3 py-1.5">
              + Create Account
            </Link>
            <PageSizeSelect
              value={pageSize}
              onChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
            />
          </div>
        </div>
        <DeskFilters
          value={filters}
          onChange={(f) => {
            setFilters(f);
            setPage(1);
          }}
          games={games}
          staff={staff}
          searchPlaceholder="Game username, player…"
          count={total}
          countLabel="game accounts found"
        />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Game</th>
              <th className="px-3 py-3 font-medium">Username</th>
              <th className="px-3 py-3 font-medium">Password</th>
              <th className="px-3 py-3 font-medium">Player</th>
              <th className="px-3 py-3 font-medium text-right">Balance</th>
              <th className="px-3 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((a) => (
              <Row key={a.id} a={a} onChanged={load} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-muted text-sm text-center py-10">No game accounts found.</p>}
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>
    </AgentShell>
  );
}
