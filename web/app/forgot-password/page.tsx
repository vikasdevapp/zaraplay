"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { apiFetch, ApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<"request" | "reset">("request");
  const [identifier, setIdentifier] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  async function handleRequestOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSubmitting(true);

    try {
      const res = await apiFetch<{
        resetToken?: string;
        message: string;
        devOtpPreview?: string;
      }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ identifier }),
      });

      if (res.resetToken) {
        setResetToken(res.resetToken);
        setStep("reset");
      }
      if (res.devOtpPreview) {
        setDevOtp(res.devOtpPreview);
      }
      setMessage(res.message || "OTP sent to your email or phone number.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send OTP.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await apiFetch<{ message: string }>("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ resetToken, otp, newPassword }),
      });

      setMessage(res.message);
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Password reset failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-6 flex flex-col items-center">
          <Logo size="md" />
          <h1 className="text-xl font-bold mt-3">Forgot Password</h1>
          <p className="text-sm text-muted">
            {step === "request"
              ? "Reset your password via Email or Phone Number"
              : "Enter OTP code and new password"}
          </p>
        </div>

        {step === "request" ? (
          <form onSubmit={handleRequestOtp} className="space-y-3">
            <div>
              <label className="text-xs text-muted">Email, Phone number, or Username</label>
              <input
                className="input mt-1"
                placeholder="Enter email or phone"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && <p className="text-sm text-green-400">{message}</p>}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? "Sending OTP…" : "Send Reset Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-3">
            {devOtp && (
              <div className="bg-surface2 border border-gold/40 p-2 rounded text-xs text-gold">
                Dev OTP Preview: <strong>{devOtp}</strong>
              </div>
            )}
            <div>
              <label className="text-xs text-muted">6-Digit OTP Code</label>
              <input
                className="input mt-1"
                placeholder="123456"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted">New Password</label>
              <input
                className="input mt-1"
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted">Confirm New Password</label>
              <input
                className="input mt-1"
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && <p className="text-sm text-green-400">{message}</p>}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? "Resetting Password…" : "Update Password"}
            </button>
          </form>
        )}

        <div className="text-sm text-muted text-center mt-4">
          Remembered your password?{" "}
          <Link href="/login" className="text-primary font-medium">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
