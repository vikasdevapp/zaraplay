"use client";

import { useCallback, useEffect, useState, FormEvent } from "react";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Setup {
  qrDataUrl: string;
  secret: string;
  otpauthUrl: string;
}

/** Turn authenticator-app two-factor on or off for the signed-in staff member. */
export default function TwoFactorSettings() {
  const api = useApi();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ enabled: boolean }>("/api/auth/2fa");
    setEnabled(r.enabled);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  const startSetup = () =>
    run(async () => {
      setSetup(await api<Setup>("/api/auth/2fa/setup", { method: "POST" }));
      setCode("");
    });

  const enable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api("/api/auth/2fa/enable", { method: "POST", body: JSON.stringify({ code: code.trim() }) });
      setSetup(null);
      setCode("");
      setEnabled(true);
      setMsg({ ok: true, text: "Two-factor is on. You'll need a code from your app every time you sign in." });
    });
  };

  const disable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password, code: code.trim() }) });
      setPassword("");
      setCode("");
      setEnabled(false);
      setMsg({ ok: true, text: "Two-factor is off." });
    });
  };

  if (enabled === null) return <p className="text-muted text-sm">Loading…</p>;

  return (
    <div className="card max-w-lg space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-bold">Authenticator app</p>
        <span className={`text-xs px-2 py-1 rounded ${enabled ? "bg-green-500/20 text-green-400" : "bg-surface2 text-muted"}`}>{enabled ? "ON" : "OFF"}</span>
      </div>

      {!enabled && !setup && (
        <>
          <p className="text-sm text-muted">
            Adds a second step to sign-in: after your password you enter the 6-digit code from an authenticator app (Google Authenticator, Microsoft
            Authenticator, Authy…). Someone with only your password can&apos;t get in.
          </p>
          <button className="btn-primary" disabled={busy} onClick={startSetup}>
            Set up two-factor
          </button>
        </>
      )}

      {!enabled && setup && (
        <form onSubmit={enable} className="space-y-3">
          <ol className="text-sm text-muted list-decimal pl-5 space-y-1">
            <li>Open your authenticator app and add an account by scanning this QR code.</li>
            <li>Enter the 6-digit code it shows to confirm.</li>
          </ol>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="Two-factor QR code" width={180} height={180} className="rounded-lg bg-white p-2" />
            <div className="text-xs text-muted space-y-1 min-w-0">
              <p>Can&apos;t scan? Enter this key in the app:</p>
              <p className="font-mono text-sm text-white break-all select-all">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
              <p>Type: time-based · 6 digits · 30 seconds</p>
            </div>
          </div>
          <input
            className="input text-center text-xl tracking-[0.4em] font-mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
          />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy || code.length !== 6}>
              Turn on
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setSetup(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {enabled && (
        <form onSubmit={disable} className="space-y-3">
          <p className="text-sm text-muted">To turn two-factor off, confirm your password and a current code from your app.</p>
          <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <input
            className="input text-center tracking-[0.4em] font-mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
          />
          <button className="btn-ghost text-red-400" disabled={busy || code.length !== 6}>
            Turn off two-factor
          </button>
        </form>
      )}

      {msg && <p className={`text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.text}</p>}
      <p className="text-xs text-muted">Lost your phone? Ask an admin to reset your password from Agent Team / Support Team — that also turns two-factor off so you can set it up again.</p>
    </div>
  );
}
