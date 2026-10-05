"use client";

import { useEffect, useRef, useState, useCallback, FormEvent, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useApi, useApiUpload } from "@/context/AuthContext";

interface Game {
  id: string;
  name: string;
  imageUrl: string | null;
}

interface Message {
  id: string;
  sender: "USER" | "AGENT";
  body: string;
  imageUrl?: string | null;
  createdAt: string;
}

function SupportContent() {
  const api = useApi();
  const apiUpload = useApiUpload();
  const searchParams = useSearchParams();
  // Deep link from a game card: /support?game=<id> opens that game's support chat directly.
  const wantedGameId = searchParams.get("game");
  const [games, setGames] = useState<Game[]>([]);
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [ticketStatus, setTicketStatus] = useState<"NEW" | "PENDING" | "SOLVED" | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openGame = useCallback(
    async (game: Game) => {
      setActiveGame(game);
      const res = await api<{ messages: Message[]; ticketStatus: "NEW" | "PENDING" | "SOLVED" | null }>(`/api/support/games/${game.id}/messages`);
      setMessages(res.messages);
      setTicketStatus(res.ticketStatus);
    },
    [api]
  );

  useEffect(() => {
    api<{ games: Game[] }>("/api/support/games")
      .then((res) => {
        setGames(res.games);
        const wanted = wantedGameId && res.games.find((g) => g.id === wantedGameId);
        if (wanted) openGame(wanted).catch(() => {});
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, wantedGameId]);

  async function send(payload: { body?: string; imageUrl?: string }) {
    if (!activeGame) return;
    setSending(true);
    try {
      const res = await api<{ message: Message }>(`/api/support/games/${activeGame.id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessages((m) => [...m, res.message]);
      setTicketStatus("NEW");
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
      // ignore
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (activeGame) {
    return (
      <AppShell>
        <div className="flex flex-col h-[70vh] card p-0 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <button onClick={() => setActiveGame(null)} className="text-muted">
              ←
            </button>
            <div className="w-9 h-9 rounded-full bg-primary/30 flex items-center justify-center font-semibold">
              {activeGame.name.slice(0, 1)}
            </div>
            <div>
              <p className="font-semibold text-sm">{activeGame.name} Support</p>
              <p className="text-xs text-muted">
                {ticketStatus === "NEW"
                  ? "Waiting for support to reply…"
                  : ticketStatus === "PENDING"
                    ? "Support is helping you"
                    : "We'll reply here"}
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            {messages.length === 0 && (
              <p className="text-center text-muted text-sm mt-10">
                Start a conversation about {activeGame.name}. You can attach a photo as proof.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === "USER" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.sender === "USER" ? "bg-primary text-white" : "bg-surface2 text-white"}`}>
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
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2 px-3 py-3 border-t border-border">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) attachPhoto(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={sending}
              className="w-10 h-10 shrink-0 rounded-full bg-surface2 border border-border flex items-center justify-center text-lg disabled:opacity-40"
              aria-label="Attach photo"
              title="Attach a photo"
            >
              📷
            </button>
            <input className="input flex-1" placeholder="Type a message…" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn-primary" disabled={sending}>
              ➤
            </button>
          </form>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="card">
          <h1 className="font-bold text-lg">Game Support</h1>
          <p className="text-sm text-muted">Pick a game to chat with its support team</p>
        </div>
        {games.length === 0 ? (
          <div className="card text-sm text-muted">Add a game first — then you can chat with its support team here.</div>
        ) : (
          <div className="card divide-y divide-border p-0">
            {games.map((g) => (
              <button key={g.id} onClick={() => openGame(g)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface2 text-left">
                <div className="w-10 h-10 rounded-full bg-primary/30 flex items-center justify-center font-semibold">{g.name.slice(0, 1)}</div>
                <div>
                  <p className="font-medium text-sm">{g.name}</p>
                  <p className="text-xs text-muted">Tap to open support</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function SupportPage() {
  return (
    <Suspense>
      <SupportContent />
    </Suspense>
  );
}
