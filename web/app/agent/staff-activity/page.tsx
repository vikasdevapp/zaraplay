"use client";

import { useCallback, useEffect, useState } from "react";
import AgentShell from "@/components/AgentShell";
import { useApi, useAuth } from "@/context/AuthContext";
import { Pager, PageSizeSelect } from "@/components/desk/DeskFilters";
import { useDeskMeta } from "@/components/desk/useDeskMeta";
import { describeActivity } from "@/lib/activity";
import { dayRangeParams } from "@/lib/desk";

interface Log {
  id: string;
  action: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
  actor: { username: string; role: string };
}

export default function AgentStaffActivityPage() {
  const api = useApi();
  const { user } = useAuth();
  const { staff } = useDeskMeta();
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const isAdmin = user?.role === "ADMIN" || user?.role === "MASTER_ADMIN";

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (staffId) params.set("staffId", staffId);
    dayRangeParams(from, to, params);
    const r = await api<{ rows: Log[]; total: number }>(`/api/agent/desk/staff-activity?${params}`);
    setRows(r.rows);
    setTotal(r.total);
  }, [api, staffId, from, to, page, pageSize]);

  useEffect(() => {
    if (isAdmin) load().catch(() => {});
  }, [load, isAdmin]);

  if (!isAdmin) {
    return (
      <AgentShell>
        <p className="text-muted">Only admins can see every staff member&apos;s activity.</p>
      </AgentShell>
    );
  }

  return (
    <AgentShell>
      <h1 className="text-2xl font-bold">Staff Activity</h1>
      <p className="text-sm text-muted mb-6">Everything your agents and admins did on the desk.</p>

      <div className="card mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          Staff
          <select
            className="input mt-1"
            value={staffId}
            onChange={(e) => {
              setStaffId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Staff</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                @{s.username}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          From Date
          <input className="input mt-1" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="text-xs text-muted">
          To Date
          <input className="input mt-1" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </label>
        <span className="text-sm text-muted">{total} entries</span>
        <div className="ml-auto">
          <PageSizeSelect value={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      </div>

      <div className="card p-0 divide-y divide-border">
        {rows.map((l) => (
          <div key={l.id} className="px-4 py-3 text-sm flex items-start justify-between gap-3">
            <div>
              <p>
                <span className="font-medium">@{l.actor.username}</span> <span className="text-[10px] text-muted uppercase">{l.actor.role.replace("_", " ")}</span>
              </p>
              <p className="text-muted">{describeActivity(l.action, l.meta)}</p>
            </div>
            <p className="text-xs text-muted whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="text-muted text-sm text-center py-10">No activity found.</p>}
        <Pager page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </div>
    </AgentShell>
  );
}
