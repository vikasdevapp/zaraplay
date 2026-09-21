"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/context/AuthContext";

interface AdminUser {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: string;
  phoneVerified: boolean;
  createdAt: string;
  wallet: { balance: string; freePlay: string; totalDeposited: string } | null;
}

export default function AdminUsersPage() {
  const api = useApi();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (q: string) => {
      const res = await api<{ users: AdminUser[] }>(`/api/admin/users${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      setUsers(res.users);
    },
    [api]
  );

  useEffect(() => {
    load("").catch(() => {});
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <AdminShell>
      <h1 className="text-2xl font-bold mb-6">Users</h1>

      <input
        className="input mb-4"
        placeholder="Search by name, username or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted text-xs border-b border-border">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Username</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Free Play</th>
              <th className="px-4 py-3">Deposited</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-surface2">
                <td className="px-4 py-3">
                  <Link href={`/admin/users/${u.id}`} className="font-medium text-primary">
                    {u.fullName}
                  </Link>
                  {u.role === "ADMIN" && <span className="ml-2 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">ADMIN</span>}
                </td>
                <td className="px-4 py-3 text-muted">@{u.username}</td>
                <td className="px-4 py-3">${Number(u.wallet?.balance ?? 0).toFixed(2)}</td>
                <td className="px-4 py-3">{Number(u.wallet?.freePlay ?? 0).toFixed(2)} FP</td>
                <td className="px-4 py-3">${Number(u.wallet?.totalDeposited ?? 0).toFixed(2)}</td>
                <td className="px-4 py-3 text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="text-muted text-sm text-center py-8">No users found.</p>}
      </div>
    </AdminShell>
  );
}
