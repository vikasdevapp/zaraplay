"use client";

import { useState, FormEvent, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import Logo from "@/components/Logo";

function SignupForm() {
  const { startSignup } = useAuth();
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref") || undefined;

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await startSignup({ fullName, username, email, password, referralCode });
      // startSignup signs the user in and redirects on success.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed.");
      setSubmitting(false);
    }
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

        <div className="bg-primary/10 border border-primary/40 rounded-xl px-3 py-2 mb-4 text-center">
          <p className="text-sm font-semibold text-primary">🎉 Get 100% match bonus on your first deposit!</p>
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
            {submitting ? "Creating account…" : "Sign up"}
          </button>
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
