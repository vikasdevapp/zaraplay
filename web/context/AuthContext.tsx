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
  /** Resolves once the stored session has been read from localStorage. */
  ready: Promise<void>;
  /** Current access token, read at call time (not from a render's closure). */
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "rewardsplay_session";

function readStoredSession(): AuthPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthPayload) : null;
  } catch {
    return null; // corrupted or blocked storage
  }
}

function destinationFor(role: string) {
  if (["ADMIN", "MASTER_ADMIN"].includes(role)) return "/admin";
  if (role === "AGENT") return "/agent";
  return "/dashboard";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);
  // Child effects run before this provider's effect, so on a full page load (e.g. coming back
  // from the payment cashier) pages fire requests before the session is read. Those requests
  // wait on `ready` and then read the tokens from this ref instead of a stale render closure —
  // otherwise they'd 401 with no token and log the user out.
  const tokensRef = useRef<{ accessToken: string | null; refreshToken: string | null }>({ accessToken: null, refreshToken: null });
  const [readyGate] = useState(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  });

  // Takes on a session already saved to localStorage (by this tab earlier, or by another tab).
  const adopt = useCallback((data: AuthPayload) => {
    tokensRef.current = { accessToken: data.accessToken, refreshToken: data.refreshToken };
    setUser(data.user);
    setAccessToken(data.accessToken);
  }, []);

  useEffect(() => {
    const stored = readStoredSession();
    if (stored) adopt(stored);
    setLoading(false);
    readyGate.resolve();
  }, [readyGate, adopt]);

  // All tabs share one session (the server allows one per user, and each refresh rotates it).
  // Follow other tabs' refreshes, logins and logouts, or this tab keeps using tokens the server
  // has already replaced and gets signed out.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const stored = readStoredSession();
      if (!stored) {
        tokensRef.current = { accessToken: null, refreshToken: null };
        setUser(null);
        setAccessToken(null);
        return;
      }
      const switchedAccount = user && stored.user.id !== user.id;
      adopt(stored);
      // A different account signed in elsewhere in this browser: reload into its pages.
      if (switchedAccount) window.location.assign(destinationFor(stored.user.role));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [adopt, user]);

  const persist = useCallback((data: AuthPayload) => {
    tokensRef.current = { accessToken: data.accessToken, refreshToken: data.refreshToken };
    setUser(data.user);
    setAccessToken(data.accessToken);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, []);

  const clearAuth = useCallback(() => {
    tokensRef.current = { accessToken: null, refreshToken: null };
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const getAccessToken = useCallback(() => tokensRef.current.accessToken, []);

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
    const token = tokensRef.current.accessToken;
    try {
      if (token) await apiFetch("/api/auth/logout", { method: "POST" }, token);
    } catch {
      // best-effort; clear local session regardless
    } finally {
      clearAuth();
      router.push("/login");
    }
  }, [clearAuth, router]);

  // Concurrent 401s (several in-flight requests when the access token expires) share one
  // refresh call instead of each racing to rotate the refresh token themselves. Across tabs,
  // a browser lock serializes refreshes, and a tab first checks whether another one already
  // rotated the session — spending a stale refresh token would be refused and sign out every tab.
  const refresh = useCallback((): Promise<string | null> => {
    if (!refreshPromiseRef.current) {
      const rejectedToken = tokensRef.current.accessToken;
      const run = async (): Promise<string | null> => {
        const stored = readStoredSession();
        if (stored && stored.accessToken !== rejectedToken) {
          adopt(stored);
          return stored.accessToken;
        }
        const refreshToken = stored?.refreshToken ?? tokensRef.current.refreshToken;
        if (!refreshToken) return null;
        try {
          const data = await apiFetch<AuthPayload>("/api/auth/refresh", {
            method: "POST",
            body: JSON.stringify({ refreshToken }),
          });
          persist(data);
          return data.accessToken;
        } catch {
          clearAuth();
          return null;
        }
      };
      const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
      // request() resolves to the callback's result; .then() flattens the DOM typings' nested Promise.
      const pending = (locks ? locks.request("zp-auth-refresh", run).then((token) => token) : run()).finally(() => {
        refreshPromiseRef.current = null;
      });
      refreshPromiseRef.current = pending;
      return pending;
    }
    return refreshPromiseRef.current;
  }, [persist, clearAuth, adopt]);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        loading,
        login,
        startSignup,
        verifySignupOtp,
        resendSignupOtp,
        logout,
        refresh,
        ready: readyGate.promise,
        getAccessToken,
      }}
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
  const { ready, getAccessToken, refresh, logout } = useAuth();
  return useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      await ready;
      try {
        return await apiFetch<T>(path, options, getAccessToken());
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
    [ready, getAccessToken, refresh, logout]
  );
}

/** Same transparent-refresh behavior as useApi, for multipart file uploads. */
export function useApiUpload() {
  const { ready, getAccessToken, refresh, logout } = useAuth();
  return useCallback(
    async <T,>(path: string, file: File, fieldName: string): Promise<T> => {
      await ready;
      try {
        return await rawApiUpload<T>(path, file, fieldName, getAccessToken());
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
    [ready, getAccessToken, refresh, logout]
  );
}
