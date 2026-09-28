"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi, useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

type RequestType = "CREATE_ACCOUNT" | "RECHARGE" | "REDEEM" | "PASSWORD_RESET" | "BALANCE_CHECK";
type Status = "PENDING" | "COMPLETED" | "REJECTED" | "CANCELLED";

interface GameRequest {
  id: string;
  type: RequestType;
  status: Status;
  amount: string;
  completedAmount: string | null;
  agentNote: string | null;
  createdAt: string;
  completedAt: string | null;
  claimedAt: string | null;
  user: { id: string; fullName: string; username: string; email: string };
  userGame: {
    id: string;
    status: "PENDING" | "ACTIVE" | "REJECTED";
    gameUsername: string | null;
    gamePassword: string | null;
    balance: string;
    balanceSyncedAt: string | null;
    game: { id: string; name: string };
  };
  claimedBy: { id: string; username: string } | null;
  handledBy: { id: string; username: string } | null;
}

const TYPE_META: Record<RequestType, { label: string; badge: string; help: string }> = {
  CREATE_ACCOUNT: {
    label: "Create account",
    badge: "bg-blue-500/20 text-blue-300",
    help: "Create the player's account on the game platform, load the amount shown (if any), then enter the login you created.",
  },
  RECHARGE: {
    label: "Load credits",
    badge: "bg-green-500/20 text-green-300",
    help: "Load exactly this amount into the player's game account, then mark it loaded. The money has already left their wallet.",
  },
  REDEEM: {
    label: "Redeem",
    badge: "bg-yellow-500/20 text-yellow-300",
    help: "Check the player's real balance on the game platform, redeem up to the amount asked, then enter what you redeemed and what's left. The redeemed amount goes to their wallet.",
  },
  BALANCE_CHECK: {
    label: "Balance check",
    badge: "bg-teal-500/20 text-teal-300",
    help: "The player wants their current balance. Look it up on the game platform and enter exactly what it shows — nothing is loaded or redeemed.",
  },
  PASSWORD_RESET: {
    label: "Password reset",
    badge: "bg-purple-500/20 text-purple-300",
    help: "Set a new password for this account on the game platform, then enter it here.",
  },
};

const money = (v: string | number) => `$${Number(v).toFixed(2)}`;

function age(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="font-mono text-left hover:text-primary"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // clipboard blocked; value is visible
        }
      }}
    >
      {value} <span className="text-[10px] text-muted">{copied ? "copied" : "⧉"}</span>
    </button>
  );
}

