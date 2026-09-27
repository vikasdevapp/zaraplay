"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import Logo from "@/components/Logo";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: "📊" },
  { href: "/admin/player-analytics", label: "Player Analytics", icon: "📈" },
  { href: "/admin/transactions", label: "Transactions", icon: "🧾" },
  { href: "/admin/deposits", label: "Deposit Requests", icon: "⬇️" },
  { href: "/admin/cashouts", label: "Cashouts", icon: "💸" },
  { href: "/admin/games", label: "Games", icon: "🎮" },
  { href: "/admin/game-accounts", label: "Game Accounts", icon: "🕹️" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/vip-tiers", label: "VIP Tiers", icon: "🏆" },
  { href: "/admin/marketplace", label: "Marketplace", icon: "🛍️" },
  { href: "/admin/roulette", label: "Roulette Wheel", icon: "🎡" },
  { href: "/admin/support", label: "Support", icon: "🎧" },
  { href: "/admin/support-team", label: "Support Team", icon: "🧑‍💼" },
  { href: "/admin/agent-team", label: "Agent Team", icon: "🧑‍🔧" },
  { href: "/agent", label: "Agent Desk", icon: "📥" },
  { href: "/admin/broadcast", label: "Broadcast", icon: "📣" },
  { href: "/admin/platform-rules", label: "Platform Rules", icon: "📜" },
];

const MASTER_NAV_ITEMS = [
  { href: "/admin/staff", label: "Staff", icon: "🛡️" },
  { href: "/admin/staff-activity", label: "Staff Activity", icon: "📋" },
];

// Available to every panel role, SUPPORT included.
const ACCOUNT_NAV_ITEMS = [{ href: "/admin/change-password", label: "Change Password", icon: "🔑" }];

// SUPPORT staff only ever see the support inbox (plus their own password); the API enforces the same rule.
const SUPPORT_HOME = "/admin/support";
const SUPPORT_NAV_ITEMS = [...NAV_ITEMS.filter((item) => item.href === SUPPORT_HOME), ...ACCOUNT_NAV_ITEMS];
const SUPPORT_PATHS = SUPPORT_NAV_ITEMS.map((item) => item.href);

const PANEL_ROLES = ["ADMIN", "MASTER_ADMIN", "SUPPORT"];

export default function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isSupport = user?.role === "SUPPORT";
  const allowed = !!user && PANEL_ROLES.includes(user.role) && (!isSupport || SUPPORT_PATHS.includes(pathname));

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!PANEL_ROLES.includes(user.role)) router.replace("/dashboard");
    else if (isSupport && !SUPPORT_PATHS.includes(pathname)) router.replace(SUPPORT_HOME);
  }, [loading, user, isSupport, pathname, router]);

  if (loading || !user || !allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  const navItems = isSupport
    ? SUPPORT_NAV_ITEMS
    : [...NAV_ITEMS, ...(user.role === "MASTER_ADMIN" ? MASTER_NAV_ITEMS : []), ...ACCOUNT_NAV_ITEMS];

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside
        className="md:w-56 shrink-0 bg-surface border-b md:border-b-0 md:border-r border-border md:min-h-screen"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="px-4 py-4">
          <Link href={isSupport ? SUPPORT_HOME : "/admin"}>
            <Logo size="sm" />
          </Link>
          <p className="text-[10px] tracking-widest text-muted mt-1">
            {user.role === "MASTER_ADMIN" ? "MASTER ADMIN" : isSupport ? "SUPPORT PANEL" : "ADMIN PANEL"}
          </p>
        </div>
        <nav className="flex md:flex-col overflow-x-auto md:overflow-visible px-2 pb-2 md:pb-4 gap-1">
          {navItems.map((item) => (
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
          <button onClick={() => logout()} className="text-sm text-muted hover:text-white">
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}
