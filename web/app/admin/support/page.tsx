"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";

interface Agent {
  id: string;
  name: string;
  isOnline: boolean;
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
  createdAt: string;
}

export default function AdminSupportPage() {
  const api = useApi();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    api<{ agents: Agent[] }>("/api/admin/support/agents")
      .then((res) => {
        setAgents(res.agents);
        if (res.agents.length > 0) setActiveAgent(res.agents[0]);
      })
      .catch(() => {});
  }, [api]);

  const loadThreads = useCallback(
    async (agentId: string) => {
      const res = await api<{ threads: Thread[] }>(`/api/admin/support/agents/${agentId}/threads`);
      setThreads(res.threads);
    },
    [api]
  );

  useEffect(() => {
    if (activeAgent) loadThreads(activeAgent.id).catch(() => {});
    setActiveThread(null);
  }, [activeAgent, loadThreads]);

  const openThread = useCallback(
    async (thread: Thread) => {
      if (!activeAgent) return;
      setActiveThread(thread);
      const res = await api<{ messages: Message[] }>(`/api/admin/support/agents/${activeAgent.id}/threads/${thread.user.id}/messages`);
      setMessages(res.messages);
    },
    [api, activeAgent]
  );

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!activeAgent || !activeThread || !draft.trim()) return;
    const res = await api<{ message: Message }>(`/api/admin/support/agents/${activeAgent.id}/threads/${activeThread.user.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: draft }),
    });
    setMessages((m) => [...m, res.message]);
    setDraft("");
    loadThreads(activeAgent.id).catch(() => {});
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Support</h1>

      <div className="flex gap-2 mb-4 flex-wrap">
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => setActiveAgent(a)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              activeAgent?.id === a.id ? "bg-primary text-white" : "bg-surface2 text-muted"
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-0 divide-y divide-border md:col-span-1 max-h-[65vh] overflow-y-auto">
          {threads.map((t) => (
            <button
              key={t.user.id}
              onClick={() => openThread(t)}
              className={`w-full text-left px-4 py-3 hover:bg-surface2 ${activeThread?.user.id === t.user.id ? "bg-surface2" : ""}`}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{t.user.fullName}</p>
                {t.needsReply && <span className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <p className="text-xs text-muted truncate">{t.lastMessage}</p>
            </button>
          ))}
          {threads.length === 0 && <p className="text-muted text-sm text-center py-8 px-4">No conversations yet.</p>}
        </div>

        <div className="card p-0 md:col-span-2 flex flex-col h-[65vh]">
          {!activeThread ? (
            <div className="flex-1 flex items-center justify-center text-muted text-sm">Select a conversation</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border">
                <p className="font-semibold text-sm">{activeThread.user.fullName}</p>
                <p className="text-xs text-muted">@{activeThread.user.username}</p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender === "AGENT" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.sender === "AGENT" ? "bg-primary text-white" : "bg-surface2 text-white"}`}>
                      {m.body}
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={handleSend} className="flex items-center gap-2 px-3 py-3 border-t border-border">
                <input className="input flex-1" placeholder="Reply as agent…" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button type="submit" className="btn-primary">
                  ➤
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
