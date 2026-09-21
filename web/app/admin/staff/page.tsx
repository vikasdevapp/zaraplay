"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

interface Staff {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: "ADMIN" | "MASTER_ADMIN";
  createdAt: string;
}

export default function AdminStaffPage() {
  const api = useApi();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MASTER_ADMIN">("ADMIN");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ staff: Staff[] }>("/api/admin/staff");
    setStaff(res.staff);
  }, [api]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/api/admin/staff", { method: "POST", body: JSON.stringify({ fullName, username, email, password, role }) });
      setFullName("");
      setUsername("");
      setEmail("");
      setPassword("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create staff account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Staff Management</h1>

      <form onSubmit={handleCreate} className="card mb-6 space-y-3">
        <h2 className="font-bold">Create Staff User</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className="input" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            className="input"
            type="password"
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <select className="input sm:w-52" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "MASTER_ADMIN")}>
          <option value="ADMIN">Admin</option>
          <option value="MASTER_ADMIN">Master Admin</option>
        </select>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create Staff"}
        </button>
      </form>

      <div className="card p-0 divide-y divide-border">
        {staff.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-sm">{s.fullName}</p>
              <p className="text-xs text-muted">
                @{s.username} · {s.email}
              </p>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${s.role === "MASTER_ADMIN" ? "bg-primary/20 text-primary" : "bg-surface2 text-muted"}`}>
              {s.role === "MASTER_ADMIN" ? "Master Admin" : "Admin"}
            </span>
          </div>
        ))}
        {staff.length === 0 && <p className="text-muted text-sm text-center py-8">No staff users created yet.</p>}
      </div>
    </AdminShell>
  );
}
