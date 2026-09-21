"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";

export interface AuthUser {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: string;
}

export interface SignupStartResult {
  signupToken: string;
  email: string;
  expiresInSeconds: number;
  devEmailPreviewUrl?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  /** Step 1 of signup: validates input and emails a one-time code. No account exists yet. */
  startSignup: (data: { fullName: string; username: string; email: string; password: string; referralCode?: string }) => Promise<SignupStartResult>;
  /** Step 2: confirms the code, creates the account, and logs in. */
  verifySignupOtp: (signupToken: string, otp: string) => Promise<void>;
  resendSignupOtp: (signupToken: string) => Promise<{ expiresInSeconds: number; devEmailPreviewUrl?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "rewardsplay_session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setUser(parsed.user);
        setToken(parsed.token);
      }
    } catch {
      // ignore corrupted local storage
    }
    setLoading(false);
  }, []);

  const persist = useCallback((nextUser: AuthUser, nextToken: string) => {
    setUser(nextUser);
    setToken(nextToken);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: nextUser, token: nextToken }));
  }, []);

  const login = useCallback(
    async (emailOrUsername: string, password: string) => {
      const data = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ emailOrUsername, password }),
      });
      persist(data.user, data.token);
      const dest = ["ADMIN", "MASTER_ADMIN"].includes(data.user.role) ? "/admin" : data.user.role === "AGENT" ? "/agent" : "/dashboard";
      router.push(dest);
    },
    [persist, router]
  );

  const startSignup = useCallback(
    async (data: { fullName: string; username: string; email: string; password: string; referralCode?: string }) => {
      return apiFetch<SignupStartResult>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    []
  );

  const verifySignupOtp = useCallback(
    async (signupToken: string, otp: string) => {
      const res = await apiFetch<{ token: string; user: AuthUser }>("/api/auth/signup/verify", {
        method: "POST",
        body: JSON.stringify({ signupToken, otp }),
      });
      persist(res.user, res.token);
      const dest = ["ADMIN", "MASTER_ADMIN"].includes(res.user.role) ? "/admin" : res.user.role === "AGENT" ? "/agent" : "/dashboard";
      router.push(dest);
    },
    [persist, router]
  );

  const resendSignupOtp = useCallback(async (signupToken: string) => {
    return apiFetch<{ expiresInSeconds: number; devEmailPreviewUrl?: string }>("/api/auth/signup/resend", {
      method: "POST",
      body: JSON.stringify({ signupToken }),
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      if (token) await apiFetch("/api/auth/logout", { method: "POST" }, token);
    } catch {
      // best-effort; clear local session regardless
    } finally {
      setUser(null);
      setToken(null);
      localStorage.removeItem(STORAGE_KEY);
      router.push("/login");
    }
  }, [token, router]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, startSignup, verifySignupOtp, resendSignupOtp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Convenience hook for authenticated API calls that force logout on a device-lock/expired session. */
export function useApi() {
  const { token, logout } = useAuth();
  return useCallback(
    async <T,>(path: string, options: RequestInit = {}) => {
      try {
        return await apiFetch<T>(path, options, token);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await logout();
        }
        throw err;
      }
    },
    [token, logout]
  );
}
