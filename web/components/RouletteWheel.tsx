"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Prize {
  id: string;
  label: string;
  amount: string;
  weight: number;
  colorHex: string;
}

interface Status {
  canSpin: boolean;
  nextAvailableInSeconds: number;
  prizes: Prize[];
  lastSpin: { prizeLabel: string; amount: string; createdAt: string } | null;
}

function formatCountdown(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const SIZE = 200;
const C = SIZE / 2;
const R = C - 4;
const SPIN_MS = 4500;

// Point on the rim at `deg` degrees clockwise from 12 o'clock.
function rimXY(deg: number, r = R) {
  const rad = (deg * Math.PI) / 180;
  return [C + r * Math.sin(rad), C - r * Math.cos(rad)] as const;
}
const rim = (deg: number) => rimXY(deg).join(",");

export default function RouletteWheel({ onWin }: { onWin?: () => void }) {
  const api = useApi();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(() => {
    setLoadFailed(false);
    api<Status>("/api/roulette/status")
      .then(setStatus)
      .catch(() => setLoadFailed(true));
  }, [api]);

  useEffect(() => {
    load();
    return () => clearTimeout(timeoutRef.current);
  }, [load]);

  const prizes = status?.prizes ?? [];
  // Equal slices: the server picks the prize by weight; the wheel only shows where it landed.
  const slice = prizes.length ? 360 / prizes.length : 360;

  async function handleSpin() {
    if (!status?.canSpin || spinning) return;
    setError(null);
    setResult(null);
    setSpinning(true);
    try {
      const res = await api<{ prize: Prize }>("/api/roulette/spin", { method: "POST" });
      const index = Math.max(0, prizes.findIndex((p) => p.id === res.prize.id));
      // Land somewhere inside the slice (not dead centre), then bring it under the top pointer.
      const jitter = (Math.random() - 0.5) * slice * 0.6;
      const target = index * slice + slice / 2 + jitter;
      setRotation((r) => {
        const current = ((r % 360) + 360) % 360;
        const toTarget = (((360 - target - current) % 360) + 360) % 360;
        return r + 6 * 360 + toTarget;
      });
      timeoutRef.current = setTimeout(() => {
        setSpinning(false);
        setResult(Number(res.prize.amount) > 0 ? `🎉 You won ${res.prize.label}!` : `${res.prize.label} this time — try again tomorrow!`);
        load();
        onWin?.();
      }, SPIN_MS);
    } catch (err) {
      setSpinning(false);
      setError(err instanceof ApiError ? err.message : "Could not spin right now.");
      load();
    }
  }

  if (!status) {
    return (
      <div className="flex flex-col items-center gap-4 py-2">
        <div className={`w-64 h-64 rounded-full border-4 border-border bg-surface2 ${loadFailed ? "" : "animate-pulse"}`} />
        {loadFailed && (
          <button onClick={load} className="text-sm text-primary-light underline">
            Couldn&apos;t load the wheel — tap to retry
          </button>
        )}
      </div>
    );
  }

  if (!prizes.length) {
    return <p className="text-sm text-muted text-center py-6">The prize wheel is being set up. Check back soon!</p>;
  }

  const fontSize = prizes.length > 10 ? 7 : prizes.length > 6 ? 9 : 11;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-64 h-64 sm:w-72 sm:h-72">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 w-full h-full drop-shadow-xl"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: `transform ${SPIN_MS}ms cubic-bezier(0.17, 0.67, 0.2, 1)`,
          }}
          role="img"
          aria-label={`Prize wheel: ${prizes.map((p) => p.label).join(", ")}`}
        >
          {prizes.length === 1 ? (
            <circle cx={C} cy={C} r={R} fill={prizes[0].colorHex} />
          ) : (
            prizes.map((p, i) => {
              const start = i * slice;
              const end = start + slice;
              return (
                <path
                  key={p.id}
                  d={`M${C},${C} L${rim(start)} A${R},${R} 0 ${slice > 180 ? 1 : 0} 1 ${rim(end)} Z`}
                  fill={p.colorHex}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="1"
                />
              );
            })
          )}
          {prizes.map((p, i) => (
            <text
              key={p.id}
              x={C}
              y={C - R * 0.68}
              transform={`rotate(${i * slice + slice / 2} ${C} ${C})`}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#fff"
              fontSize={fontSize}
              fontWeight="700"
              style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.55)", strokeWidth: 2 }}
            >
              {p.label.length > 14 ? `${p.label.slice(0, 13)}…` : p.label}
            </text>
          ))}
          <circle cx={C} cy={C} r={R} fill="none" stroke="#f5f5f5" strokeWidth="4" />
          {prizes.map((p, i) => (
            <circle key={p.id} cx={rimXY(i * slice, R - 2)[0]} cy={rimXY(i * slice, R - 2)[1]} r="2" fill="#fff" />
          ))}
        </svg>
        {/* Pointer */}
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[22px] border-t-gold z-10 drop-shadow" />
        {/* Hub */}
        <div className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-surface border-4 border-gold flex items-center justify-center text-xs font-extrabold z-10">
          SPIN
        </div>
      </div>

      <button onClick={handleSpin} disabled={!status.canSpin || spinning} className="btn-primary w-full max-w-xs">
        {spinning ? "Spinning…" : status.canSpin ? "🎡 Spin the Wheel" : `Next spin in ${formatCountdown(status.nextAvailableInSeconds)}`}
      </button>

      {result && <p className="text-sm text-green-400 font-medium text-center">{result}</p>}
      {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      {status.lastSpin && !result && (
        <p className="text-xs text-muted">
          Last spin: {status.lastSpin.prizeLabel} on {new Date(status.lastSpin.createdAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
