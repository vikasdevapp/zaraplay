"use client";

import { useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Provider {
  key: string;
  label: string;
  style: string;
  idLabel: string;
  secretLabel: string;
  showDivisor: boolean;
  baseUrl: string;
  agentId: string;
  hasSecret: boolean;
  balanceDivisor: number;
  configured: boolean;
  source: "panel" | "server" | "none";
}

function ProviderCard({ p, onSaved }: { p: Provider; onSaved: () => Promise<void> }) {
  const api = useApi();
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [agentId, setAgentId] = useState(p.agentId);
  const [secret, setSecret] = useState("");
  const [divisor, setDivisor] = useState(String(p.balanceDivisor || 1));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/admin/platforms/${p.key}`, {
        method: "PUT",
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          agentId: agentId.trim(),
          ...(secret ? { secret } : {}),
          ...(p.showDivisor ? { balanceDivisor: Number(divisor) || 1 } : {}),
        }),
      });
      setSecret("");
      setMsg({ type: "ok", text: "Saved." });
      await onSaved();
    } catch (e) {
      setMsg({ type: "err", text: e instanceof ApiError ? e.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api<{ agentBalance?: number; note?: string }>(`/api/admin/platforms/${p.key}/test`, { method: "POST" });
      setMsg({ type: "ok", text: res.note ? res.note : `✓ Connected · agent balance $${Number(res.agentBalance ?? 0).toFixed(2)}` });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof ApiError ? e.message : "Connection failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">{p.label}</h2>
        <span
          className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
            p.configured ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-500/20 text-slate-300"
          }`}
        >
          {p.configured ? (p.source === "panel" ? "Configured" : "From server") : "Not set"}
        </span>
      </div>

      <label className="text-xs text-muted block">
        Base URL
        <input className="input mt-1" placeholder="https://…" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-muted block">
          {p.idLabel}
          <input className="input mt-1" value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </label>
        <label className="text-xs text-muted block">
          {p.secretLabel}
          <input
            className="input mt-1"
            type="password"
            placeholder={p.hasSecret ? "•••••• (leave blank to keep)" : "Enter " + p.secretLabel.toLowerCase()}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
          />
        </label>
      </div>
      {p.showDivisor && (
        <label className="text-xs text-muted block sm:w-40">
          Balance divisor
          <input className="input mt-1" type="number" step="0.0001" value={divisor} onChange={(e) => setDivisor(e.target.value)} />
        </label>
      )}

      {msg && <p className={`text-sm ${msg.type === "err" ? "text-red-400" : "text-green-400"}`}>{msg.text}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm px-4 py-2">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={test} disabled={busy || !p.configured} className="btn-ghost text-sm px-4 py-2">
          Test connection
        </button>
      </div>
    </div>
  );
}

export default function AdminPlatformsPage() {
  const api = useApi();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [encryptionReady, setEncryptionReady] = useState(true);

  const load = useCallback(async () => {
    const res = await api<{ providers: Provider[]; encryptionReady: boolean }>("/api/admin/platforms");
    setProviders(res.providers);
    setEncryptionReady(res.encryptionReady);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-2">Game Platforms</h1>
      <p className="text-sm text-muted mb-6">
        Credentials for each game&apos;s agent API. Secrets/passwords are encrypted and never shown again — leave the field
        blank to keep the current one. Assign a platform to a game under Admin → Games.
      </p>

      {!encryptionReady && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
          Secret encryption isn&apos;t configured on the server (PAYOUT_ENCRYPTION_KEY), so saving a secret/password will be refused.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {providers.map((p) => (
          <ProviderCard key={p.key} p={p} onSaved={load} />
        ))}
      </div>
    </AdminShell>
  );
}
