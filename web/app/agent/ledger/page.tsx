"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { DeskFilters, FilterState, Pager, PageSizeSelect, emptyFilters } from "@/components/desk/DeskFilters";
import { useDeskMeta } from "@/components/desk/useDeskMeta";
import { dayRangeParams, money } from "@/lib/desk";

interface TopUp {
  id: string;
  amount: string;
  balanceAfter: string;
  note: string | null;
  createdAt: string;
  game: { name: string };
  staff: { username: string };
}

export default function AgentBackendLedgerPage() {
  const api = useApi();
  const { games, staff } = useDeskMeta();
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<TopUp[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters.gameId) params.set("gameId", filters.gameId);
    if (filters.staffId) params.set("staffId", filters.staffId);
    dayRangeParams(filters.from, filters.to, params);
    const r = await api<{ rows: TopUp[]; total: number; totalAmount: number }>(`/api/agent/desk/topups?${params}`);
    setRows(r.rows);
    setTotal(r.total);
    setTotalAmount(r.totalAmount);
  }, [api, filters, page, pageSize]);

  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Recharge Ledger</h1>
      <p className="text-sm text-muted mb-6">
        Credits bought for each game&apos;s backend. Record new top-ups from <Link href="/agent/game-balances" className="text-primary underline">Games Balance</Link>.
      </p>

      <div className="card mb-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-bold">Backend Top-ups</h2>
          <PageSizeSelect
            value={pageSize}
            onChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
        </div>
        <DeskFilters
          value={filters}
          onChange={(f) => {
            setFilters({ ...f, search: "", source: "" });
            setPage(1);
          }}
          games={games}
          staff={staff}
          hideSearch
          count={total}
          countLabel="top-ups found"
          extra={<span className="font-semibold">Total: {money(totalAmount)}</span>}
        />
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Game</th>
              <th className="px-3 py-3 font-medium text-right">Amount</th>
              <th className="px-3 py-3 font-medium text-right">Backend after</th>
              <th className="px-3 py-3 font-medium">Staff</th>
              <th className="px-4 py-3 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 text-xs text-muted whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2.5">{r.game.name}</td>
                <td className="px-3 py-2.5 text-right font-semibold">+{money(r.amount)}</td>
                <td className="px-3 py-2.5 text-right text-muted">{money(r.balanceAfter)}</td>
                <td className="px-3 py-2.5">@{r.staff.username}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-muted text-sm text-center py-10">No top-ups recorded.</p>}
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>
    </AgentShell>
  );
}
