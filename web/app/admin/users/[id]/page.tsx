"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import { useParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface UserDetail {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  role: "USER" | "AGENT" | "SUPPORT" | "ADMIN" | "MASTER_ADMIN";
  createdAt: string;
  signupIp: string;
  blockedAt: string | null;
  blockedReason: string | null;
  wallet: { balance: string; withdrawable: string; totalDeposited: string; lastDepositAmount: string } | null;
  games: { id: string; gameUsername: string | null; gamePassword: string | null; balance: string; game: { name: string } }[];
  transactions: { id: string; type: string; amount: string; status: string; adminNote: string | null; createdAt: string }[];
}

function GameLoginRow({ g, onChanged }: { g: UserDetail["games"][number]; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ linked?: boolean; reason?: string }>(`/api/admin/game-accounts/${g.id}/credentials`, {
        method: "PUT",
        body: JSON.stringify({ gameUsername: username, gamePassword: password }),
      });
      if (res.reason) {
        setErr(`Saved, but couldn't link to the game account (${res.reason}). Make sure the username exists on the game platform, or loads/withdraws may go to the wrong account.`);
        return;
      }
      setEditing(false);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update login.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="py-2 space-y-2 text-sm">
        <p className="font-medium">{g.game.name} — edit login</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className="input" placeholder="Game username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <input className="input" placeholder="Game password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex gap-2">
          <button className="btn-primary text-xs px-3 py-1.5" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button className="btn-ghost text-xs px-3 py-1.5" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="font-medium shrink-0">{g.game.name}</span>
      <span className="text-muted font-mono text-xs flex-1 text-center truncate">
        {g.gameUsername || "—"}
        {g.gamePassword ? ` / ${showPw ? g.gamePassword : "••••••"}` : ""}
        {g.gamePassword && (
          <button className="ml-1 text-primary font-sans" onClick={() => setShowPw((s) => !s)}>
            {showPw ? "hide" : "show"}
          </button>
        )}
      </span>
      <span className="text-primary shrink-0">${Number(g.balance).toFixed(2)}</span>
      <button
        className="text-xs text-primary underline shrink-0"
        onClick={() => {
          setUsername(g.gameUsername ?? "");
          setPassword(g.gamePassword ?? "");
          setEditing(true);
        }}
      >
        Edit login
      </button>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const api = useApi();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bucket, setBucket] = useState<"balance" | "withdrawable">("balance");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnMsg, setWarnMsg] = useState("");
  const [modBusy, setModBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ user: UserDetail }>(`/api/admin/users/${params.id}`);
    setUser(res.user);
  }, [api, params.id]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleAdjust(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      await api(`/api/admin/users/${params.id}/adjust-balance`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), reason, bucket }),
      });
      setMessage({ type: "success", text: "Balance adjusted." });
      setAmount("");
      setReason("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Adjustment failed." });
    } finally {
      setBusy(false);
    }
  }

  async function sendWarning() {
    if (!warnMsg.trim()) return;
    setMessage(null);
    setModBusy(true);
    try {
      await api(`/api/admin/users/${params.id}/warn`, { method: "POST", body: JSON.stringify({ message: warnMsg }) });
      setMessage({ type: "success", text: "Warning sent to the player." });
      setWarnMsg("");
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Could not send warning." });
    } finally {
      setModBusy(false);
    }
  }

  async function toggleBlock() {
    if (!user) return;
    const blocking = !user.blockedAt;
    const reason = blocking ? window.prompt("Reason for blocking this account (shown to the player):") ?? undefined : undefined;
    if (blocking && reason === undefined) return; // cancelled
    setMessage(null);
    setModBusy(true);
    try {
      await api(`/api/admin/users/${params.id}/${blocking ? "block" : "unblock"}`, { method: "POST", body: JSON.stringify(blocking ? { reason } : {}) });
      setMessage({ type: "success", text: blocking ? "Account blocked." : "Account unblocked." });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Could not update the account." });
    } finally {
      setModBusy(false);
    }
  }

  if (!user) {
    return (
      <AdminShell>
        <p className="text-muted">Loading…</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">
        {user.fullName}
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${user.role === "USER" ? "bg-slate-500/20 text-slate-300" : "bg-amber-500/20 text-amber-300"}`}>
          {user.role === "USER" ? "Player" : user.role}
        </span>
        {user.blockedAt && <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">Blocked</span>}
      </h1>
      <p className="text-muted text-sm mb-6">
        @{user.username} · {user.email} · joined {new Date(user.createdAt).toLocaleDateString()} · signup IP {user.signupIp}
      </p>
      {user.role !== "USER" && (
        <p className="text-xs text-muted bg-surface2 border border-border rounded-lg p-2.5 mb-6">
          This is a staff account ({user.role.toLowerCase()}), so warn/block tools don&apos;t apply. Manage staff under Agent Team (agents) or an agent&apos;s My Staff (support).
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <p className="text-muted text-xs mb-1">Balance</p>
          <p className="text-2xl font-extrabold text-primary">${Number(user.wallet?.balance ?? 0).toFixed(2)}</p>
        </div>
        <div className="card">
          <p className="text-muted text-xs mb-1">Withdrawable</p>
          <p className="text-2xl font-extrabold text-gold">${Number(user.wallet?.withdrawable ?? 0).toFixed(2)}</p>
        </div>
        <div className="card">
          <p className="text-muted text-xs mb-1">Total Deposited</p>
          <p className="text-2xl font-extrabold">${Number(user.wallet?.totalDeposited ?? 0).toFixed(2)}</p>
        </div>
      </div>

      <form onSubmit={handleAdjust} className="card mb-6 space-y-3">
        <h2 className="font-bold">Adjust Balance</h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="input"
            type="number"
            step="0.01"
            placeholder="Amount (use - to deduct)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <select className="input sm:w-40" value={bucket} onChange={(e) => setBucket(e.target.value as "balance" | "withdrawable")}>
            <option value="balance">Balance (locked)</option>
            <option value="withdrawable">Withdrawable</option>
          </select>
        </div>
        <input className="input" placeholder="Reason (required, shown in transaction history)" value={reason} onChange={(e) => setReason(e.target.value)} required />
        {message && <p className={`text-sm ${message.type === "error" ? "text-red-400" : "text-green-400"}`}>{message.text}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Applying…" : "Apply Adjustment"}
        </button>
      </form>

      {user.role === "USER" && (
        <div className="card mb-6 space-y-3">
          <h2 className="font-bold">Moderation</h2>
          {user.blockedAt && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
              🚫 Blocked on {new Date(user.blockedAt).toLocaleString()}
              {user.blockedReason ? ` · ${user.blockedReason}` : ""}
            </p>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <input className="input flex-1" placeholder="Warning message (shown in the player's notifications)" value={warnMsg} onChange={(e) => setWarnMsg(e.target.value)} />
            <button type="button" onClick={sendWarning} disabled={modBusy || !warnMsg.trim()} className="btn-ghost sm:w-40 disabled:opacity-40">
              ⚠️ Send Warning
            </button>
          </div>
          <button
            type="button"
            onClick={toggleBlock}
            disabled={modBusy}
            className={`w-full sm:w-auto px-4 py-2 rounded-xl text-sm font-semibold ${user.blockedAt ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30" : "bg-red-500/20 text-red-300 hover:bg-red-500/30"}`}
          >
            {user.blockedAt ? "Unblock account" : "Block account"}
          </button>
        </div>
      )}

      <div className="card mb-6">
        <h2 className="font-bold mb-3">Games</h2>
        {user.games.length === 0 && <p className="text-muted text-sm">No games added.</p>}
        <div className="divide-y divide-border">
          {user.games.map((g) => (
            <GameLoginRow key={g.id} g={g} onChanged={load} />
          ))}
        </div>
      </div>

      <div className="card">
        <h2 className="font-bold mb-3">Transaction History</h2>
        <div className="divide-y divide-border">
          {user.transactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium">{t.type.replace(/_/g, " ")}</p>
                <p className="text-muted text-xs">
                  {new Date(t.createdAt).toLocaleString()} {t.adminNote ? `· ${t.adminNote}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className={Number(t.amount) < 0 || t.type === "CASHOUT" ? "text-red-400" : "text-green-400"}>
                  {t.type === "CASHOUT" ? "-" : Number(t.amount) < 0 ? "" : "+"}${Math.abs(Number(t.amount)).toFixed(2)}
                </p>
                {t.status !== "COMPLETED" && <p className="text-[10px] text-muted uppercase">{t.status}</p>}
              </div>
            </div>
          ))}
          {user.transactions.length === 0 && <p className="text-muted text-sm">No transactions.</p>}
        </div>
      </div>
    </AdminShell>
  );
}
