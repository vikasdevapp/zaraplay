"use client";

import { useEffect, useState, FormEvent } from "react";
import AppShell from "@/components/AppShell";
import { useApi, useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Profile {
  fullName: string;
  username: string;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
}

export default function ProfilePage() {
  const api = useApi();
  const { logout } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ user: Profile }>("/api/profile")
      .then((res) => {
        setProfile(res.user);
        setFullName(res.user.fullName);
        setPhone(res.user.phone || "");
      })
      .catch(() => {});
  }, [api]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const res = await api<{ user: Profile }>("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ fullName, ...(phone ? { phone } : {}) }),
      });
      setProfile(res.user);
      setMessage({ type: "success", text: "Profile updated." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Update failed." });
    } finally {
      setSaving(false);
    }
  }

  async function verifyPhone() {
    try {
      await api("/api/profile/verify-phone", { method: "POST" });
      setMessage({ type: "success", text: "Phone verified — $5 free play added!" });
      setProfile((p) => (p ? { ...p, phoneVerified: true } : p));
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Verification failed." });
    }
  }

  return (
    <AppShell>
      <div className="max-w-lg mx-auto space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="w-20 h-20 rounded-full bg-primary/30 border-2 border-gold flex items-center justify-center text-2xl font-bold">
            {profile?.fullName?.slice(0, 1).toUpperCase()}
          </div>
          <p className="font-bold text-lg">{profile?.fullName}</p>
          <p className="text-muted text-sm">@{profile?.username}</p>
        </div>

        <form onSubmit={handleSave} className="card space-y-3">
          <div>
            <label className="text-xs text-muted">Full Name</label>
            <input className="input mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted">Username (locked)</label>
            <input className="input mt-1 opacity-60" value={profile?.username || ""} disabled />
          </div>
          <div>
            <label className="text-xs text-muted">Phone</label>
            <div className="flex gap-2 mt-1">
              <input className="input" placeholder="10 digit phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              {!profile?.phoneVerified && (
                <button type="button" onClick={verifyPhone} className="btn-primary shrink-0">
                  Verify
                </button>
              )}
            </div>
            {profile?.phoneVerified && <p className="text-xs text-green-400 mt-1">Verified ✓</p>}
          </div>
          <div className="bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-muted">
            Email: {profile?.email} — email can&apos;t be changed here.
          </div>
          {message && <p className={`text-sm ${message.type === "error" ? "text-red-400" : "text-green-400"}`}>{message.text}</p>}
          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>

        <button onClick={() => logout()} className="w-full text-center text-sm text-red-400 py-2">
          Logout
        </button>
      </div>
    </AppShell>
  );
}
