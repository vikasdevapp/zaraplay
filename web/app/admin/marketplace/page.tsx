"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Item {
  id: string;
  name: string;
  category: string;
  fpCost: string;
  cashValue: string;
  sortOrder: number;
  isActive: boolean;
}

export default function AdminMarketplacePage() {
  const api = useApi();
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Starter");
  const [fpCost, setFpCost] = useState("");
  const [cashValue, setCashValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ items: Item[] }>("/api/admin/marketplace");
    setItems(res.items);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/admin/marketplace", {
        method: "POST",
        body: JSON.stringify({ name, category, fpCost: Number(fpCost), cashValue: Number(cashValue), sortOrder: items.length }),
      });
      setName("");
      setFpCost("");
      setCashValue("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create item.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(item: Item) {
    await api(`/api/admin/marketplace/${item.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !item.isActive }) });
    await load();
  }

  async function remove(item: Item) {
    await api(`/api/admin/marketplace/${item.id}`, { method: "DELETE" });
    await load();
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Marketplace</h1>
      <p className="text-muted text-sm mb-4">
        Free-play → cash redemption catalog. Redemptions are instant — free play is spent and the cash value is
        credited straight to the player's balance, no approval needed.
      </p>

      <form onSubmit={handleCreate} className="card mb-6 space-y-3">
        <h2 className="font-bold">Add Item</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className="input" type="number" placeholder="FP cost" value={fpCost} onChange={(e) => setFpCost(e.target.value)} required />
          <input className="input" type="number" placeholder="Cash value ($)" value={cashValue} onChange={(e) => setCashValue(e.target.value)} required />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Adding…" : "+ Add Item"}
        </button>
      </form>

      <div className="card p-0 divide-y divide-border">
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium">{it.name}</p>
              <p className="text-xs text-muted">
                {it.category} · {Number(it.fpCost).toFixed(0)} FP → ${Number(it.cashValue).toFixed(2)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded ${it.isActive ? "bg-green-500/20 text-green-400" : "bg-surface2 text-muted"}`}>
                {it.isActive ? "Active" : "Inactive"}
              </span>
              <button onClick={() => toggleActive(it)} className="btn-ghost text-xs py-1.5 px-3">
                {it.isActive ? "Deactivate" : "Activate"}
              </button>
              <button onClick={() => remove(it)} className="text-xs py-1.5 px-3 rounded-xl text-red-400 hover:bg-red-500/10">
                Delete
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-muted text-sm text-center py-8">No items yet.</p>}
      </div>
    </AdminShell>
  );
}
