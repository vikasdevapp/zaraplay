"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, ReactNode } from "react";
import { useApi, useAuth } from "@/context/AuthContext";
import ConfirmDialog from "@/components/ConfirmDialog";

interface NavLink {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  agentOnly?: boolean;
  // AGENT role only (not support staff, not admin) — e.g. running your own staff.
  agentExclusive?: boolean;
  badge?: "requests" | "support";
}
interface NavGroup {
  label: string;
  icon: string;
  children: NavLink[];
}
type NavItem = NavLink | NavGroup;

// Mirrors the game distributor panel's menu, plus the website request queue.
const NAV: NavItem[] = [
  { href: "/agent", label: "Dashboard", icon: "🧭" },
  { href: "/agent/requests", label: "Website Requests", icon: "📥", badge: "requests" },
  {
    label: "Transactions",
    icon: "🧾",
    children: [
      { href: "/agent/transactions", label: "All Transactions", icon: "" },
      { href: "/agent/transactions/recharge", label: "Recharge", icon: "" },
      { href: "/agent/transactions/bonus", label: "Bonus", icon: "" },
      { href: "/agent/transactions/redeem", label: "Redeem", icon: "" },
      { href: "/agent/transactions/free-play", label: "Free Play (FP)", icon: "" },
    ],
  },
  { href: "/agent/create-account", label: "Create Account", icon: "➕" },
  { href: "/agent/game-accounts", label: "Game Accounts", icon: "👥" },
  { href: "/agent/game-balances", label: "Games Balance", icon: "📦" },
  { href: "/agent/game-records", label: "Game Records", icon: "📊" },
  { href: "/agent/cashouts", label: "Cashouts", icon: "💸" },
  { href: "/agent/support", label: "Support", icon: "🎧", badge: "support" },
  {
    label: "Recharge Ledger",
    icon: "💲",
    children: [
      { href: "/agent/ledger", label: "Backend Top-ups", icon: "" },
      { href: "/agent/ledger/wallet", label: "Website Wallet", icon: "" },
    ],
  },
  { href: "/admin/agent-team", label: "Staff Management", icon: "🧑‍💼", adminOnly: true },
  { href: "/agent/staff-activity", label: "Staff Activity", icon: "📋", adminOnly: true },
  { href: "/agent/staff", label: "My Staff", icon: "🧑‍💼", agentExclusive: true },
  { href: "/agent/activity", label: "My Activity", icon: "🕓", agentOnly: true },
  { href: "/agent/change-password", label: "Change Password", icon: "🔒" },
  { href: "/agent/two-factor", label: "Two-Factor (2FA)", icon: "🛡️" },
];

const AGENT_DASHBOARD_ROLES = ["AGENT", "SUPPORT", "ADMIN", "MASTER_ADMIN"];

export default function AgentShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const api = useApi();
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = user?.role === "ADMIN" || user?.role === "MASTER_ADMIN";
  const isAgent = user?.role === "AGENT";
  const [pendingRequests, setPendingRequests] = useState(0);
  const [supportNew, setSupportNew] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/agent/login");
    else if (!AGENT_DASHBOARD_ROLES.includes(user.role)) router.replace("/dashboard");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !AGENT_DASHBOARD_ROLES.includes(user.role)) return;
    const load = () =>
      api<{ pendingRequests: number; supportNew: number }>("/api/agent/stats")
        .then((s) => {
          setPendingRequests(s.pendingRequests);
          setSupportNew(s.supportNew ?? 0);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [api, user]);

  if (loading || !user || !AGENT_DASHBOARD_ROLES.includes(user.role)) {
    return <div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>;
  }

  const visible = (l: NavLink) => {
    if (l.adminOnly) return isAdmin;
    if (l.agentExclusive) return isAgent;
    if (l.agentOnly) return !isAdmin;
    return true;
  };
  const linkClass = (href: string, sub = false) =>
    `block shrink-0 ${sub ? "px-3 md:pl-9 py-1.5" : "px-3 py-2"} rounded-lg text-sm font-medium whitespace-nowrap ${
      pathname === href ? "bg-primary text-white" : "text-muted hover:text-white hover:bg-surface2"
    }`;

  function renderLink(l: NavLink, sub = false) {
    return (
      <Link key={l.href} href={l.href} className={linkClass(l.href, sub)}>
        {l.icon && `${l.icon} `}
        {l.label}
        {l.badge === "requests" && pendingRequests > 0 && (
          <span className="ml-2 text-[10px] bg-primary text-white rounded-full px-1.5 py-0.5">{pendingRequests}</span>
        )}
        {l.badge === "support" && supportNew > 0 && (
          <span className="ml-2 text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5">{supportNew}</span>
        )}
      </Link>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-60 shrink-0 bg-black border-b md:border-b-0 md:border-r border-border md:min-h-screen" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-primary/20 border border-primary flex items-center justify-center text-sm">🧑‍💼</span>
            <span className="font-display font-bold text-lg">Agent Desk</span>
          </div>
          <p className="text-[10px] tracking-widest text-muted mt-1">ZARA PLAYS · {isAdmin ? "ADMIN" : isAgent ? "AGENT" : "SUPPORT"}</p>
        </div>
        <p className="hidden md:block px-4 text-[10px] tracking-widest text-muted mb-1">MENU</p>
        <nav className="flex md:flex-col overflow-x-auto md:overflow-visible px-2 pb-2 md:pb-4 gap-1">
          {NAV.map((item) => {
            if ("href" in item) return visible(item) ? renderLink(item) : null;
            const children = item.children.filter(visible);
            const active = children.some((c) => c.href === pathname);
            const expanded = open[item.label] ?? active;
            return (
              <div key={item.label} className="contents md:block">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [item.label]: !expanded }))}
                  className={`hidden md:flex w-full items-center justify-between px-3 py-2 rounded-lg text-sm font-medium ${
                    active ? "text-white" : "text-muted hover:text-white hover:bg-surface2"
                  }`}
                  aria-expanded={expanded}
                >
                  <span>
                    {item.icon} {item.label}
                  </span>
                  <span className="text-xs">{expanded ? "▴" : "▾"}</span>
                </button>
                {/* Mobile shows sub-pages inline in the scrolling bar; desktop collapses them. */}
                <div className={`contents ${expanded ? "md:block" : "md:hidden"} md:space-y-0.5`}>{children.map((c) => renderLink({ ...c, label: c.label }, true))}</div>
              </div>
            );
          })}
        </nav>
        <div className="px-4 pb-3 md:pb-0 md:mt-2 flex md:block items-center justify-between gap-3">
          {isAdmin && (
            <Link href="/admin" className="block text-sm text-muted hover:text-white md:mb-3">
              ← Admin panel
            </Link>
          )}
          <p className="hidden md:block text-xs text-muted mb-2">
            {user.fullName} · @{user.username}
          </p>
          <button onClick={() => setConfirmLogout(true)} className="text-sm text-muted hover:text-white">
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 px-4 py-6 max-w-7xl w-full mx-auto">{children}</main>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        message="You'll need to sign in again to get back into the desk."
        confirmLabel="Log out"
        danger
        onConfirm={() => {
          setConfirmLogout(false);
          logout();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
}
