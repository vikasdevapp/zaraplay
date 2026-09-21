"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";

const NAV_ITEMS = [
  { href: "/agent", label: "Dashboard", icon: "🧭" },
  { href: "/agent/game-balances", label: "Game Balances", icon: "💰" },
  { href: "/agent/game-records", label: "Game Records", icon: "📄" },
  { href: "/agent/ledger", label: "Recharge Ledger", icon: "🧾" },
  { href: "/agent/activity", label: "My Activity", icon: "🕓" },
];

const AGENT_DASHBOARD_ROLES = ["AGENT", "ADMIN", "MASTER_ADMIN"];

export default function AgentShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!AGENT_DASHBOARD_ROLES.includes(user.role)) router.replace("/dashboard");
  }, [loading, user, router]);

  if (loading || !user || !AGENT_DASHBOARD_ROLES.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside
        className="md:w-56 shrink-0 bg-black border-b md:border-b-0 md:border-r border-border md:min-h-screen"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-primary/20 border border-primary flex items-center justify-center text-sm">🧑‍💼</span>
            <span className="font-display font-bold text-lg">Agent Desk</span>
          </div>
          <p className="text-[10px] tracking-widest text-muted mt-1">ZARA PLAYS · AGENT</p>
        </div>
        <nav className="flex md:flex-col overflow-x-auto md:overflow-visible px-2 pb-2 md:pb-4 gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                pathname === item.href ? "bg-primary text-white" : "text-muted hover:text-white hover:bg-surface2"
              }`}
            >
              {item.icon} {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden md:block px-4 mt-4">
          <p className="text-xs text-muted mb-2">
            {user.fullName} · @{user.username}
          </p>
          <button onClick={() => logout()} className="text-sm text-muted hover:text-white">
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}
