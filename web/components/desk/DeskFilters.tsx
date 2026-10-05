"use client";

import { ReactNode } from "react";
import type { DeskGame, DeskStaff } from "@/lib/desk";

export interface FilterState {
  search: string;
  gameId: string;
  staffId: string;
  source: string;
  from: string;
  to: string;
}

export const emptyFilters: FilterState = { search: "", gameId: "", staffId: "", source: "", from: "", to: "" };

/** One row of filters above a list, as on the distributor panel. */
export function DeskFilters({
  value,
  onChange,
  games,
  staff,
  showSource,
  searchPlaceholder = "Username…",
  hideSearch,
  count,
  countLabel,
  extra,
}: {
  value: FilterState;
  onChange: (v: FilterState) => void;
  games: DeskGame[];
  staff: DeskStaff[];
  showSource?: boolean;
  searchPlaceholder?: string;
  // Lists that have no searchable text (e.g. backend top-ups) hide the search box.
  hideSearch?: boolean;
  count: number;
  countLabel: string;
  extra?: ReactNode;
}) {
  const set = (k: keyof FilterState) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const active = Object.values(value).some(Boolean);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {!hideSearch && (
          <label className="text-xs text-muted">
            Search
            <input className="input mt-1" placeholder={searchPlaceholder} value={value.search} onChange={set("search")} />
          </label>
        )}
        <label className="text-xs text-muted">
          Game
          <select className="input mt-1" value={value.gameId} onChange={set("gameId")}>
            <option value="">All Games</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Staff
          <select className="input mt-1" value={value.staffId} onChange={set("staffId")}>
            <option value="">All Staff</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                @{s.username}
              </option>
            ))}
          </select>
        </label>
        {showSource && (
          <label className="text-xs text-muted">
            Source
            <select className="input mt-1" value={value.source} onChange={set("source")}>
              <option value="">All Sources</option>
              <option value="PAGE">Page</option>
              <option value="PERSONAL">Personal</option>
              <option value="WEB">Web</option>
            </select>
          </label>
        )}
        <label className="text-xs text-muted">
          From Date
          <input className="input mt-1" type="date" value={value.from} onChange={set("from")} />
        </label>
        <label className="text-xs text-muted">
          To Date
          <input className="input mt-1" type="date" value={value.to} onChange={set("to")} />
        </label>
      </div>
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <button type="button" className="btn-ghost text-xs px-3 py-1.5" disabled={!active} onClick={() => onChange(emptyFilters)}>
          Clear Filters
        </button>
        <span className="text-muted">
          {count} {countLabel}
        </span>
        {extra}
      </div>
    </div>
  );
}

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <label className="text-xs text-muted flex items-center gap-2">
      Items per page
      <select className="input py-1 w-20" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[10, 20, 50, 100].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm border-t border-border">
      <span className="text-muted">
        Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        <button className="btn-ghost text-xs px-3 py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ← Prev
        </button>
        <button className="btn-ghost text-xs px-3 py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}
