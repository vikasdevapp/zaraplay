"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, apiUpload as rawApiUpload, ApiError } from "@/lib/api";

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

interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  /** Step 1 of signup: validates input and emails a one-time code. No account exists yet. */
  startSignup: (data: { fullName: string; username: string; email: string; password: string; referralCode?: string }) => Promise<SignupStartResult>;
  /** Step 2: confirms the code, creates the account, and logs in. */
  verifySignupOtp: (signupToken: string, otp: string) => Promise<void>;
  resendSignupOtp: (signupToken: string) => Promise<{ expiresInSeconds: number; devEmailPreviewUrl?: string }>;
  logout: () => Promise<void>;
  /** Exchanges the refresh token for a new pair. Concurrent callers share one in-flight call. */
  refresh: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "rewardsplay_session";

function destinationFor(role: string) {
  if (["ADMIN", "MASTER_ADMIN"].includes(role)) return "/admin";
  if (role === "AGENT") return "/agent";
  return "/dashboard";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AuthPayload;
        setUser(parsed.user);
        setAccessToken(parsed.accessToken);
        setRefreshToken(parsed.refreshToken);
      }
    } catch {
      // ignore corrupted local storage
    }
    setLoading(false);
  }, []);

  const persist = useCallback((data: AuthPayload) => {
    setUser(data.user);
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const login = useCallback(
    async (emailOrUsername: string, password: string) => {
      const data = await apiFetch<AuthPayload>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ emailOrUsername, password }),
      });
      persist(data);
      router.push(destinationFor(data.user.role));
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
      const data = await apiFetch<AuthPayload>("/api/auth/signup/verify", {
        method: "POST",
        body: JSON.stringify({ signupToken, otp }),
      });
      persist(data);
      router.push(destinationFor(data.user.role));
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
      if (accessToken) await apiFetch("/api/auth/logout", { method: "POST" }, accessToken);
    } catch {
      // best-effort; clear local session regardless
    } finally {
      clearAuth();
      router.push("/login");
    }
  }, [accessToken, clearAuth, router]);

  // Concurrent 401s (several in-flight requests when the access token expires) share one
  // refresh call instead of each racing to rotate the refresh token themselves.
  const refresh = useCallback((): Promise<string | null> => {
    if (!refreshToken) return Promise.resolve(null);
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = apiFetch<AuthPayload>("/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      })
        .then((data) => {
          persist(data);
          return data.accessToken;
        })
        .catch(() => {
          clearAuth();
          return null;
        })
        .finally(() => {
          refreshPromiseRef.current = null;
        });
    }
    return refreshPromiseRef.current;
  }, [refreshToken, persist, clearAuth]);

  return (
    <AuthContext.Provider
      value={{ user, accessToken, loading, login, startSignup, verifySignupOtp, resendSignupOtp, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Authenticated fetch that transparently refreshes an expired access token once, then logs out if that also fails. */
export function useApi() {
  const { accessToken, refresh, logout } = useAuth();
  return useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      try {
        return await apiFetch<T>(path, options, accessToken);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const newToken = await refresh();
          if (newToken) {
            try {
              return await apiFetch<T>(path, options, newToken);
            } catch (retryErr) {
              if (retryErr instanceof ApiError && retryErr.status === 401) await logout();
              throw retryErr;
            }
          }
          await logout();
        }
        throw err;
      }
    },
    [accessToken, refresh, logout]
  );
}

/** Same transparent-refresh behavior as useApi, for multipart file uploads. */
export function useApiUpload() {
  const { accessToken, refresh, logout } = useAuth();
  return useCallback(
    async <T,>(path: string, file: File, fieldName: string): Promise<T> => {
      try {
        return await rawApiUpload<T>(path, file, fieldName, accessToken);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          const newToken = await refresh();
          if (newToken) {
            try {
              return await rawApiUpload<T>(path, file, fieldName, newToken);
            } catch (retryErr) {
              if (retryErr instanceof ApiError && retryErr.status === 401) await logout();
              throw retryErr;
            }
          }
          await logout();
        }
        throw err;
      }
    },
    [accessToken, refresh, logout]
  );
}
