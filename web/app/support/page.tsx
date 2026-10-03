"use client";

import { useEffect, useRef, useState, useCallback, FormEvent, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useApi, useApiUpload } from "@/context/AuthContext";

interface Agent {
  id: string;
  name: string;
  isOnline: boolean;
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
  // Deep link from a game card: /support?agent=<id> opens that game's support chat directly.
  const wantedAgentId = searchParams.get("agent");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openAgent = useCallback(
    async (agent: Agent) => {
      setActiveAgent(agent);
      const res = await api<{ messages: Message[] }>(`/api/support/agents/${agent.id}/messages`);
      setMessages(res.messages);
    },
    [api]
  );

  useEffect(() => {
    api<{ agents: Agent[] }>("/api/support/agents")
      .then((res) => {
        setAgents(res.agents);
        const wanted = wantedAgentId && res.agents.find((a) => a.id === wantedAgentId);
        if (wanted) openAgent(wanted).catch(() => {});
      })
      .catch(() => {});
    // Only on first load / when the deep-linked agent changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, wantedAgentId]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!activeAgent || !draft.trim()) return;
    await send({ body: draft });
    setDraft("");
  }

  async function send(payload: { body?: string; imageUrl?: string }) {
    if (!activeAgent) return;
    setSending(true);
    try {
      const res = await api<{ message: Message }>(`/api/support/agents/${activeAgent.id}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessages((m) => [...m, res.message]);
    } finally {
      setSending(false);
    }
  }

  async function attachPhoto(file: File) {
    setSending(true);
    try {
      const { url } = await apiUpload<{ url: string }>("/api/support/upload", file, "image");
      await send({ imageUrl: url });
    } catch {
      // ignore upload failure; user can retry
    } finally {
      setSending(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (activeAgent) {
    return (
      <AppShell>
        <div className="flex flex-col h-[70vh] card p-0 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <button onClick={() => setActiveAgent(null)} className="text-muted">
              ←
            </button>
            <div className="w-9 h-9 rounded-full bg-primary/30 flex items-center justify-center font-semibold">
              {activeAgent.name.slice(0, 1)}
            </div>
            <div>
              <p className="font-semibold text-sm">{activeAgent.name}</p>
              <p className="text-xs text-muted">Support Agent</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            {messages.length === 0 && (
              <p className="text-center text-muted text-sm mt-10">
                Start a conversation. Message will be delivered to {activeAgent.name}.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === "USER" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    m.sender === "USER" ? "bg-primary text-white" : "bg-surface2 text-white"
                  }`}
                >
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
            <input
              className="input flex-1"
              placeholder="Type a message…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
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
          <h1 className="font-bold text-lg">Talk with agents</h1>
          <p className="text-sm text-muted">Pick a channel to reach our team</p>
        </div>
        <div className="card divide-y divide-border p-0">
          {agents.map((agent) => (
            <button key={agent.id} onClick={() => openAgent(agent)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface2 text-left">
              <div className="relative w-10 h-10 rounded-full bg-primary/30 flex items-center justify-center font-semibold">
                {agent.name.slice(0, 1)}
                {agent.isOnline && <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-surface" />}
              </div>
              <div>
                <p className="font-medium text-sm">{agent.name}</p>
                <p className="text-xs text-muted">Support Agent</p>
              </div>
            </button>
          ))}
        </div>
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
