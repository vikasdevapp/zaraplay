"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Prize {
  id: string;
  label: string;
  amount: string;
  weight: number;
  colorHex: string;
  sortOrder: number;
  isActive: boolean;
}

interface Spin {
  id: string;
  prizeLabel: string;
  amount: string;
  createdAt: string;
  user: { id: string; fullName: string; username: string };
}

export default function AdminRoulettePage() {
  const api = useApi();
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [spins, setSpins] = useState<Spin[]>([]);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("0");
  const [weight, setWeight] = useState("10");
  const [colorHex, setColorHex] = useState("#8b5cf6");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([
      api<{ prizes: Prize[] }>("/api/admin/roulette/prizes"),
      api<{ spins: Spin[] }>("/api/admin/roulette/spins"),
    ]);
    setPrizes(p.prizes);
    setSpins(s.spins);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const totalWeight = prizes.filter((p) => p.isActive).reduce((sum, p) => sum + p.weight, 0);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/admin/roulette/prizes", {
        method: "POST",
        body: JSON.stringify({ label, amount: Number(amount), weight: Number(weight), colorHex, sortOrder: prizes.length }),
      });
      setLabel("");
      setAmount("0");
      setWeight("10");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add prize.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(prize: Prize) {
    await api(`/api/admin/roulette/prizes/${prize.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !prize.isActive }) });
    await load();
  }

  async function remove(prize: Prize) {
    await api(`/api/admin/roulette/prizes/${prize.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Roulette Wheel</h1>
      <p className="text-muted text-sm mb-4">
        Weight sets relative odds — a prize with weight 30 is 3x as likely as one with weight 10. Players get one
        spin per day, enforced server-side.
      </p>

      <form onSubmit={handleCreate} className="card mb-6 space-y-3">
        <h2 className="font-bold">Add Prize</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input className="input" placeholder="Label (e.g. $2 or No Reward)" value={label} onChange={(e) => setLabel(e.target.value)} required />
          <input className="input" type="number" step="0.01" placeholder="Cash amount ($, 0 = no reward)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" type="number" placeholder="Weight (odds)" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <input className="input" type="color" value={colorHex} onChange={(e) => setColorHex(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Adding…" : "+ Add Prize"}
        </button>
      </form>

      <div className="space-y-3 mb-8">
        {prizes.map((p) => (
          <div key={p.id} className="card flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full shrink-0" style={{ backgroundColor: p.colorHex }} />
              <div>
                <p className="font-bold">{p.label}</p>
                <p className="text-xs text-muted">
                  ${Number(p.amount).toFixed(2)} · weight {p.weight}
                  {p.isActive && totalWeight > 0 ? ` (${((p.weight / totalWeight) * 100).toFixed(0)}% odds)` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${p.isActive ? "bg-green-500/20 text-green-400" : "bg-surface2 text-muted"}`}>
                {p.isActive ? "Active" : "Inactive"}
              </span>
              <button onClick={() => toggleActive(p)} className="btn-ghost text-xs py-1.5 px-3">
                {p.isActive ? "Deactivate" : "Activate"}
              </button>
              <button onClick={() => remove(p)} className="text-xs py-1.5 px-3 rounded-xl text-red-400 hover:bg-red-500/10">
                Delete
              </button>
            </div>
          </div>
        ))}
        {prizes.length === 0 && <p className="text-muted text-sm text-center py-8">No prizes configured yet.</p>}
      </div>

      <div className="card">
        <h2 className="font-bold mb-3">Recent Spins</h2>
        <div className="divide-y divide-border">
          {spins.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {s.user.fullName} <span className="text-muted">@{s.user.username}</span>
              </span>
              <span className="text-muted">
                {s.prizeLabel} · {new Date(s.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
          {spins.length === 0 && <p className="text-muted text-sm">No spins yet.</p>}
        </div>
      </div>
    </AdminShell>
  );
}
