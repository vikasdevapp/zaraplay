"use client";

import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi, useApiUpload } from "@/context/AuthContext";

interface Game {
  id: string;
  name: string;
  imageUrl: string | null;
  newTickets: number;
}
type Status = "NEW" | "PENDING" | "SOLVED";
interface Ticket {
  id: string;
  status: Status;
  unread: number;
  createdAt: string;
  updatedAt: string;
  user: { id: string; fullName: string; username: string };
  userTicketCount: number;
  lastMessage: string;
  lastSender: "USER" | "AGENT" | null;
}
interface Message {
  id: string;
  sender: "USER" | "AGENT";
  body: string;
  imageUrl?: string | null;
  createdAt: string;
  sentBy?: { fullName: string; username: string } | null;
}

const STATUS_FILTERS: { key: "" | Status; label: string }[] = [
  { key: "", label: "All" },
  { key: "NEW", label: "New" },
  { key: "PENDING", label: "Pending" },
  { key: "SOLVED", label: "Solved" },
];

const STATUS_STYLE: Record<Status, string> = {
  NEW: "bg-red-500/20 text-red-300",
  PENDING: "bg-amber-500/20 text-amber-300",
  SOLVED: "bg-emerald-500/20 text-emerald-300",
};

export default function AgentSupportPage() {
  const api = useApi();
  const apiUpload = useApiUpload();
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Status>("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadGames = useCallback(async () => {
    const res = await api<{ games: Game[] }>("/api/agent/support/games");
    setGames(res.games);
    setGameId((id) => id || res.games[0]?.id || "");
  }, [api]);

  useEffect(() => {
    loadGames().catch(() => {});
  }, [loadGames]);

  const loadTickets = useCallback(async () => {
    if (!gameId) return;
    const qs = statusFilter ? `?status=${statusFilter}` : "";
    const res = await api<{ tickets: Ticket[] }>(`/api/agent/support/games/${gameId}/tickets${qs}`);
    setTickets(res.tickets);
  }, [api, gameId, statusFilter]);

  useEffect(() => {
    loadTickets().catch(() => {});
    setActive(null);
    setMessages([]);
  }, [loadTickets]);

  const openTicket = useCallback(
    async (t: Ticket) => {
      setActive(t);
      const res = await api<{ messages: Message[]; ticket: { status: Status } }>(`/api/agent/support/tickets/${t.id}/messages`);
      setMessages(res.messages);
      // Clear the unread badge locally.
      setTickets((list) => list.map((x) => (x.id === t.id ? { ...x, unread: 0 } : x)));
      loadGames().catch(() => {});
    },
    [api, loadGames]
  );

  async function send(payload: { body?: string; imageUrl?: string }) {
    if (!active) return;
    setSending(true);
    try {
      const res = await api<{ message: Message }>(`/api/agent/support/tickets/${active.id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessages((m) => [...m, res.message]);
      setActive((a) => (a ? { ...a, status: "PENDING" } : a));
      loadTickets().catch(() => {});
    } finally {
      setSending(false);
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    await send({ body: draft });
    setDraft("");
  }

  async function attachPhoto(file: File) {
    setSending(true);
    try {
      const { url } = await apiUpload<{ url: string }>("/api/support/upload", file, "image");
      await send({ imageUrl: url });
    } catch {
      /* ignore */
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function setResolved(resolve: boolean) {
    if (!active) return;
    await api(`/api/agent/support/tickets/${active.id}/${resolve ? "resolve" : "reopen"}`, { method: "POST" });
    setActive((a) => (a ? { ...a, status: resolve ? "SOLVED" : "PENDING" } : a));
    loadTickets().catch(() => {});
    loadGames().catch(() => {});
  }

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-2">Support Tickets</h1>
      <p className="text-sm text-muted mb-4">Player chats for the games you manage — with status and unread counts. Resolve a ticket when the issue is fixed.</p>

      {games.length === 0 ? (
        <div className="card text-sm text-muted">No games are assigned to you yet. Ask an admin to assign you as the agent for a game (Admin → Games).</div>
      ) : (
        <>
          <div className="flex gap-2 mb-3 flex-wrap">
            {games.map((g) => (
              <button
                key={g.id}
                onClick={() => setGameId(g.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${gameId === g.id ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
              >
                {g.name}
                {g.newTickets > 0 && <span className="ml-1.5 text-[10px] bg-red-500 text-white rounded-full px-1.5">{g.newTickets}</span>}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-4 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${statusFilter === f.key ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Ticket list */}
            <div className="card p-0 md:col-span-1 max-h-[70vh] overflow-y-auto">
              {tickets.length === 0 ? (
                <p className="text-sm text-muted p-4">No tickets.</p>
              ) : (
                <div className="divide-y divide-border">
                  {tickets.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => openTicket(t)}
                      className={`w-full text-left px-4 py-3 hover:bg-surface2 ${active?.id === t.id ? "bg-surface2" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{t.user.fullName}</span>
                        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                      </div>
                      <p className="text-xs text-muted truncate">
                        {t.lastSender === "AGENT" ? "You: " : ""}
                        {t.lastMessage}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted">@{t.user.username} · {t.userTicketCount} ticket(s)</span>
                        {t.unread > 0 && <span className="text-[10px] bg-red-500 text-white rounded-full px-1.5">{t.unread} new</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Conversation */}
            <div className="card p-0 md:col-span-2 flex flex-col h-[70vh]">
              {!active ? (
                <p className="text-sm text-muted m-auto">Select a ticket.</p>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{active.user.fullName}</p>
                      <p className="text-xs text-muted">@{active.user.username} · {active.userTicketCount} ticket(s) total</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_STYLE[active.status]}`}>{active.status}</span>
                      {active.status === "SOLVED" ? (
                        <button onClick={() => setResolved(false)} className="btn-ghost text-xs px-2 py-1">Reopen</button>
                      ) : (
                        <button onClick={() => setResolved(true)} className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">Mark Solved</button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                    {messages.map((m) => (
                      <div key={m.id} className={`flex ${m.sender === "AGENT" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.sender === "AGENT" ? "bg-primary text-white" : "bg-surface2 text-white"}`}>
                          {m.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <a href={m.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img src={m.imageUrl} alt="attachment" className="rounded-lg max-h-56 mb-1" />
                            </a>
                          )}
                          {m.body}
                        </div>
                      </div>
                    ))}
                    {messages.length === 0 && <p className="text-center text-muted text-sm mt-10">No messages in this ticket.</p>}
                  </div>
                  <form onSubmit={handleSend} className="flex items-center gap-2 px-3 py-3 border-t border-border">
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) attachPhoto(f); }} />
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={sending} className="w-10 h-10 shrink-0 rounded-full bg-surface2 border border-border flex items-center justify-center text-lg disabled:opacity-40" aria-label="Attach photo" title="Attach a photo">
                      📷
                    </button>
                    <input className="input flex-1" placeholder="Type a reply…" value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <button type="submit" className="btn-primary" disabled={sending}>➤</button>
                  </form>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </AgentShell>
  );
}
