"use client";

import { useCallback, useEffect, useRef, useState, FormEvent } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi, useApiUpload } from "@/context/AuthContext";

interface Game {
  id: string;
  name: string;
  imageUrl: string | null;
}
interface Thread {
  user: { id: string; fullName: string; username: string };
  lastMessage: string;
  lastSender: "USER" | "AGENT";
  lastAt: string;
  needsReply: boolean;
}
interface Message {
  id: string;
  sender: "USER" | "AGENT";
  body: string;
  imageUrl?: string | null;
  createdAt: string;
  sentBy?: { fullName: string; username: string } | null;
}

export default function AgentSupportPage() {
  const api = useApi();
  const apiUpload = useApiUpload();
  const [games, setGames] = useState<Game[]>([]);
  const [gameId, setGameId] = useState<string>("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeUser, setActiveUser] = useState<Thread["user"] | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ games: Game[] }>("/api/agent/support/games")
      .then((res) => {
        setGames(res.games);
        if (res.games[0]) setGameId(res.games[0].id);
      })
      .catch(() => {});
  }, [api]);

  const loadThreads = useCallback(
    async (id: string) => {
      const res = await api<{ threads: Thread[] }>(`/api/agent/support/games/${id}/threads`);
      setThreads(res.threads);
    },
    [api]
  );

  useEffect(() => {
    if (gameId) loadThreads(gameId).catch(() => {});
    setActiveUser(null);
    setMessages([]);
  }, [gameId, loadThreads]);

  const openThread = useCallback(
    async (user: Thread["user"]) => {
      setActiveUser(user);
      const res = await api<{ messages: Message[] }>(`/api/agent/support/games/${gameId}/threads/${user.id}/messages`);
      setMessages(res.messages);
    },
    [api, gameId]
  );

  async function send(payload: { body?: string; imageUrl?: string }) {
    if (!activeUser) return;
    setSending(true);
    try {
      const res = await api<{ message: Message }>(`/api/agent/support/games/${gameId}/threads/${activeUser.id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessages((m) => [...m, res.message]);
      loadThreads(gameId).catch(() => {});
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

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold mb-2">Support</h1>
      <p className="text-sm text-muted mb-4">Player chats for the games you manage. Players can send photos as proof.</p>

      {games.length === 0 ? (
        <div className="card text-sm text-muted">No games are assigned to you yet. Ask an admin to assign you as the agent for a game (Admin → Games).</div>
      ) : (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            {games.map((g) => (
              <button
                key={g.id}
                onClick={() => setGameId(g.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${gameId === g.id ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
              >
                {g.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card p-0 md:col-span-1 max-h-[70vh] overflow-y-auto">
              {threads.length === 0 ? (
                <p className="text-sm text-muted p-4">No messages yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {threads.map((t) => (
                    <button
                      key={t.user.id}
                      onClick={() => openThread(t.user)}
                      className={`w-full text-left px-4 py-3 hover:bg-surface2 ${activeUser?.id === t.user.id ? "bg-surface2" : ""}`}
                    >
                      <p className="text-sm font-medium flex items-center gap-2">
                        {t.user.fullName}
                        {t.needsReply && <span className="w-2 h-2 rounded-full bg-primary" />}
                      </p>
                      <p className="text-xs text-muted truncate">
                        {t.lastSender === "AGENT" ? "You: " : ""}
                        {t.lastMessage}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-0 md:col-span-2 flex flex-col h-[70vh]">
              {!activeUser ? (
                <p className="text-sm text-muted m-auto">Select a conversation.</p>
              ) : (
                <>
                  <div className="px-4 py-3 border-b border-border">
                    <p className="font-semibold text-sm">{activeUser.fullName}</p>
                    <p className="text-xs text-muted">@{activeUser.username}</p>
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
                    {messages.length === 0 && <p className="text-center text-muted text-sm mt-10">No messages in this thread.</p>}
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
                    <input className="input flex-1" placeholder="Type a reply…" value={draft} onChange={(e) => setDraft(e.target.value)} />
                    <button type="submit" className="btn-primary" disabled={sending}>
                      ➤
                    </button>
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
