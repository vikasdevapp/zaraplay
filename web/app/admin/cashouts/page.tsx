"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
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
  user: { id: string; fullName: string; username: string; email: string };
}

const TABS = ["PENDING", "COMPLETED", "REJECTED"] as const;

export default function AdminCashoutsPage() {
  const api = useApi();
  const [tab, setTab] = useState<(typeof TABS)[number]>("PENDING");
  const [cashouts, setCashouts] = useState<Cashout[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (status: string) => {
      const res = await api<{ cashouts: Cashout[] }>(`/api/admin/cashouts?status=${status}`);
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
      await api(`/api/admin/cashouts/${id}/approve`, { method: "POST" });
      await load(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt("Reason for rejecting this cashout (optional):") || undefined;
    setError(null);
    setBusyId(id);
    try {
      await api(`/api/admin/cashouts/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      await load(tab);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Cashouts</h1>

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
              <Link href={`/admin/users/${c.user.id}`} className="font-medium text-primary">
                {c.user.fullName}
              </Link>
              <span className="text-muted text-sm"> · @{c.user.username}</span>
              <p className="text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</p>
              {c.adminNote && <p className="text-xs text-muted">Note: {c.adminNote}</p>}
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-bold text-lg">${Number(c.payoutAmount ?? c.amount).toFixed(2)}</p>
                {Number(c.forfeitedAmount ?? 0) > 0 && (
                  <p className="text-xs text-muted">forfeited ${Number(c.forfeitedAmount).toFixed(2)}</p>
                )}
              </div>
              {tab === "PENDING" && (
                <div className="flex gap-2">
                  <button onClick={() => approve(c.id)} disabled={busyId === c.id} className="btn-primary text-sm py-2 px-3">
                    Approve
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
    </AdminShell>
  );
}
