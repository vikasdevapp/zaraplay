"use client";

import { useEffect, useState, useCallback } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";

interface Transaction {
  id: string;
  amount: string;
  status: string;
  createdAt: string;
  user: { id: string; fullName: string; username: string };
}

export default function AgentLedgerPage() {
  const api = useApi();
  const [tab, setTab] = useState<"RECHARGE" | "REDEEM">("RECHARGE");
  const [rows, setRows] = useState<Transaction[]>([]);

  const load = useCallback(
    async (t: string) => {
      const res = await api<{ transactions: Transaction[] }>(`/api/agent/ledger?type=${t}`);
      setRows(res.transactions);
    },
    [api]
  );

  useEffect(() => {
    load(tab).catch(() => {});
  }, [tab, load]);

  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Recharge Ledger</h1>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("RECHARGE")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "RECHARGE" ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
        >
          Recharge (Deposits)
        </button>
        <button
          onClick={() => setTab("REDEEM")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "REDEEM" ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
        >
          Redeem (Cashouts)
        </button>
      </div>

      <div className="card mb-4">
        <p className="text-muted text-xs mb-1">Total {tab === "RECHARGE" ? "Recharged" : "Redeemed"} (last 100)</p>
        <p className="text-2xl font-extrabold text-primary">${total.toFixed(2)}</p>
        <p className="text-xs text-muted">{rows.length} rows</p>
      </div>

      <div className="card p-0 divide-y divide-border">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <div>
              <p className="font-medium">
                {r.user.fullName} <span className="text-muted">@{r.user.username}</span>
              </p>
              <p className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold">${Number(r.amount).toFixed(2)}</p>
              {r.status !== "COMPLETED" && <p className="text-[10px] text-muted uppercase">{r.status}</p>}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-muted text-sm text-center py-8">No rows.</p>}
      </div>
    </AgentShell>
  );
}
