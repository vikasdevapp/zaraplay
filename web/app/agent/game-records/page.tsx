"use client";

import { useCallback, useEffect, useState } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { dayRangeParams, money } from "@/lib/desk";

interface Record_ {
  game: { id: string; name: string };
  accounts: number;
  recharge: number;
  bonus: number;
  freeplay: number;
  redeem: number;
  transactions: number;
  net: number;
}

export default function AgentGameRecordsPage() {
  const api = useApi();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [records, setRecords] = useState<Record_[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    dayRangeParams(from, to, params);
    const r = await api<{ records: Record_[] }>(`/api/agent/desk/game-records?${params}`);
    setRecords(r.records);
  }, [api, from, to]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const sum = (k: keyof Omit<Record_, "game">) => records.reduce((n, r) => n + r[k], 0);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Game Records</h1>
      <p className="text-sm text-muted mb-6">Credits given out and taken back per game. Net = recharge + bonus + free play − redeem.</p>

      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          From Date
          <input className="input mt-1" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          To Date
          <input className="input mt-1" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className="btn-ghost text-xs px-3 py-2"
          disabled={!from && !to}
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          All time
        </button>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Game</th>
              <th className="px-3 py-3 font-medium text-right">Accounts</th>
              <th className="px-3 py-3 font-medium text-right">Recharge</th>
              <th className="px-3 py-3 font-medium text-right">Bonus</th>
              <th className="px-3 py-3 font-medium text-right">Free Play</th>
              <th className="px-3 py-3 font-medium text-right">Redeem</th>
              <th className="px-3 py-3 font-medium text-right">Net</th>
              <th className="px-4 py-3 font-medium text-right">Transactions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {records.map((r) => (
              <tr key={r.game.id}>
                <td className="px-4 py-2.5 font-medium">{r.game.name}</td>
                <td className="px-3 py-2.5 text-right">{r.accounts}</td>
                <td className="px-3 py-2.5 text-right">{money(r.recharge)}</td>
                <td className="px-3 py-2.5 text-right">{money(r.bonus)}</td>
                <td className="px-3 py-2.5 text-right">{money(r.freeplay)}</td>
                <td className="px-3 py-2.5 text-right">{money(r.redeem)}</td>
                <td className="px-3 py-2.5 text-right font-semibold">{money(r.net)}</td>
                <td className="px-4 py-2.5 text-right text-muted">{r.transactions}</td>
              </tr>
            ))}
          </tbody>
          {records.length > 0 && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="px-4 py-3">Total</td>
                <td className="px-3 py-3 text-right">{sum("accounts")}</td>
                <td className="px-3 py-3 text-right">{money(sum("recharge"))}</td>
                <td className="px-3 py-3 text-right">{money(sum("bonus"))}</td>
                <td className="px-3 py-3 text-right">{money(sum("freeplay"))}</td>
                <td className="px-3 py-3 text-right">{money(sum("redeem"))}</td>
                <td className="px-3 py-3 text-right">{money(sum("net"))}</td>
                <td className="px-4 py-3 text-right">{sum("transactions")}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {records.length === 0 && <p className="text-muted text-sm text-center py-10">No games yet.</p>}
      </div>
    </AgentShell>
  );
}
