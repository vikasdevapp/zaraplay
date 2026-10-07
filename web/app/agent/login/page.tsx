"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { useAuth, LoginExtra } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

type LoginAs = NonNullable<LoginExtra["loginAs"]>;

const ROLES: { value: LoginAs; label: string; field: string; placeholder: string }[] = [
  { value: "STAFF", label: "Staff", field: "Staff Name", placeholder: "staff username" },
  { value: "ADMIN", label: "Admin (Group)", field: "Group Name", placeholder: "admin username" },
  { value: "MASTER_ADMIN", label: "Master Admin", field: "Master Admin ID", placeholder: "master admin username" },
];

const DESK_ROLES = ["AGENT", "SUPPORT", "ADMIN", "MASTER_ADMIN"];

export default function AgentLoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [loginAs, setLoginAs] = useState<LoginAs>("STAFF");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"credentials" | "code">("credentials");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in as staff: straight to the desk.
  useEffect(() => {
    if (!loading && user && DESK_ROLES.includes(user.role)) router.replace("/agent");
  }, [loading, user, router]);

  const role = ROLES.find((r) => r.value === loginAs)!;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (step === "code" && !/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    try {
      await login(name.trim(), password, { loginAs, ...(step === "code" ? { totp: code.trim() } : {}) });
    } catch (err) {
      if (err instanceof ApiError && err.data?.needs2fa) {
        // Password was right; this account also needs its authenticator code.
        if (step === "code") setError(err.message);
        setStep("code");
        setCode("");
      } else {
        setError(err instanceof ApiError ? err.message : "Sign in failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid md:grid-cols-2 rounded-2xl overflow-hidden border border-border shadow-2xl">
        {/* Brand panel */}
        <div className="relative bg-gradient-to-br from-[#1a0505] via-black to-black p-8 md:p-10 flex flex-col justify-between min-h-[260px] md:min-h-[560px]">
          <div>
            <Logo size="md" full />
            <h1 className="font-display text-3xl md:text-4xl font-bold mt-8 leading-tight">
              Agent Desk
              <br />
              <span className="text-primary">secure staff access</span>
            </h1>
            <p className="text-sm text-muted mt-4 max-w-sm">
              Sign in with the role you were given. Accounts with two-factor on also need the current code from their authenticator app.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-8">
            <div className="rounded-xl border border-border bg-surface/60 p-4">
              <p className="text-xs text-muted">Session</p>
              <p className="font-semibold text-sm">Role locked</p>
            </div>
            <div className="rounded-xl border border-border bg-surface/60 p-4">
              <p className="text-xs text-muted">2FA</p>
              <p className="font-semibold text-sm">TOTP secured</p>
            </div>
          </div>
          <div aria-hidden className="absolute -right-24 -top-24 w-72 h-72 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        </div>

        {/* Form panel */}
        <div className="bg-surface p-8 md:p-10">
          <p className="text-sm text-primary font-medium">Zara Plays</p>
          <h2 className="text-2xl font-bold mt-1">Sign in</h2>
          <p className="text-sm text-muted mt-1 mb-6">Choose your role and complete the required secure check.</p>

          <div className="grid grid-cols-2 rounded-xl bg-surface2 p-1 mb-6 text-sm font-medium">
            <div className={`text-center py-2 rounded-lg ${step === "credentials" ? "bg-black text-white" : "text-muted"}`}>Credentials</div>
            <div className={`text-center py-2 rounded-lg ${step === "code" ? "bg-black text-white" : "text-muted"}`}>2FA Code</div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {step === "credentials" ? (
              <>
                <label className="block text-sm">
                  Login As
                  <select className="input mt-1" value={loginAs} onChange={(e) => setLoginAs(e.target.value as LoginAs)}>
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  {role.field}
                  <input className="input mt-1" placeholder={role.placeholder} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required autoFocus />
                </label>
                <label className="block text-sm">
                  Password
                  <input className="input mt-1" type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Signing in as <span className="text-white">{role.label}</span> · <span className="text-white">{name}</span>
                </p>
                <label className="block text-sm">
                  6-digit code from your authenticator app
                  <input
                    className="input mt-1 text-center text-2xl tracking-[0.5em] font-mono"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="••••••"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    autoFocus
                  />
                </label>
                <button
                  type="button"
                  className="text-xs text-muted underline"
                  onClick={() => {
                    setStep("credentials");
                    setError(null);
                  }}
                >
                  ← Back
                </button>
              </>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
              {busy ? "Checking…" : step === "code" ? "Verify & Continue" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
