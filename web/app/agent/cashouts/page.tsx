"use client";

import { useEffect, useState, useCallback } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Cashout {
  id: string;
  amount: string;
  payoutAmount: string | null;
  forfeitedAmount: string | null;
  status: "PENDING" | "COMPLETED" | "REJECTED";
  adminNote: string | null;
  createdAt: string;
  gatewayProvider: string | null;
  gatewayOrderNo: string | null;
  meta: {
    payout?: { wayCode: string; account: string; cardValid?: string };
    gatewayAlert?: string;
    reviewCode?: string;
    errMsg?: string;
  } | null;
  user: { id: string; fullName: string; username: string; email: string };
}

const TABS = ["PENDING", "COMPLETED", "REJECTED"] as const;

const REVIEW_CODES: Record<string, string> = {
  "12": "partially paid — create a new payout for the rest",
  "13": "partially paid — tag hit its limit, use a different tag for the rest",
  "21": "tag limit reached (Cash App risk control)",
  "22": "account too new (Cash App risk control)",
  "23": "account flagged as risky (Cash App risk control)",
  "24": "tag not found or web link access disabled",
  "25": "incorrect tag",
  "26": "tag is blocked",
};

export default function AgentCashoutsPage() {
  const api = useApi();
  const [tab, setTab] = useState<(typeof TABS)[number]>("PENDING");
  const [cashouts, setCashouts] = useState<Cashout[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (status: string) => {
      const res = await api<{ cashouts: Cashout[] }>(`/api/agent/cashouts?status=${status}`);
      setCashouts(res.cashouts);
    },
    [api]
  );

  useEffect(() => {
    load(tab).catch(() => {});
  }, [tab, load]);

  async function approve(id: string) {
    setError(null);
    setBusyId(id);
    try {
      const res = await api<{ note?: string }>(`/api/agent/cashouts/${id}/approve`, { method: "POST" });
      if (res.note) setError(res.note);
      await load(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve.");
    } finally {
      setBusyId(null);
    }
  }

  async function sync(id: string) {
    setError(null);
    setBusyId(id);
    try {
      await api(`/api/agent/cashouts/${id}/sync`, { method: "POST" });
      await load(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check status.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting this cashout (optional):") || undefined;
    setError(null);
    setBusyId(id);
    try {
      await api(`/api/agent/cashouts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      await load(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-2">Cashouts</h1>
      <p className="text-sm text-muted mb-6">Wallet withdrawals from players of the games you manage.</p>

      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === t ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
          >
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      <div className="space-y-3">
        {cashouts.map((c) => (
          <div key={c.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="font-medium text-primary">{c.user.fullName}</span>
              <span className="text-muted text-sm"> · @{c.user.username}</span>
              <p className="text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</p>
              {c.meta?.payout && (
                <p className="text-xs">
                  Pay to: <span className="font-medium">{c.meta.payout.wayCode}</span> · {c.meta.payout.account}
                  {c.meta.payout.cardValid && ` · exp ${c.meta.payout.cardValid}`}
                </p>
              )}
              {c.gatewayProvider && (
                <p className="text-xs text-yellow-400">Sent via gateway{c.gatewayOrderNo ? ` · ${c.gatewayOrderNo}` : ""}</p>
              )}
              {c.meta?.gatewayAlert && <p className="text-xs font-semibold text-red-400">⚠ Gateway reports {c.meta.gatewayAlert.toLowerCase()}</p>}
              {c.meta?.reviewCode && c.meta.reviewCode !== "11" && (
                <p className="text-xs text-yellow-400">
                  Gateway review {c.meta.reviewCode}
                  {REVIEW_CODES[c.meta.reviewCode] ? `: ${REVIEW_CODES[c.meta.reviewCode]}` : ""}
                </p>
              )}
              {c.meta?.errMsg && <p className="text-xs text-red-400">Gateway: {c.meta.errMsg}</p>}
              {c.adminNote && <p className="text-xs text-muted">Note: {c.adminNote}</p>}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-bold text-lg">${Number(c.payoutAmount ?? c.amount).toFixed(2)}</p>
                {Number(c.forfeitedAmount ?? 0) > 0 && <p className="text-xs text-muted">forfeited ${Number(c.forfeitedAmount).toFixed(2)}</p>}
              </div>
              {(tab === "PENDING" || tab === "COMPLETED") && c.gatewayProvider && (
                <button onClick={() => sync(c.id)} disabled={busyId === c.id} className="btn-ghost text-sm py-2 px-3">
                  Check status
                </button>
              )}
              {tab === "PENDING" && !c.gatewayProvider && (
                <div className="flex gap-2">
                  <button onClick={() => approve(c.id)} disabled={busyId === c.id} className="btn-primary text-sm py-2 px-3">
                    {c.meta?.payout ? "Approve & pay" : "Approve"}
                  </button>
                  <button onClick={() => reject(c.id)} disabled={busyId === c.id} className="btn-ghost text-sm py-2 px-3 text-red-400">
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {cashouts.length === 0 && <p className="text-muted text-sm text-center py-8">No {tab.toLowerCase()} cashouts.</p>}
      </div>
    </AgentShell>
  );
}
