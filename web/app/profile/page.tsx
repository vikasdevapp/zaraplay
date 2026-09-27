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
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    api<{ user: Profile }>("/api/profile")
      .then((res) => {
        setProfile(res.user);
        setFullName(res.user.fullName);
        setEmail(res.user.email);
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
        body: JSON.stringify({ fullName, email, ...(phone ? { phone } : {}) }),
      });
      setProfile(res.user);
      setMessage({ type: "success", text: "Profile updated successfully." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof ApiError ? err.message : "Update failed." });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "New passwords do not match." });
      return;
    }

    setChangingPassword(true);
    try {
      const res = await api<{ message: string }>("/api/profile/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setPasswordMsg({ type: "success", text: res.message || "Password changed successfully." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordMsg({ type: "error", text: err instanceof ApiError ? err.message : "Password change failed." });
    } finally {
      setChangingPassword(false);
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

        {/* Profile Info Form */}
        <form onSubmit={handleSave} className="card space-y-3">
          <h2 className="font-semibold text-md border-b border-border pb-2">Edit Profile Details</h2>
          <div>
            <label className="text-xs text-muted">Full Name</label>
            <input className="input mt-1" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted">Username (locked)</label>
            <input className="input mt-1 opacity-60" value={profile?.username || ""} disabled />
          </div>
          <div>
            <label className="text-xs text-muted">Email Address (Reset/Update)</label>
            <input
              className="input mt-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter new email"
              required
            />
          </div>
          <div>
            <label className="text-xs text-muted">Phone Number (Reset/Update)</label>
            <div className="flex gap-2 mt-1">
              <input className="input" placeholder="10 digit phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              {!profile?.phoneVerified && phone && (
                <button type="button" onClick={verifyPhone} className="btn-primary shrink-0">
                  Verify
                </button>
              )}
            </div>
            {profile?.phoneVerified && <p className="text-xs text-green-400 mt-1">Verified ✓</p>}
          </div>

          {message && <p className={`text-sm ${message.type === "error" ? "text-red-400" : "text-green-400"}`}>{message.text}</p>}
          <button type="submit" className="btn-primary w-full" disabled={saving}>
            {saving ? "Saving…" : "Save Profile Details"}
          </button>
        </form>

        {/* Change Password Form */}
        <form onSubmit={handleChangePassword} className="card space-y-3">
          <h2 className="font-semibold text-md border-b border-border pb-2">Change Password</h2>
          <div>
            <label className="text-xs text-muted">Current Password</label>
            <input
              className="input mt-1"
              type="password"
              placeholder="Enter current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs text-muted">New Password</label>
            <input
              className="input mt-1"
              type="password"
              placeholder="Min 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs text-muted">Confirm New Password</label>
            <input
              className="input mt-1"
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {passwordMsg && (
            <p className={`text-sm ${passwordMsg.type === "error" ? "text-red-400" : "text-green-400"}`}>{passwordMsg.text}</p>
          )}
          <button type="submit" className="btn-primary w-full" disabled={changingPassword}>
            {changingPassword ? "Updating Password…" : "Change Password"}
          </button>
        </form>

        <button onClick={() => logout()} className="w-full text-center text-sm text-red-400 py-2">
          Logout
        </button>
      </div>
    </AppShell>
  );
}
