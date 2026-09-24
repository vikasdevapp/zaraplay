"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Deposit {
  id: string;
  amount: string;
  payoutAmount: string | null;
  status: "PENDING" | "COMPLETED" | "REJECTED";
  adminNote: string | null;
  createdAt: string;
  gatewayProvider: string | null;
  gatewayOrderNo: string | null;
  meta: { bonusKind?: string; bonusPercent?: number; wayCode?: string; amountMismatch?: boolean; gatewayAlert?: string } | null;
  user: { id: string; fullName: string; username: string; email: string };
}

const TABS = ["PENDING", "COMPLETED", "REJECTED"] as const;

export default function AdminDepositsPage() {
  const api = useApi();
  const [tab, setTab] = useState<(typeof TABS)[number]>("PENDING");
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (status: string) => {
      const res = await api<{ deposits: Deposit[] }>(`/api/admin/deposits?status=${status}`);
      setDeposits(res.deposits);
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
      await api(`/api/admin/deposits/${id}/approve`, { method: "POST" });
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
      await api(`/api/admin/deposits/${id}/sync`, { method: "POST" });
      await load(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check status.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting this deposit (optional):") || undefined;
    setError(null);
    setBusyId(id);
    try {
      await api(`/api/admin/deposits/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      await load(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Deposit Requests</h1>

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
        {deposits.map((d) => (
          <div key={d.id} className="card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <Link href={`/admin/users/${d.user.id}`} className="font-medium text-primary">
                {d.user.fullName}
              </Link>
              <span className="text-muted text-sm"> · @{d.user.username}</span>
              <p className="text-xs text-muted">{new Date(d.createdAt).toLocaleString()}</p>
              {d.gatewayProvider && (
                <p className="text-xs text-yellow-400">
                  Via gateway{d.meta?.wayCode ? ` · ${d.meta.wayCode}` : ""}
                  {d.gatewayOrderNo ? ` · ${d.gatewayOrderNo}` : ""}
                </p>
              )}
              {d.meta?.gatewayAlert && (
                <p className="text-xs font-semibold text-red-400">⚠ Gateway reports {d.meta.gatewayAlert.toLowerCase()}</p>
              )}
              {d.adminNote && <p className="text-xs text-muted">Note: {d.adminNote}</p>}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-bold text-lg">${Number(d.amount).toFixed(2)}</p>
                {d.meta?.bonusPercent && Number(d.payoutAmount ?? 0) > 0 && (
                  <p className="text-xs text-muted">
                    +{d.meta.bonusPercent}% bonus (${Number(d.payoutAmount).toFixed(2)})
                  </p>
                )}
              </div>
              {tab === "COMPLETED" && d.gatewayProvider && (
                <button onClick={() => sync(d.id)} disabled={busyId === d.id} className="btn-ghost text-sm py-2 px-3">
                  Check status
                </button>
              )}
              {tab === "PENDING" && (
                <div className="flex gap-2">
                  {d.gatewayProvider && (
                    <button onClick={() => sync(d.id)} disabled={busyId === d.id} className="btn-ghost text-sm py-2 px-3">
                      Check status
                    </button>
                  )}
                  {/* Gateway deposits credit themselves once paid; manual approval is only for settling a mismatched amount. */}
                  {(!d.gatewayProvider || d.meta?.amountMismatch) && (
                    <button onClick={() => approve(d.id)} disabled={busyId === d.id} className="btn-primary text-sm py-2 px-3">
                      {d.gatewayProvider ? "Approve anyway" : "Approve"}
                    </button>
                  )}
                  <button onClick={() => reject(d.id)} disabled={busyId === d.id} className="btn-ghost text-sm py-2 px-3 text-red-400">
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {deposits.length === 0 && <p className="text-muted text-sm text-center py-8">No {tab.toLowerCase()} deposits.</p>}
      </div>
    </AdminShell>
  );
}
