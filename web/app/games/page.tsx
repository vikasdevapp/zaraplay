"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import Image from "next/image";
import AppShell from "@/components/AppShell";
import CheckoutModal from "@/components/CheckoutModal";
import { useApi, useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import { getDeviceId } from "@/lib/device";

interface Game {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  // Set by admins when adding/editing a game; opened by "Play Now".
  playUrl: string | null;
  // When set, adding this game creates the login instantly (no agent wait).
  automationProvider: string | null;
}

type RequestType = "CREATE_ACCOUNT" | "RECHARGE" | "REDEEM" | "PASSWORD_RESET" | "BALANCE_CHECK";

interface PendingRequest {
  id: string;
  type: RequestType;
  amount: string;
  createdAt: string;
  inProgress: boolean;
}

interface UserGame {
  id: string;
  status: "PENDING" | "ACTIVE";
  gameUsername: string | null;
  gamePassword: string | null;
  balance: string;
  balanceSyncedAt: string | null;
  game: Game;
  pendingRequests: PendingRequest[];
}

interface HistoryItem {
  id: string;
  type: RequestType;
  status: "PENDING" | "COMPLETED" | "REJECTED" | "CANCELLED";
  amount: string;
  completedAmount: string | null;
  agentNote: string | null;
  gameName: string;
  createdAt: string;
  completedAt: string | null;
  inProgress: boolean;
}

interface PaymentOptions {
  deposit: { gateway: boolean; methods: string[]; amounts?: Record<string, number[] | null> };
  minDeposit?: number;
  maxDeposit?: number;
}

type MoneyAction = { kind: "add"; game: Game } | { kind: "load"; ug: UserGame } | { kind: "redeem"; ug: UserGame };

const REQUEST_LABELS: Record<RequestType, string> = {
  CREATE_ACCOUNT: "Account setup",
  RECHARGE: "Load",
  REDEEM: "Redeem",
  PASSWORD_RESET: "Password reset",
  BALANCE_CHECK: "Balance check",
};

const money = (v: string | number) => `$${Number(v).toFixed(2)}`;

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

function timeAgo(iso: string | null) {
  if (!iso) return "not yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
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

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the value is still visible to copy by hand
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 bg-surface2 rounded-lg px-3 py-2">
      <span className="text-muted shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-mono truncate">{shown ? value : "••••••••"}</span>
        {secret && (
          <button className="text-xs text-primary-light shrink-0" onClick={() => setShown((s) => !s)}>
            {shown ? "Hide" : "Show"}
          </button>
        )}
        <button className="text-xs text-primary-light shrink-0" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export default function GamesPage() {
  const api = useApi();
  const { user } = useAuth();
  const [tab, setTab] = useState<"mine" | "available" | "history">("mine");
  const [catalog, setCatalog] = useState<Game[]>([]);
  const [mine, setMine] = useState<UserGame[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // Shown after an automated game creates the login instantly.
  const [added, setAdded] = useState<{ name: string; username: string; password: string; loadPending: boolean } | null>(null);

  const [action, setAction] = useState<MoneyAction | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Deposit-and-load: which game account the deposit is for, and the checkout sheet state.
  const [depositFor, setDepositFor] = useState<{ userGameId: string; amount: number } | null>(null);
  const [payMethods, setPayMethods] = useState<string[]>([]);
  const [payOptions, setPayOptions] = useState<PaymentOptions | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const [catalogRes, mineRes, historyRes] = await Promise.all([
      api<{ games: Game[] }>("/api/games/catalog"),
      api<{ userGames: UserGame[]; walletBalance: string }>("/api/games/mine"),
      api<{ requests: HistoryItem[] }>("/api/games/requests"),
    ]);
    setCatalog(catalogRes.games);
    setMine(mineRes.userGames);
    setWalletBalance(Number(mineRes.walletBalance));
    setHistory(historyRes.requests);
  }, [api]);

  useEffect(() => {
    loadAll().catch(() => {});
    // Agents work requests in the background; keep cards current while the page is open.
    const t = setInterval(() => loadAll().catch(() => {}), 30000);
    return () => clearInterval(t);
  }, [loadAll]);

  function openAction(a: MoneyAction) {
    setAction(a);
    setActionError(null);
    setAmount(a.kind === "redeem" && Number(a.ug.balance) > 0 ? Number(a.ug.balance).toFixed(2) : "");
  }

  function closeAction() {
    if (!busy) setAction(null);
  }

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount >= 1;
  const needsDeposit = action && action.kind !== "redeem" && amountValid && parsedAmount > walletBalance;

  async function submitAction(e: FormEvent) {
    e.preventDefault();
    if (!action) return;
    setActionError(null);

    if (action.kind === "add" && amount.trim() === "") {
      return doAdd(action.game, undefined); // add without a first load
    }
    if (!amountValid) {
      setActionError("Enter an amount of at least $1.00.");
      return;
    }

    if (action.kind === "redeem") {
      return run(async () => {
        const res = await api<{ auto?: boolean; status?: string; payout?: number; forfeit?: number }>(
          `/api/games/mine/${action.ug.id}/redeem`,
          { method: "POST", body: JSON.stringify({ amount: parsedAmount }) }
        );
        if (res.auto && res.status === "done") {
          const forfeit = res.forfeit && res.forfeit > 0 ? ` $${res.forfeit.toFixed(2)} above the cashout cap was forfeited.` : "";
          return `${money(res.payout ?? 0)} was added to your wallet instantly.${forfeit}`;
        }
        return `Withdrawal of ${money(parsedAmount)} requested. An agent will move it to your wallet shortly.`;
      });
    }

    if (needsDeposit) return startDeposit();

    if (action.kind === "add") {
      return doAdd(action.game, parsedAmount);
    }
    return run(async () => {
      const res = await api<{ loaded?: boolean }>(`/api/games/mine/${action.ug.id}/recharge`, { method: "POST", body: JSON.stringify({ amount: parsedAmount }) });
      return res.loaded
        ? `${money(parsedAmount)} loaded into ${action.ug.game.name} instantly.`
        : `${money(parsedAmount)} is on its way to ${action.ug.game.name}.`;
    });
  }

  // Add a game. Automated games create the login instantly; manual ones queue for an agent.
  async function doAdd(game: Game, amount?: number) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api<{ created?: boolean; gameUsername?: string; gamePassword?: string; loadPending?: boolean }>("/api/games/mine", {
        method: "POST",
        body: JSON.stringify({ gameId: game.id, ...(amount ? { amount } : {}) }),
      });
      setAction(null);
      setTab("mine");
      if (res.created && res.gameUsername && res.gamePassword) {
        setAdded({ name: game.name, username: res.gameUsername, password: res.gamePassword, loadPending: !!res.loadPending });
      } else {
        setNotice({
          type: "success",
          text: amount
            ? `${game.name} requested with ${money(amount)}. It will be loaded as soon as your account is ready.`
            : `${game.name} requested. Our team will set up your account shortly.`,
        });
      }
      await loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not add this game.");
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    try {
      const text = await fn();
      setAction(null);
      setNotice({ type: "success", text });
      setTab("mine");
      await loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Wallet is short: deposit the amount for this game; when the deposit completes it is
  // loaded into the game automatically (deposit bonus included).
  async function startDeposit() {
    if (!action || action.kind === "redeem") return;
    setBusy(true);
    try {
      let userGameId: string;
      if (action.kind === "add") {
        const res = await api<{ userGameId: string }>("/api/games/mine", { method: "POST", body: JSON.stringify({ gameId: action.game.id }) });
        userGameId = res.userGameId;
      } else {
        userGameId = action.ug.id;
      }
      const options = await api<PaymentOptions>("/api/wallet/payment-options");
      if (options.deposit.gateway) {
        setPayMethods(options.deposit.methods);
        setPayOptions(options);
        setCheckoutError(null);
        setDepositFor({ userGameId, amount: parsedAmount });
        setAction(null);
      } else {
        await api("/api/wallet/deposit", { method: "POST", body: JSON.stringify({ amount: parsedAmount, userGameId }) });
        setAction(null);
        setNotice({ type: "success", text: `Deposit of ${money(parsedAmount)} requested. Once it's approved it will be loaded into your game automatically.` });
      }
      await loadAll();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not start the deposit. Please try again.");
      await loadAll().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function payWithGateway(method: string, amount: number) {
    if (!depositFor) return;
    setCheckoutError(null);
    setBusy(true);
    try {
      const res = await api<{ cashierUrl?: string }>("/api/wallet/deposit", {
        method: "POST",
        body: JSON.stringify({ amount, wayCode: method, deviceId: getDeviceId(), userGameId: depositFor.userGameId }),
      });
      if (res.cashierUrl) {
        window.location.href = res.cashierUrl;
        return; // keep the sheet busy while the browser navigates away
      }
      setCheckoutError("Could not open the payment page. Please try again.");
    } catch (err) {
      setCheckoutError(err instanceof ApiError ? err.message : "Could not start the payment. Please try again.");
      try {
        setPayMethods((await api<PaymentOptions>("/api/wallet/payment-options")).deposit.methods);
      } catch {
        // keep the current list
      }
    }
    setBusy(false);
  }

  // Balances change while the player plays on the game's own app; older than this, nudge a refresh.
  const STALE_AFTER_MS = 60 * 60 * 1000;

  async function refreshBalance(ug: UserGame) {
    setNotice(null);
    try {
      const r = await api<{ alreadyOpen: boolean; done?: boolean }>(`/api/games/mine/${ug.id}/balance-check`, { method: "POST" });
      setNotice({
        type: "success",
        text: r.done
          ? `${ug.game.name} balance updated.`
          : r.alreadyOpen
            ? `We're already checking your ${ug.game.name} balance. It will update here shortly.`
            : `Balance check requested. An agent will read your ${ug.game.name} balance and it will update here.`,
      });
      await loadAll();
    } catch (err) {
      setNotice({ type: "error", text: err instanceof ApiError ? err.message : "Could not request a balance check." });
    }
  }

  async function simpleRequest(path: string, successText: string | ((res: { done?: boolean }) => string)) {
    setNotice(null);
    try {
      const res = await api<{ done?: boolean }>(path, { method: "POST" });
      setNotice({ type: "success", text: typeof successText === "function" ? successText(res) : successText });
      await loadAll();
    } catch (err) {
      setNotice({ type: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Please try again." });
    }
  }

  const myGameIds = new Set(mine.map((m) => m.game.id));
  const available = catalog.filter((g) => !myGameIds.has(g.id));

  return (
    <AppShell>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex gap-2">
          {(
            [
              ["mine", "My Games"],
              ["available", "Available Games"],
              ["history", "History"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === key ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          Wallet: <span className="text-white font-semibold">{money(walletBalance)}</span>
        </p>
      </div>

      {notice && (
        <p className={`text-sm mb-4 ${notice.type === "error" ? "text-red-400" : "text-green-400"}`} role="status">
          {notice.text}
        </p>
      )}

      {tab === "mine" && (
        <div className="space-y-4">
          {mine.length === 0 && (
            <div className="card text-center text-muted py-10">
              You haven&apos;t added any games yet. Switch to <strong>Available Games</strong> to get started.
            </div>
          )}
          {mine.map((ug) => {
            const playUrl = safePlayUrl(ug.game.playUrl);
            const active = ug.status === "ACTIVE";
            const checking = ug.pendingRequests.some((r) => r.type === "BALANCE_CHECK");
            const stale =
              active && !checking && (!ug.balanceSyncedAt || Date.now() - new Date(ug.balanceSyncedAt).getTime() > STALE_AFTER_MS);
            return (
              <div key={ug.id} className="card">
                <div className="flex items-center gap-3 mb-3">
                  <GameThumb game={ug.game} className="w-12 h-12 rounded-lg shrink-0" />
                  <div className="flex-1 flex items-center justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${active ? "bg-green-400" : "bg-yellow-400"}`} />
                        <p className="font-bold truncate">{ug.game.name}</p>
                      </div>
                      <p className="text-xs text-muted">{active ? `Balance updated ${timeAgo(ug.balanceSyncedAt)}` : "Our team is creating your account"}</p>
                    </div>
                    {active && (
                      <div className="text-right shrink-0">
                        <p className="text-primary font-semibold">{money(ug.balance)}</p>
                        {checking ? (
                          <p className="text-[11px] text-muted">checking…</p>
                        ) : (
                          <button className="text-[11px] text-primary-light hover:underline" onClick={() => refreshBalance(ug)}>
                            🔄 Refresh balance
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {stale && (
                  <p className="text-xs text-yellow-400/90 bg-yellow-500/10 rounded-lg px-3 py-2 mb-3">
                    Your balance changes while you play in the game app. The amount above may be old — tap Refresh balance to get the latest.
                  </p>
                )}

                {active && ug.gameUsername && (
                  <div className="text-sm space-y-2">
                    <CopyField label="Game ID" value={ug.gameUsername} />
                    {ug.gamePassword && <CopyField label="Password" value={ug.gamePassword} secret />}
                  </div>
                )}

                {ug.pendingRequests.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {ug.pendingRequests.map((r) => (
                      <div key={r.id} className="flex items-center justify-between gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                        <span>
                          ⏳ {REQUEST_LABELS[r.type]}
                          {Number(r.amount) > 0 && ` · ${money(r.amount)}`}
                          <span className="text-muted"> · {r.inProgress ? "an agent is on it" : "waiting for an agent"}</span>
                        </span>
                        {!r.inProgress && (
                          <button
                            className="text-muted underline shrink-0"
                            onClick={() => {
                              if (window.confirm(`Cancel this ${REQUEST_LABELS[r.type].toLowerCase()} request?${r.type !== "REDEEM" && Number(r.amount) > 0 ? " The amount goes back to your wallet." : ""}`)) {
                                simpleRequest(`/api/games/requests/${r.id}/cancel`, "Request cancelled.");
                              }
                            }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  <button onClick={() => openAction({ kind: "load", ug })} className="btn-gold text-sm py-2">
                    ⬇️ Add Credits
                  </button>
                  <button onClick={() => openAction({ kind: "redeem", ug })} disabled={!active} className="btn-ghost text-sm py-2 disabled:opacity-40">
                    ⬆️ Withdraw Credits
                  </button>
                  <button
                    onClick={() =>
                      simpleRequest(`/api/games/mine/${ug.id}/reset-password`, (res) =>
                        res.done ? "Password reset. Your new password is shown above." : "Password reset requested. You'll see the new password here once it's done."
                      )
                    }
                    disabled={!active}
                    className="btn-ghost text-sm py-2 disabled:opacity-40"
                  >
                    🔄 Reset Password
                  </button>
                  {active && playUrl ? (
                    <a href={playUrl} target="_blank" rel="noopener noreferrer" className="btn-primary text-sm py-2 text-center">
                      🎮 Play Now
                    </a>
                  ) : (
                    <button disabled className="btn-primary text-sm py-2 opacity-40" title={active ? "Contact Support for the play link" : "Available once your account is ready"}>
                      🎮 Play Now
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "available" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {available.map((g) => (
            <div key={g.id} className="card flex flex-col items-center text-center gap-2">
              <GameThumb game={g} className="w-full aspect-square rounded-xl" />
              <p className="text-sm font-medium">{g.name}</p>
              {g.automationProvider && <span className="text-[10px] text-green-400 font-medium">⚡ Instant setup</span>}
              <button onClick={() => openAction({ kind: "add", game: g })} className="btn-gold text-xs py-2 px-3 w-full">
                + Add Game
              </button>
            </div>
          ))}
          {available.length === 0 && <p className="text-muted col-span-full text-center py-10">You&apos;ve added every available game.</p>}
        </div>
      )}

      {tab === "history" && (
        <div className="card p-0 divide-y divide-border">
          {history.map((h) => (
            <div key={h.id} className="px-4 py-3 text-sm flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {REQUEST_LABELS[h.type]} · {h.gameName}
                </p>
                <p className="text-xs text-muted">{new Date(h.createdAt).toLocaleString()}</p>
                {h.agentNote && h.status !== "COMPLETED" && <p className="text-xs text-red-400 mt-0.5">Reason: {h.agentNote}</p>}
                {h.type === "REDEEM" && h.status === "COMPLETED" && h.completedAmount && Number(h.completedAmount) !== Number(h.amount) && (
                  <p className="text-xs text-muted mt-0.5">
                    Asked {money(h.amount)}, redeemed {money(h.completedAmount)}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                {Number(h.completedAmount ?? h.amount) > 0 && <p>{money(h.completedAmount ?? h.amount)}</p>}
                <span
                  className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                    h.status === "COMPLETED"
                      ? "bg-green-500/20 text-green-400"
                      : h.status === "PENDING"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {h.status === "PENDING" && h.inProgress ? "IN PROGRESS" : h.status}
                </span>
              </div>
            </div>
          ))}
          {history.length === 0 && <p className="text-muted text-sm text-center py-10">No game requests yet.</p>}
        </div>
      )}

      {action && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4" onClick={closeAction} role="dialog" aria-modal="true">
          <form onSubmit={submitAction} className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                {action.kind === "add" ? `Add ${action.game.name}` : action.kind === "load" ? `Add Credits to ${action.ug.game.name}` : `Withdraw from ${action.ug.game.name}`}
              </h2>
              <button type="button" onClick={closeAction} className="text-muted" aria-label="Close">
                ✕
              </button>
            </div>

            <p className="text-xs text-muted">
              {action.kind === "add" &&
                "Our team creates your account and shares the login here. Add an amount to load it straight away (optional)."}
              {action.kind === "load" && "The amount leaves your wallet now and an agent loads it into your game."}
              {action.kind === "redeem" &&
                `An agent checks your actual game balance and moves the amount to your wallet. Last known balance: ${money(action.ug.balance)}.`}
            </p>

            <div>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                min="1"
                step="0.01"
                placeholder={action.kind === "add" ? "Amount to load (optional)" : "Amount"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              {action.kind !== "redeem" && (
                <p className="text-xs text-muted mt-1">
                  Wallet balance: {money(walletBalance)}
                  {needsDeposit && ` · you'll deposit ${money(parsedAmount)} and it will be loaded automatically once paid`}
                </p>
              )}
            </div>

            {actionError && <p className="text-sm text-red-400">{actionError}</p>}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : action.kind === "redeem"
                  ? "Request Withdrawal"
                  : needsDeposit
                    ? `Deposit ${money(parsedAmount)} & Load`
                    : action.kind === "add"
                      ? amount.trim()
                        ? `Add Game & Load ${amountValid ? money(parsedAmount) : ""}`
                        : "Add Game"
                      : `Load ${amountValid ? money(parsedAmount) : ""}`}
            </button>
          </form>
        </div>
      )}

      {added && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setAdded(null)} role="dialog" aria-modal="true">
          <div className="card w-full max-w-sm text-center space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-4xl">🎉</div>
            <h2 className="text-xl font-bold">Game Added Successfully</h2>
            <p className="text-sm text-muted">
              Your <strong>{added.name}</strong> account is ready. Use this login in the game app.
            </p>
            <div className="text-sm space-y-2 text-left">
              <CopyField label="Game ID" value={added.username} />
              <CopyField label="Password" value={added.password} secret />
            </div>
            {added.loadPending && <p className="text-xs text-yellow-400">Your first load is being processed and will appear shortly.</p>}
            <button className="btn-primary w-full" onClick={() => setAdded(null)}>
              Got it
            </button>
          </div>
        </div>
      )}

      {depositFor && (
        <CheckoutModal
          methods={payMethods}
          amounts={payOptions?.deposit.amounts}
          min={payOptions?.minDeposit}
          max={payOptions?.maxDeposit}
          payerName={user?.username}
          busy={busy}
          error={checkoutError}
          onPay={payWithGateway}
          onClose={() => !busy && setDepositFor(null)}
        />
      )}
    </AppShell>
  );
}
