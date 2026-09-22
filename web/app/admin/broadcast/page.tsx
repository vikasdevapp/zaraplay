"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Broadcast {
  id: string;
  channel: "SMS" | "EMAIL" | "PUSH";
  subject: string | null;
  body: string;
  recipientCount: number;
  createdAt: string;
}

export default function AdminBroadcastPage() {
  const api = useApi();
  const [channel, setChannel] = useState<"SMS" | "EMAIL" | "PUSH">("EMAIL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ broadcasts: Broadcast[] }>("/api/admin/broadcast");
    setHistory(res.broadcasts);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const res = await api<{ broadcast: Broadcast; note?: string }>("/api/admin/broadcast", {
        method: "POST",
        body: JSON.stringify({ channel, subject: channel === "SMS" ? undefined : subject, body }),
      });
      setMessage({
        type: "success",
        text: `Queued for ${res.broadcast.recipientCount} recipient(s).${res.note ? ` ${res.note}` : ""}`,
      });
      setBody("");
      setSubject("");
      await load();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Send failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Broadcast</h1>

      <form onSubmit={handleSend} className="card mb-6 space-y-3">
        <div className="flex gap-2">
          {(["EMAIL", "SMS", "PUSH"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${channel === c ? "bg-primary text-white" : "bg-surface2 text-muted"}`}
            >
              {c === "EMAIL" ? "📧 Email" : c === "SMS" ? "📱 SMS" : "🔔 Push"}
            </button>
          ))}
        </div>
        {(channel === "EMAIL" || channel === "PUSH") && (
          <input className="input" placeholder="Subject / title" value={subject} onChange={(e) => setSubject(e.target.value)} required={channel === "EMAIL"} />
        )}
        <textarea
          className="input min-h-[120px]"
          placeholder={channel === "SMS" ? "SMS message (keep it short)" : channel === "PUSH" ? "Notification text" : "Email body"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
        <p className="text-xs text-muted">
          {channel === "SMS" && "Sends to all phone-verified users via Twilio (falls back to a server log if Twilio isn't configured)."}
          {channel === "PUSH" && "Sends to every browser subscribed to push notifications."}
          {channel === "EMAIL" && "Sends to all users. No bulk email provider is configured yet — this records the send for review rather than actually delivering it."}
        </p>
        {message && <p className={`text-sm ${message.type === "error" ? "text-red-400" : "text-green-400"}`}>{message.text}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Sending…" : `Send ${channel === "EMAIL" ? "Email" : channel === "SMS" ? "SMS" : "Push"}`}
        </button>
      </form>

      <div className="card">
        <h2 className="font-bold mb-3">History</h2>
        <div className="divide-y divide-border">
          {history.map((b) => (
            <div key={b.id} className="py-3">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">
                  {b.channel === "EMAIL" ? "📧" : b.channel === "SMS" ? "📱" : "🔔"} {b.subject || b.body.slice(0, 40)}
                </p>
                <p className="text-xs text-muted">{b.recipientCount} recipients</p>
              </div>
              <p className="text-xs text-muted">{new Date(b.createdAt).toLocaleString()}</p>
            </div>
          ))}
          {history.length === 0 && <p className="text-muted text-sm">No broadcasts sent yet.</p>}
        </div>
      </div>
    </AdminShell>
  );
}
