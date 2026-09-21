"use client";

import { useState, FormEvent, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import Logo from "@/components/Logo";

function SignupForm() {
  const { startSignup, verifySignupOtp, resendSignupOtp } = useAuth();
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref") || undefined;

  const [step, setStep] = useState<"details" | "otp">("details");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [signupToken, setSignupToken] = useState("");
  const [devPreviewUrl, setDevPreviewUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await startSignup({ fullName, username, email, password, referralCode });
      setSignupToken(res.signupToken);
      setDevPreviewUrl(res.devEmailPreviewUrl);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifySignupOtp(signupToken, otp);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError(null);
    setInfo(null);
    try {
      const res = await resendSignupOtp(signupToken);
      setDevPreviewUrl(res.devEmailPreviewUrl);
      setInfo("A new code has been sent to your email.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resend code.");
    }
  }

  if (step === "otp") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm card">
          <div className="text-center mb-6 flex flex-col items-center">
            <Logo size="md" />
            <h1 className="text-xl font-bold mt-3">Verify your email</h1>
            <p className="text-sm text-muted">
              We sent a 6-digit code to <span className="text-white">{email}</span>
            </p>
          </div>

          {devPreviewUrl && (
            <div className="bg-surface2 border border-border rounded-lg px-3 py-2 mb-4 text-xs text-muted">
              Email delivery isn't fully configured yet — view the message that was sent:{" "}
              <a href={devPreviewUrl} target="_blank" rel="noreferrer" className="text-primary font-medium underline">
                Open test inbox
              </a>
            </div>
          )}

          <form onSubmit={handleOtpSubmit} className="space-y-3">
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
            {info && <p className="text-sm text-green-400">{info}</p>}
            <button type="submit" className="btn-gold w-full" disabled={submitting || otp.length !== 6}>
              {submitting ? "Verifying…" : "Verify & Create Account"}
            </button>
          </form>

          <div className="flex items-center justify-between mt-4 text-sm">
            <button onClick={() => setStep("details")} className="text-muted hover:text-white">
              ← Back
            </button>
            <button onClick={handleResend} className="text-primary font-medium">
              Resend code
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-6 flex flex-col items-center">
          <Logo size="md" />
          <h1 className="text-xl font-bold mt-3">Create your account</h1>
          <p className="text-sm text-muted">
            {referralCode ? `Signing up with referral code ${referralCode}` : "Join Zara Plays"}
          </p>
        </div>

        <form onSubmit={handleDetailsSubmit} className="space-y-3">
          <input className="input" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <input
            className="input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            pattern="[a-zA-Z0-9_]{4,24}"
            title="4-24 letters, numbers or underscores"
          />
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            className="input"
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="btn-gold w-full" disabled={submitting}>
            {submitting ? "Sending code…" : "Sign up"}
          </button>
          <p className="text-xs text-muted text-center">We'll email you a 6-digit code to verify your address.</p>
        </form>

        <p className="text-sm text-muted text-center mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
