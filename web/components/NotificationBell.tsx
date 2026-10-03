"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/context/AuthContext";

interface Notification {
  id: string;
  title: string;
  body: string;
  kind: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const KIND_ICON: Record<string, string> = { GAME: "🎮", WALLET: "💳", SUPPORT: "🎧", WARNING: "⚠️", SYSTEM: "🔔" };

function timeAgo(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell() {
  const api = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ notifications: Notification[]; unread: number }>("/api/notifications");
      setItems(res.notifications);
      setUnread(res.unread);
    } catch {
      // offline / not logged in yet — leave the bell quiet
    }
  }, [api]);

  // Poll so the badge keeps up with async events (deposits confirmed, game ready, payouts).
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Close when clicking outside the menu.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Opening clears the badge; mark everything read.
      setUnread(0);
      setItems((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
      api("/api/notifications/read", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    }
  }

  function openItem(n: Notification) {
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={toggle}
        className="relative w-9 h-9 rounded-full bg-surface2 border border-border flex items-center justify-center text-lg hover:border-primary"
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-surface border border-border rounded-xl shadow-2xl z-30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <p className="font-semibold text-sm">Notifications</p>
            {items.length > 0 && <span className="text-xs text-muted">{items.length}</span>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-surface2 ${n.readAt ? "" : "bg-primary/5"}`}
                >
                  <span className="text-lg leading-none mt-0.5">{KIND_ICON[n.kind] || "🔔"}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{n.title}</span>
                    <span className="block text-xs text-muted">{n.body}</span>
                    <span className="block text-[10px] text-muted mt-0.5">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.readAt && <span className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
