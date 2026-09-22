"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

export default function VerifyPhonePage() {
  const api = useApi();
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp" | "done">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [bonus, setBonus] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePhoneSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<{ devCode?: string }>("/api/phone/start", { method: "POST", body: JSON.stringify({ phone }) });
      setDevCode(res.devCode);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<{ bonusGranted: number }>("/api/phone/verify", { method: "POST", body: JSON.stringify({ otp }) });
      setBonus(res.bonusGranted);
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="max-w-sm mx-auto">
        <div className="card">
          <h1 className="text-xl font-bold mb-1">📱 Verify your number</h1>
          <p className="text-sm text-muted mb-4">Get free play credited after verification.</p>

          {step === "phone" && (
            <form onSubmit={handlePhoneSubmit} className="space-y-3">
              <input
                className="input"
                type="tel"
                placeholder="+1 555 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button type="submit" className="btn-gold w-full" disabled={submitting}>
                {submitting ? "Sending…" : "Send Code"}
              </button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleOtpSubmit} className="space-y-3">
              <p className="text-sm text-muted">
                Enter the 6-digit code sent to <span className="text-white">{phone}</span>
              </p>
              {devCode && (
                <div className="bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-muted">
                  SMS delivery isn&apos;t fully configured yet — your code is <span className="text-white font-mono">{devCode}</span>
                </div>
              )}
              <input
                className="input text-center text-2xl tracking-[0.5em]"
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                required
                autoFocus
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button type="submit" className="btn-gold w-full" disabled={submitting || otp.length !== 6}>
                {submitting ? "Verifying…" : "Verify"}
              </button>
              <button type="button" onClick={() => setStep("phone")} className="text-sm text-muted hover:text-white w-full text-center">
                ← Change number
              </button>
            </form>
          )}

          {step === "done" && (
            <div className="text-center space-y-3">
              <p className="text-4xl">✅</p>
              <p className="font-semibold">Phone verified!</p>
              {bonus > 0 && <p className="text-sm text-primary">+{bonus.toFixed(0)} FP credited to your wallet.</p>}
              <button onClick={() => router.push("/dashboard")} className="btn-primary w-full">
                Back to Home
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
