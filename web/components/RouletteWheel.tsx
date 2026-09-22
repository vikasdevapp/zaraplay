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

export default function RouletteWheel({ onWin }: { onWin?: () => void }) {
  const api = useApi();
  const [status, setStatus] = useState<Status | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(() => {
    api<Status>("/api/roulette/status")
      .then(setStatus)
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    load();
    return () => clearTimeout(timeoutRef.current);
  }, [load]);

  const prizes = status?.prizes ?? [];
  const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);

  // Segment boundaries (degrees, clockwise from top) in the same order the wheel is drawn.
  const segments = (() => {
    let cursor = 0;
    return prizes.map((p) => {
      const span = totalWeight > 0 ? (p.weight / totalWeight) * 360 : 0;
      const seg = { prize: p, start: cursor, end: cursor + span };
      cursor += span;
      return seg;
    });
  })();

  const gradient =
    segments.length > 0
      ? `conic-gradient(${segments.map((s) => `${s.prize.colorHex} ${s.start}deg ${s.end}deg`).join(", ")})`
      : "#242424";

  async function handleSpin() {
    if (!status?.canSpin || spinning) return;
    setError(null);
    setResult(null);
    setSpinning(true);
    try {
      const res = await api<{ prize: Prize }>("/api/roulette/spin", { method: "POST" });
      const seg = segments.find((s) => s.prize.id === res.prize.id);
      const targetAngle = seg ? seg.start + (seg.end - seg.start) / 2 : 0;
      const extraSpins = 5;
      const delta = extraSpins * 360 + ((360 - targetAngle) % 360);

      setRotation((r) => r + delta);
      timeoutRef.current = setTimeout(() => {
        setSpinning(false);
        setResult(`You won ${res.prize.label}!`);
        load();
        onWin?.();
      }, 4000);
    } catch (err) {
      setSpinning(false);
      setError(err instanceof ApiError ? err.message : "Could not spin right now.");
      load();
    }
  }

  if (!status) return null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-56 h-56">
        <div
          className="absolute inset-0 rounded-full border-4 border-border shadow-lg transition-transform"
          style={{ background: gradient, transform: `rotate(${rotation}deg)`, transitionDuration: "4000ms", transitionTimingFunction: "cubic-bezier(0.17, 0.67, 0.32, 1.01)" }}
        >
          {segments.map((s) => (
            <div
              key={s.prize.id}
              className="absolute inset-0 flex justify-center"
              style={{ transform: `rotate(${(s.start + s.end) / 2}deg)` }}
            >
              <span className="text-[11px] font-bold text-white mt-3" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>
                {s.prize.label}
              </span>
            </div>
          ))}
        </div>
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[16px] border-t-gold z-10" />
        <div className="absolute inset-0 m-auto w-10 h-10 rounded-full bg-surface border-2 border-border" />
      </div>

      <button onClick={handleSpin} disabled={!status.canSpin || spinning} className="btn-primary w-full max-w-xs">
        {spinning ? "Spinning…" : status.canSpin ? "🎡 Spin the Wheel" : `Next spin in ${formatCountdown(status.nextAvailableInSeconds)}`}
      </button>

      {result && <p className="text-sm text-green-400 font-medium">{result}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {status.lastSpin && !result && (
        <p className="text-xs text-muted">Last spin: {status.lastSpin.prizeLabel} on {new Date(status.lastSpin.createdAt).toLocaleDateString()}</p>
      )}
    </div>
  );
}
