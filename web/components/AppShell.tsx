"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import Logo from "@/components/Logo";

const NAV_ITEMS = [
  { href: "/rewards", label: "Rewards", icon: "🎁" },
  { href: "/games", label: "Games", icon: "🎮" },
  { href: "/dashboard", label: "Home", icon: "🏠" },
  { href: "/wallet", label: "Wallet", icon: "💳" },
  { href: "/leaderboard", label: "Leaders", icon: "🏆" },
  { href: "/support", label: "Support", icon: "🎧" },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-border" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3">
          <Link href="/dashboard">
            <Logo size="sm" />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname === item.href ? "bg-primary text-white" : "text-muted hover:text-white hover:bg-surface2"
                }`}
              >
                {item.icon} {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/profile" className="w-9 h-9 rounded-full bg-primary/30 border border-primary flex items-center justify-center text-sm font-semibold">
              {user.fullName.slice(0, 1).toUpperCase()}
            </Link>
            <button onClick={() => logout()} className="hidden md:inline text-sm text-muted hover:text-white">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 pb-24 md:pb-6">{children}</main>

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-surface border-t border-border flex justify-around py-2"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 8px)" }}
      >
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs ${
              pathname === item.href ? "text-gold" : "text-muted"
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
