"use client";

import { useCallback, useEffect, useState, FormEvent } from "react";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { GameTx, SOURCE_LABELS, TX_LABELS, TxSource, TxType, TypeTotals, dayRangeParams, money, playerLabel } from "@/lib/desk";
import { DeskFilters, FilterState, Pager, PageSizeSelect, emptyFilters } from "./DeskFilters";
import { useDeskMeta } from "./useDeskMeta";

type FormType = "RECHARGE" | "REDEEM" | "FREEPLAY";

interface Account {
  id: string;
  gameUsername: string;
  playerName: string | null;
  user: { username: string; fullName: string } | null;
  balance: string;
  balanceSyncedAt: string | null;
  game: { name: string };
}

const TYPE_TONE: Record<TxType, string> = {
  RECHARGE: "bg-blue-500/15 text-blue-300",
  BONUS: "bg-purple-500/15 text-purple-300",
  REDEEM: "bg-red-500/15 text-red-300",
  FREEPLAY: "bg-green-500/15 text-green-300",
};

function StatCard({ type, t }: { type: TxType; t: TypeTotals | undefined }) {
  return (
    <div className="card">
      <p className="text-xs text-muted">Total {TX_LABELS[type]}</p>
      <p className="text-2xl font-extrabold">{money(t?.amount)}</p>
      <p className="text-xs text-muted">{t?.count ?? 0} transactions</p>
      <p className="text-[11px] text-muted mt-1">
        {(["PAGE", "PERSONAL", "WEB"] as TxSource[]).map((s, i) => (
          <span key={s}>
            {i > 0 && " | "}
            {SOURCE_LABELS[s]}: {money(t?.bySource[s]?.amount)} ({t?.bySource[s]?.count ?? 0})
          </span>
        ))}
      </p>
    </div>
  );
}