function RequestCard({ r, meId, isAdmin, onDone }: { r: GameRequest; meId: string; isAdmin: boolean; onDone: (msg: string) => Promise<void> }) {
  const api = useApi();
  const [gameUsername, setGameUsername] = useState("");
  const [gamePassword, setGamePassword] = useState("");
  const [redeemed, setRedeemed] = useState(Number(r.amount).toFixed(2));
  const [remaining, setRemaining] = useState("");
  const [checked, setChecked] = useState("");
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_META[r.type];
  const pending = r.status === "PENDING";
  const mine = r.claimedBy?.id === meId;
  const lockedByOther = pending && !!r.claimedBy && !mine && !isAdmin;
  const accountMissing = r.type === "RECHARGE" && r.userGame.status !== "ACTIVE";

  async function call(path: string, body?: unknown, msg = "Done.") {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      await onDone(msg);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function complete(e: FormEvent) {
    e.preventDefault();
    const base = `/api/agent/requests/${r.id}/complete`;
    const n = note.trim() || undefined;
    switch (r.type) {
      case "CREATE_ACCOUNT":
        return call(base, { gameUsername, gamePassword, note: n }, `Account created for @${r.user.username}.`);
      case "RECHARGE":
        return call(base, { note: n }, `${money(r.amount)} loaded for @${r.user.username}.`);
      case "REDEEM": {
        const redeemedAmount = Number(redeemed);
        const remainingBalance = Number(remaining);
        if (!remaining.trim() || !Number.isFinite(remainingBalance)) {
          setError("Enter the balance left in the game after the redeem.");
          return;
        }
        return call(base, { redeemedAmount, remainingBalance, note: n }, `${money(redeemedAmount)} redeemed to @${r.user.username}'s wallet.`);
      }
      case "PASSWORD_RESET":
        return call(base, { gamePassword, note: n }, `Password reset for @${r.user.username}.`);
      case "BALANCE_CHECK": {
        const balance = Number(checked);
        if (!checked.trim() || !Number.isFinite(balance) || balance < 0) {
          setError("Enter the balance the game shows now.");
          return;
        }
        return call(base, { balance, note: n }, `Balance updated for @${r.user.username}.`);
      }
    }
  }

  return (
    <div className={`card space-y-3 ${mine && pending ? "ring-1 ring-primary" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${meta.badge}`}>{meta.label}</span>
            <span className="font-bold">{r.userGame.game.name}</span>
            {Number(r.amount) > 0 && <span className="font-bold text-primary">{money(r.amount)}</span>}
          </div>
          <p className="text-sm mt-1">
            {r.user.fullName} <span className="text-muted">@{r.user.username} · {r.user.email}</span>
          </p>
        </div>
        <div className="text-right text-xs text-muted shrink-0">
          <p>{age(r.createdAt)}</p>
          {pending && r.claimedBy && <p className={mine ? "text-primary" : ""}>{mine ? "You're on it" : `@${r.claimedBy.username} is on it`}</p>}
          {!pending && r.handledBy && <p>by @{r.handledBy.username}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
        <div className="bg-surface2 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted uppercase">Game ID</p>
          {r.userGame.gameUsername ? <Copyable value={r.userGame.gameUsername} /> : <p className="text-muted">Not created yet</p>}
        </div>
        <div className="bg-surface2 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted uppercase">Password</p>
          {r.userGame.gamePassword ? <Copyable value={r.userGame.gamePassword} /> : <p className="text-muted">—</p>}
        </div>
        <div className="bg-surface2 rounded-lg px-3 py-2">
          <p className="text-[10px] text-muted uppercase">Recorded game balance</p>
          <p>
            {money(r.userGame.balance)}{" "}
            <span className="text-[10px] text-muted">{r.userGame.balanceSyncedAt ? `synced ${age(r.userGame.balanceSyncedAt)}` : "never synced"}</span>
          </p>
        </div>
      </div>

      {!pending && (
        <div className="text-sm">
          <span
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
              r.status === "COMPLETED" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
            }`}
          >
            {r.status}
          </span>
          {r.type === "REDEEM" && r.completedAmount && <span className="ml-2">Redeemed {money(r.completedAmount)}</span>}
          {r.agentNote && <span className="ml-2 text-muted">— {r.agentNote}</span>}
          {r.completedAt && <span className="ml-2 text-xs text-muted">{new Date(r.completedAt).toLocaleString()}</span>}
        </div>
      )}

      {pending && (
        <>
          <p className="text-xs text-muted">{meta.help}</p>
          {accountMissing && <p className="text-xs text-yellow-400">This player&apos;s account isn&apos;t created yet — finish their Create account request first.</p>}

          {!r.claimedBy && !isAdmin ? (
            <button className="btn-primary text-sm" disabled={busy} onClick={() => call(`/api/agent/requests/${r.id}/claim`, undefined, "Request claimed — it's yours.")}>
              ✋ Claim this request
            </button>
          ) : lockedByOther ? (
            <p className="text-sm text-muted">Another agent is working on this request.</p>
          ) : rejecting ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                call(`/api/agent/requests/${r.id}/reject`, { reason }, "Request rejected.");
              }}
            >
              <input className="input" placeholder="Reason shown to the player" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} autoFocus />
              <p className="text-xs text-muted">
                {r.type === "RECHARGE" || (r.type === "CREATE_ACCOUNT" && Number(r.amount) > 0)
                  ? `${money(r.amount)} will be returned to the player's wallet.`
                  : "Nothing is charged or credited."}
              </p>
              <div className="flex gap-2">
                <button className="btn-primary text-sm bg-red-600 hover:bg-red-700" disabled={busy}>
                  Reject
                </button>
                <button type="button" className="btn-ghost text-sm" onClick={() => setRejecting(false)}>
                  Back
                </button>
              </div>
            </form>
          ) : (
            <form className="space-y-2" onSubmit={complete}>
              {r.type === "CREATE_ACCOUNT" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input className="input" placeholder="Game username you created" value={gameUsername} onChange={(e) => setGameUsername(e.target.value)} required maxLength={100} />
                  <input className="input" placeholder="Game password" value={gamePassword} onChange={(e) => setGamePassword(e.target.value)} required maxLength={100} />
                </div>
              )}
              {r.type === "BALANCE_CHECK" && (
                <label className="text-xs text-muted block">
                  Balance the game shows now (recorded: {money(r.userGame.balance)})
                  <input className="input mt-1" type="number" step="0.01" min="0" placeholder="e.g. 42.50" value={checked} onChange={(e) => setChecked(e.target.value)} required />
                </label>
              )}
              {r.type === "PASSWORD_RESET" && (
                <input className="input" placeholder="New game password" value={gamePassword} onChange={(e) => setGamePassword(e.target.value)} required maxLength={100} />
              )}
              {r.type === "REDEEM" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="text-xs text-muted">
                    Amount redeemed (max {money(r.amount)})
                    <input className="input mt-1" type="number" step="0.01" min="1" max={Number(r.amount)} value={redeemed} onChange={(e) => setRedeemed(e.target.value)} required />
                  </label>
                  <label className="text-xs text-muted">
                    Balance left in the game
                    <input className="input mt-1" type="number" step="0.01" min="0" placeholder="e.g. 0.00" value={remaining} onChange={(e) => setRemaining(e.target.value)} required />
                  </label>
                </div>
              )}
              <input className="input" placeholder="Internal note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              <div className="flex gap-2 flex-wrap">
                <button className="btn-primary text-sm" disabled={busy || accountMissing}>
                  {r.type === "CREATE_ACCOUNT"
                    ? `✅ Account created${Number(r.amount) > 0 ? ` & ${money(r.amount)} loaded` : ""}`
                    : r.type === "RECHARGE"
                      ? `✅ ${money(r.amount)} loaded`
                      : r.type === "REDEEM"
                        ? "✅ Redeem done"
                        : r.type === "BALANCE_CHECK"
                          ? "✅ Balance updated"
                          : "✅ Password set"}
                </button>
                <button type="button" className="btn-ghost text-sm" onClick={() => setRejecting(true)} disabled={busy}>
                  ✖ Reject
                </button>
                {(mine || (isAdmin && r.claimedBy)) && (
                  <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => call(`/api/agent/requests/${r.id}/release`, undefined, "Released back to the queue.")}>
                    ↩ Release
                  </button>
                )}
              </div>
            </form>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}

