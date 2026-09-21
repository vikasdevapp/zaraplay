"use client";

import { useEffect, useState, useCallback } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";

interface Transaction {
  id: string;
  type: string;
  amount: string;
  status: string;
  createdAt: string;
  user: { id: string; fullName: string; username: string };
}

const GROUPS = [
  { key: "", label: "All" },
  { key: "RECHARGE", label: "Recharge" },
  { key: "BONUS", label: "Bonus" },
  { key: "REDEEM", label: "Redeem" },
  { key: "FREE_PLAY", label: "Free Play" },
  { key: "ADJUSTMENT", label: "Adjustment" },
];

export default function AdminTransactionsPage() {
  const api = useApi();
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (group) params.set("group", group);
    if (search) params.set("search", search);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(page));
    const res = await api<{ transactions: Transaction[]; total: number }>(`/api/admin/transactions?${params}`);
    setRows(res.transactions);
    setTotal(res.total);
  }, [api, group, search, from, to, page]);

  useEffect(() => {
    setPage(1);
  }, [group, search, from, to]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Transactions</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setGroup(g.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${group === g.key ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="card mb-4 flex flex-col sm:flex-row gap-3">
        <input className="input flex-1" placeholder="Search user…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input className="input sm:w-44" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input sm:w-44" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-border">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-surface2">
                <td className="px-4 py-3">{t.user.fullName} <span className="text-muted">@{t.user.username}</span></td>
                <td className="px-4 py-3">{t.type.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      t.status === "COMPLETED" ? "bg-green-500/20 text-green-400" : t.status === "PENDING" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3">${Number(t.amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-muted">{new Date(t.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-muted text-sm text-center py-8">No transactions found.</p>}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost text-xs py-1.5 px-3 disabled:opacity-40">
              Prev
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="btn-ghost text-xs py-1.5 px-3 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
