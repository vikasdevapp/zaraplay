"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const { login } = useAuth();
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(emailOrUsername, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm card">
        <div className="text-center mb-6 flex flex-col items-center">
          <Logo size="md" />
          <h1 className="text-xl font-bold mt-3">Welcome back</h1>
          <p className="text-sm text-muted">Log in to Zara Plays</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            className="input"
            placeholder="Email or username"
            value={emailOrUsername}
            onChange={(e) => setEmailOrUsername(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="text-sm text-muted text-center mt-4">
          New here?{" "}
          <Link href="/signup" className="text-primary font-medium">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
