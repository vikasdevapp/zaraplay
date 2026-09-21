"use client";

import { useEffect, useState, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Settings {
  minDeposit: string;
  maxDeposit: string;
  minWithdrawal: string;
  maxWithdrawal: string;
  signupBonusPercent: string;
  weekendBonusPercent: string;
  regularBonusPercent: string;
  referralBonusPercent: string;
  freeplaySignupGrant: string;
  freeplayCashoutCap: string;
  cashoutTierBoundary: string;
  cashoutTier1MinMultiplier: string;
  cashoutTier1MaxMultiplier: string;
  cashoutTier2MinMultiplier: string;
  ipSignupMaxPerDay: number;
  ipBlockMessage: string;
}

const FIELDS: { key: keyof Settings; label: string; step?: string }[] = [
  { key: "minDeposit", label: "Min Deposit ($)" },
  { key: "maxDeposit", label: "Max Deposit ($)" },
  { key: "minWithdrawal", label: "Min Withdrawal ($)" },
  { key: "maxWithdrawal", label: "Max Withdrawal ($)" },
  { key: "signupBonusPercent", label: "First Deposit Bonus (%)" },
  { key: "weekendBonusPercent", label: "Tuesday Bonus (%)" },
  { key: "regularBonusPercent", label: "Regular Deposit Bonus (%)" },
  { key: "referralBonusPercent", label: "Referral Bonus (%)" },
  { key: "freeplaySignupGrant", label: "Signup Free Play ($)" },
  { key: "freeplayCashoutCap", label: "Free Play Cashout Cap ($)" },
  { key: "cashoutTierBoundary", label: "Cashout Tier Boundary ($)" },
  { key: "cashoutTier1MinMultiplier", label: "Tier 1 Min Multiplier (x)" },
  { key: "cashoutTier1MaxMultiplier", label: "Tier 1 Max Multiplier (x)" },
  { key: "cashoutTier2MinMultiplier", label: "Tier 2 Min Multiplier (x)" },
];

export default function AdminPlatformRulesPage() {
  const api = useApi();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: Settings }>("/api/admin/settings")
      .then((res) => {
        setSettings(res.settings);
        const f: Record<string, string> = {};
        for (const field of FIELDS) f[field.key] = String(res.settings[field.key]);
        f.ipSignupMaxPerDay = String(res.settings.ipSignupMaxPerDay);
        f.ipBlockMessage = res.settings.ipBlockMessage;
        setForm(f);
      })
      .catch(() => {});
  }, [api]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const payload: Record<string, number | string> = {};
      for (const field of FIELDS) payload[field.key] = Number(form[field.key]);
      payload.ipSignupMaxPerDay = Number(form.ipSignupMaxPerDay);
      payload.ipBlockMessage = form.ipBlockMessage;

      const res = await api<{ settings: Settings }>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setSettings(res.settings);
      setMessage({ type: "success", text: "Platform rules saved." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Save failed." });
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <AdminShell>
        <p className="text-muted">Loading…</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-1">Platform Rules</h1>
      <p className="text-muted text-sm mb-6">
        Cashout, freeplay, bonus, referral and deposit/withdrawal rules — read live by the wallet API on every
        deposit and cashout, no restart needed.
      </p>

      <form onSubmit={handleSave} className="card space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-muted">{f.label}</label>
              <input
                className="input mt-1"
                type="number"
                step="0.01"
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-4">
          <h2 className="font-bold mb-3">IP Security</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted">Max Signups Per IP Per 24h (0 = unlimited)</label>
              <input
                className="input mt-1"
                type="number"
                value={form.ipSignupMaxPerDay ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, ipSignupMaxPerDay: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted">Block Message (use {"{max}"} as a placeholder)</label>
              <input
                className="input mt-1"
                value={form.ipBlockMessage ?? ""}
                onChange={(e) => setForm((s) => ({ ...s, ipBlockMessage: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {message && <p className={`text-sm ${message.type === "error" ? "text-red-400" : "text-green-400"}`}>{message.text}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save Platform Rules"}
        </button>
      </form>
    </AdminShell>
  );
}
