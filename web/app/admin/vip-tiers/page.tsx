"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Tier {
  id: string;
  name: string;
  emoji: string;
  colorHex: string;
  minDeposit: string;
  minReferrals: number;
  perks: string[];
  sortOrder: number;
  isActive: boolean;
}

export default function AdminVipTiersPage() {
  const api = useApi();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("⭐");
  const [minDeposit, setMinDeposit] = useState("0");
  const [minReferrals, setMinReferrals] = useState("0");
  const [perks, setPerks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ tiers: Tier[] }>("/api/admin/vip-tiers");
    setTiers(res.tiers);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/admin/vip-tiers", {
        method: "POST",
        body: JSON.stringify({
          name,
          emoji,
          minDeposit: Number(minDeposit),
          minReferrals: Number(minReferrals),
          perks: perks.split("\n").map((p) => p.trim()).filter(Boolean),
          sortOrder: tiers.length,
        }),
      });
      setName("");
      setEmoji("⭐");
      setMinDeposit("0");
      setMinReferrals("0");
      setPerks("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create tier.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(tier: Tier) {
    await api(`/api/admin/vip-tiers/${tier.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !tier.isActive }) });
    await load();
  }

  async function remove(tier: Tier) {
    await api(`/api/admin/vip-tiers/${tier.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">VIP Tiers</h1>
      <p className="text-muted text-sm mb-4">Players qualify for a tier once they meet both its deposit and referral thresholds.</p>

      <form onSubmit={handleCreate} className="card mb-6 space-y-3">
        <h2 className="font-bold">Add Tier</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" placeholder="Emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} />
          <input className="input" type="number" placeholder="Min deposit ($)" value={minDeposit} onChange={(e) => setMinDeposit(e.target.value)} />
          <input className="input" type="number" placeholder="Min referrals" value={minReferrals} onChange={(e) => setMinReferrals(e.target.value)} />
        </div>
        <textarea className="input min-h-[70px]" placeholder="Perks, one per line" value={perks} onChange={(e) => setPerks(e.target.value)} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Adding…" : "+ Add Tier"}
        </button>
      </form>

      <div className="space-y-3">
        {tiers.map((t) => (
          <div key={t.id} className="card flex items-center justify-between">
            <div>
              <p className="font-bold" style={{ color: t.colorHex }}>
                {t.emoji} {t.name}
              </p>
              <p className="text-xs text-muted">
                ${Number(t.minDeposit).toFixed(2)} deposit · {t.minReferrals} referrals
              </p>
              {t.perks.length > 0 && <p className="text-xs text-muted mt-1">{t.perks.join(" · ")}</p>}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${t.isActive ? "bg-green-500/20 text-green-400" : "bg-surface2 text-muted"}`}>
                {t.isActive ? "Active" : "Inactive"}
              </span>
              <button onClick={() => toggleActive(t)} className="btn-ghost text-xs py-1.5 px-3">
                {t.isActive ? "Deactivate" : "Activate"}
              </button>
              <button onClick={() => remove(t)} className="text-xs py-1.5 px-3 rounded-xl text-red-400 hover:bg-red-500/10">
                Delete
              </button>
            </div>
          </div>
        ))}
        {tiers.length === 0 && <p className="text-muted text-sm text-center py-8">No VIP tiers yet.</p>}
      </div>
    </AdminShell>
  );
}