function CreateForm({ type, onCreated }: { type: FormType; onCreated: () => Promise<void> }) {
  const api = useApi();
  const { games } = useDeskMeta();
  const [gameId, setGameId] = useState("");
  const [amount, setAmount] = useState("");
  const [bonus, setBonus] = useState("");
  const [source, setSource] = useState<"PAGE" | "PERSONAL">("PAGE");
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [newBalance, setNewBalance] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!gameId && games.length) setGameId(games.find((g) => g.isActive)?.id ?? games[0].id);
  }, [games, gameId]);

  // A different game or login means the checked balance no longer applies.
  useEffect(() => setAccount(null), [gameId, username]);

  const verb = type === "RECHARGE" ? "Recharge" : type === "REDEEM" ? "Redeem" : "Free Play";

  async function checkBalance() {
    setMsg(null);
    if (!username.trim()) return setMsg({ ok: false, text: "Enter the player's game username." });
    setBusy(true);
    try {
      const r = await api<{ account: Account }>(`/api/agent/desk/accounts/lookup?gameId=${encodeURIComponent(gameId)}&username=${encodeURIComponent(username.trim())}`);
      setAccount(r.account);
      setNewBalance(Number(r.account.balance).toFixed(2));
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Could not check the balance." });
    } finally {
      setBusy(false);
    }
  }

  async function saveBalance() {
    if (!account) return;
    setBusy(true);
    try {
      await api(`/api/agent/game-accounts/${account.id}/balance`, { method: "POST", body: JSON.stringify({ balance: Number(newBalance) }) });
      await checkBalance();
      setMsg({ ok: true, text: "Balance updated to what the game shows." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Could not update the balance." });
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const amt = Number(amount);
    if (!amount || !Number.isFinite(amt) || amt <= 0) return setMsg({ ok: false, text: "Enter an amount." });
    setBusy(true);
    try {
      const r = await api<{ balanceAfter: string }>("/api/agent/desk/transactions", {
        method: "POST",
        body: JSON.stringify({
          type,
          gameId,
          gameUsername: username.trim(),
          amount: amt,
          ...(type === "RECHARGE" && bonus ? { bonus: Number(bonus) } : {}),
          source,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      setMsg({ ok: true, text: `${verb} of ${money(amt)}${type === "RECHARGE" && Number(bonus) > 0 ? ` + ${money(bonus)} bonus` : ""} saved for ${username.trim()}. New balance ${money(r.balanceAfter)}.` });
      setAmount("");
      setBonus("");
      setNote("");
      setAccount(null);
      await onCreated();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : `Could not save the ${verb.toLowerCase()}.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 mb-6">
      <p className="text-xs text-muted">
        Do the {verb.toLowerCase()} on the game&apos;s back office first, then record it here. Page / Personal means the player paid you outside the
        website, so their website wallet is not touched.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-muted">
          Game
          <select className="input mt-1" value={gameId} onChange={(e) => setGameId(e.target.value)} required>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Amount
          <input className="input mt-1" type="number" step="0.01" min="1" placeholder="Enter amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="text-xs text-muted">
          {type === "REDEEM" ? "Source" : `${verb} Source`}
          <select className="input mt-1" value={source} onChange={(e) => setSource(e.target.value as "PAGE" | "PERSONAL")}>
            <option value="PAGE">{verb} from page</option>
            <option value="PERSONAL">{verb} from personal</option>
          </select>
        </label>
        {type === "RECHARGE" ? (
          <label className="text-xs text-muted">
            Bonus Amount
            <input className="input mt-1" type="number" step="0.01" min="0" placeholder="Enter bonus amount" value={bonus} onChange={(e) => setBonus(e.target.value)} />
          </label>
        ) : (
          <label className="text-xs text-muted">
            Note (optional)
            <input className="input mt-1" placeholder="e.g. paid via Cash App" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </label>
        )}
        <label className="text-xs text-muted">
          Username
          <input className="input mt-1" placeholder="Enter username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        {type === "RECHARGE" && (
          <label className="text-xs text-muted">
            Note (optional)
            <input className="input mt-1" placeholder="e.g. paid via Cash App" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </label>
        )}
      </div>

      {account && (
        <div className="rounded-lg bg-surface2 px-3 py-3 text-sm space-y-2">
          <p>
            <span className="text-muted">Player:</span> {account.user ? `${account.user.fullName} (@${account.user.username})` : account.playerName || "—"} ·{" "}
            <span className="text-muted">Recorded balance:</span> <strong>{money(account.balance)}</strong>{" "}
            <span className="text-xs text-muted">{account.balanceSyncedAt ? `(updated ${new Date(account.balanceSyncedAt).toLocaleString()})` : "(never updated)"}</span>
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted">
              Balance the game shows now
              <input className="input mt-1 w-40" type="number" step="0.01" min="0" value={newBalance} onChange={(e) => setNewBalance(e.target.value)} />
            </label>
            <button type="button" className="btn-ghost text-xs px-3 py-2" disabled={busy} onClick={saveBalance}>
              Update balance
            </button>
          </div>
        </div>
      )}

      {msg && <p className={`text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.text}</p>}

      <button type="button" className="btn-primary w-full" disabled={busy || !gameId} onClick={checkBalance}>
        Check User Balance
      </button>
      <button type="submit" className="btn-primary w-full" disabled={busy || !gameId}>
        {busy ? "Saving…" : `Create ${verb}`}
      </button>
    </form>
  );
}

export default function TransactionsView({ type, form }: { type?: TxType; form?: FormType }) {
  const api = useApi();
  const { games, staff } = useDeskMeta();
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<GameTx[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Record<TxType, TypeTotals> | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (type) params.set("type", type);
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.gameId) params.set("gameId", filters.gameId);
    if (filters.staffId) params.set("staffId", filters.staffId);
    if (filters.source) params.set("source", filters.source);
    dayRangeParams(filters.from, filters.to, params);
    const r = await api<{ rows: GameTx[]; total: number; stats: Record<TxType, TypeTotals> }>(`/api/agent/desk/transactions?${params}`);
    setRows(r.rows);
    setTotal(r.total);
    setStats(r.stats);
  }, [api, type, filters, page, pageSize]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  // Filters change the result set: start from the first page again.
  function changeFilters(f: FilterState) {
    setFilters(f);
    setPage(1);
  }

  const statTypes: TxType[] = type ? [type] : ["RECHARGE", "BONUS", "FREEPLAY", "REDEEM"];

  return (
    <>
      {form && <CreateForm type={form} onCreated={load} />}

      <div className="card mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-bold">{type ? `${TX_LABELS[type]} Transactions` : "All Transactions"}</h2>
          <PageSizeSelect
            value={pageSize}
            onChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </div>
        <DeskFilters value={filters} onChange={changeFilters} games={games} staff={staff} showSource count={total} countLabel="transactions found" />
      </div>

      <h3 className="font-bold mb-2">Transaction Statistics</h3>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${statTypes.length > 1 ? "xl:grid-cols-4" : ""} gap-3 mb-4`}>
        {statTypes.map((t) => (
          <StatCard key={t} type={t} t={stats?.[t]} />
        ))}
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Game</th>
              <th className="px-3 py-3 font-medium">Username</th>
              <th className="px-3 py-3 font-medium">Player</th>
              {!type && <th className="px-3 py-3 font-medium">Type</th>}
              <th className="px-3 py-3 font-medium">Source</th>
              <th className="px-3 py-3 font-medium text-right">Amount</th>
              <th className="px-3 py-3 font-medium text-right">Balance after</th>
              <th className="px-3 py-3 font-medium">Staff</th>
              <th className="px-4 py-3 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 whitespace-nowrap text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.game.name}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{r.gameUsername}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{playerLabel(r.userGame)}</td>
                {!type && (
                  <td className="px-3 py-2.5">
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${TYPE_TONE[r.type]}`}>{TX_LABELS[r.type]}</span>
                  </td>
                )}
                <td className="px-3 py-2.5">{SOURCE_LABELS[r.source]}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap font-semibold">
                  {r.type === "REDEEM" ? "−" : "+"}
                  {money(r.amount)}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap text-muted">{money(r.balanceAfter)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{r.staff ? `@${r.staff.username}` : "—"}</td>
                <td className="px-4 py-2.5 text-xs text-muted max-w-[220px] truncate" title={r.note ?? ""}>
                  {r.note ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-muted text-sm text-center py-10">No transactions found.</p>}
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>
    </>
  );
}
