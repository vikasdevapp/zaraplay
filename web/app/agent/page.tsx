"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AgentShell from "@/components/AgentShell";
import { useApi } from "@/context/AuthContext";
import { SOURCE_LABELS, TX_LABELS, TxSource, TxType, TypeTotals, money } from "@/lib/desk";

interface Dashboard {
  players: number;
  transactions: number;
  year: number;
  month: string;
  byMonth: number[];
  totals: Record<TxType, TypeTotals>;
  lowBackends: { id: string; name: string; backendBalance: number; backendLowAt: number }[];
}
interface Stats {
  pendingRequests: number;
  myOpenRequests: number;
  handledToday: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CARD_TONE: Record<TxType, string> = {
  RECHARGE: "border-blue-500/30 bg-blue-500/5",
  BONUS: "border-purple-500/30 bg-purple-500/5",
  FREEPLAY: "border-green-500/30 bg-green-500/5",
  REDEEM: "border-red-500/30 bg-red-500/5",
};

/** Transactions per month this year: one series, so no legend; hover shows the exact count. */
function MonthlyChart({ data, year }: { data: number[]; year: number }) {
  const [hover, setHover] = useState<number | null>(null);
  // Counts are whole numbers: four whole-number steps up to a round top.
  const step = Math.max(1, Math.ceil(Math.max(...data) / 4));
  const max = step * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const W = 600;
  const H = 220;
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / 12;
  const barW = Math.min(22, slot * 0.5);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`Transactions per month in ${year}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-border" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-current text-muted" fontSize={10}>
              {t}
            </text>
          </g>
        ))}
        {data.map((v, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const h = (v / max) * plotH;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target spans the whole month slot, bigger than the bar. */}
              <rect x={cx - slot / 2} y={pad.t} width={slot} height={plotH} fill="transparent" />
              {v > 0 && (
                <path
                  d={`M${cx - barW / 2},${y(0)} V${y(v) + Math.min(4, h)} Q${cx - barW / 2},${y(v)} ${cx - barW / 2 + Math.min(4, h)},${y(v)} H${cx + barW / 2 - Math.min(4, h)} Q${cx + barW / 2},${y(v)} ${cx + barW / 2},${y(v) + Math.min(4, h)} V${y(0)} Z`}
                  className="fill-primary"
                  opacity={hover === null || hover === i ? 1 : 0.5}
                />
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="fill-current text-muted" fontSize={10}>
                {MONTHS[i]}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="absolute -translate-x-1/2 -translate-y-full bg-surface2 border border-border rounded-lg px-2.5 py-1.5 text-xs pointer-events-none"
          style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`, top: `${(y(data[hover]) / H) * 100}%` }}
        >
          <span className="text-muted">
            {MONTHS[hover]} {year}:
          </span>{" "}
          <strong>{data[hover]}</strong> transactions
        </div>
      )}
    </div>
  );
}

export default function AgentDashboardPage() {
  const api = useApi();
  const [d, setD] = useState<Dashboard | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    const load = () => {
      api<Dashboard>("/api/agent/desk/dashboard").then(setD).catch(() => {});
      api<Stats>("/api/agent/stats").then(setStats).catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [api]);

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {d && d.lowBackends.length > 0 && (
        <Link href="/agent/game-balances" className="card block mb-4 border-red-500/40 text-sm text-red-300">
          ⚠ Low backend credits: {d.lowBackends.map((g) => `${g.name} (${money(g.backendBalance)})`).join(", ")} — top up in Games Balance →
        </Link>
      )}

      {stats && stats.pendingRequests > 0 && (
        <Link href="/agent/requests" className="card block mb-4 border-primary/50 text-sm">
          📥 <strong>{stats.pendingRequests}</strong> website request{stats.pendingRequests > 1 ? "s" : ""} waiting · you&apos;re working on {stats.myOpenRequests} →
        </Link>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-3 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <p className="text-sm text-muted">👥 Players</p>
              <p className="text-3xl font-extrabold mt-2">{d?.players ?? "—"}</p>
            </div>
            <div className="card">
              <p className="text-sm text-muted">📦 Transactions</p>
              <p className="text-3xl font-extrabold mt-2">{d?.transactions ?? "—"}</p>
            </div>
          </div>
          <div className="card">
            <h2 className="font-bold mb-3">Monthly Transactions {d ? `· ${d.year}` : ""}</h2>
            {d ? <MonthlyChart data={d.byMonth} year={d.year} /> : <div className="h-48" />}
          </div>
        </div>

        <div className="xl:col-span-2 card">
          <h2 className="font-bold">Monthly Transaction Statistics</h2>
          <p className="text-xs text-muted mb-4">{d?.month}: recharge, bonus, redeem and free play totals</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["RECHARGE", "BONUS", "FREEPLAY", "REDEEM"] as TxType[]).map((t) => {
              const tot = d?.totals[t];
              return (
                <div key={t} className={`rounded-xl border p-4 text-center ${CARD_TONE[t]}`}>
                  <p className="text-sm text-muted">{t === "FREEPLAY" ? "FP Free Play" : `Total ${TX_LABELS[t]}`}</p>
                  <p className="text-2xl font-extrabold my-1">{money(tot?.amount)}</p>
                  <p className="text-xs text-muted">{tot?.count ?? 0} transactions</p>
                  <p className="text-[11px] text-muted mt-1">
                    {(["PAGE", "PERSONAL", "WEB"] as TxSource[])
                      .filter((s) => t !== "BONUS" || s !== "WEB")
                      .map((s) => `${SOURCE_LABELS[s]}: ${money(tot?.bySource[s]?.amount)} (${tot?.bySource[s]?.count ?? 0})`)
                      .join(" | ")}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AgentShell>
  );
}