export default function AgentRequestsPage() {
  const api = useApi();
  const { user } = useAuth();
  const [status, setStatus] = useState<Status>("PENDING");
  const [type, setType] = useState<RequestType | "">("");
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [requests, setRequests] = useState<GameRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ status });
    if (type) params.set("type", type);
    if (mineOnly) params.set("mine", "1");
    if (search.trim()) params.set("search", search.trim());
    const res = await api<{ requests: GameRequest[] }>(`/api/agent/requests?${params}`);
    setRequests(res.requests);
    setLoaded(true);
  }, [api, status, type, mineOnly, search]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    // The queue is shared between agents; keep it fresh.
    const poll = setInterval(() => load().catch(() => {}), 15000);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
    };
  }, [load]);

  async function onDone(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
    await load();
  }

  const isAdmin = user?.role === "ADMIN" || user?.role === "MASTER_ADMIN";

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-4">Requests</h1>

      <div className="flex flex-wrap gap-2 mb-3">
        {(["PENDING", "COMPLETED", "REJECTED", "CANCELLED"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${status === s ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select className="input sm:w-48" value={type} onChange={(e) => setType(e.target.value as RequestType | "")}>
          <option value="">All types</option>
          {(Object.keys(TYPE_META) as RequestType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_META[t].label}
            </option>
          ))}
        </select>
        <input className="input flex-1 min-w-[180px]" placeholder="Search player or game ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only mine
        </label>
      </div>

      {flash && <p className="text-sm text-green-400 mb-3">{flash}</p>}

      <div className="space-y-3">
        {requests.map((r) => (
          <RequestCard key={r.id} r={r} meId={user?.id ?? ""} isAdmin={isAdmin} onDone={onDone} />
        ))}
        {loaded && requests.length === 0 && (
          <p className="text-muted text-sm text-center py-10">{status === "PENDING" ? "No pending requests. 🎉" : "Nothing here yet."}</p>
        )}
      </div>
    </AgentShell>
  );
}
