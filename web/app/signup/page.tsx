"use client";

import { useState, FormEvent, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import Logo from "@/components/Logo";

function SignupForm() {
  const { signupStart, signupVerify } = useAuth();
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref") || undefined;

  const [step, setStep] = useState<"details" | "otp">("details");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await signupStart({ fullName, username, email, password, referralCode });
      setSentEmail(res.email);
      setDevCode(res.devCode);
      setStep("otp");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signupVerify(sentEmail, otp);
      // signupVerify creates the account, signs the user in and redirects on success.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
      setSubmitting(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      const res = await signupStart({ fullName, username, email, password, referralCode });
      setSentEmail(res.email);
      setDevCode(res.devCode);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resend the code.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-6 flex flex-col items-center">
          <Logo size="md" full />
          <h1 className="text-xl font-bold mt-3">Create your account</h1>
          <p className="text-sm text-muted">
            {referralCode ? `Signing up with referral code ${referralCode}` : "Join Zara Plays"}
          </p>
        </div>

        <div className="bg-primary/10 border border-primary/40 rounded-xl px-3 py-2 mb-4 text-center">
          <p className="text-sm font-semibold text-primary">🎉 Get 100% match bonus on your first deposit!</p>
        </div>

        {step === "details" ? (
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
              {submitting ? "Sending code…" : "Send verification code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-3">
            <p className="text-sm text-muted text-center">
              Enter the 6-digit code we emailed to <span className="text-white font-medium">{sentEmail}</span>.
            </p>
            {devCode && <p className="text-xs text-center text-yellow-400">Dev code: {devCode}</p>}
            <input
              className="input text-center tracking-[0.5em] text-lg"
              inputMode="numeric"
              maxLength={6}
              placeholder="______"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              required
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" className="btn-gold w-full" disabled={submitting || otp.length !== 6}>
              {submitting ? "Verifying…" : "Verify & create account"}
            </button>
            <div className="flex justify-between text-sm">
              <button type="button" onClick={() => { setStep("details"); setOtp(""); setError(null); }} className="text-muted">
                ← Edit details
              </button>
              <button type="button" onClick={resend} className="text-primary font-medium">
                Resend code
              </button>
            </div>
          </form>
        )}

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
