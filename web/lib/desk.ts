// Shared types and helpers for the Agent Desk (manual game-distributor panel).

export type TxType = "RECHARGE" | "BONUS" | "REDEEM" | "FREEPLAY";
export type TxSource = "PAGE" | "PERSONAL" | "WEB";

export interface DeskGame {
  id: string;
  name: string;
  isActive: boolean;
}
export interface DeskStaff {
  id: string;
  username: string;
  role: string;
}

export interface SourceTotals {
  amount: number;
  count: number;
}
export interface TypeTotals {
  amount: number;
  count: number;
  bySource: Record<TxSource, SourceTotals>;
}

export interface GameTx {
  id: string;
  type: TxType;
  source: TxSource;
  gameUsername: string;
  amount: string;
  balanceAfter: string;
  note: string | null;
  createdAt: string;
  game: { name: string };
  staff: { username: string } | null;
  userGame: { playerName: string | null; user: { username: string } | null };
}

export const TX_LABELS: Record<TxType, string> = {
  RECHARGE: "Recharge",
  BONUS: "Bonus",
  REDEEM: "Redeem",
  FREEPLAY: "Free Play",
};

export const SOURCE_LABELS: Record<TxSource, string> = {
  PAGE: "Page",
  PERSONAL: "Personal",
  WEB: "Web",
};

export const money = (v: number | string | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "yyyy-mm-dd" from a date input -> exact instants for the start / end of that local day. */
export function dayRangeParams(from: string, to: string, params: URLSearchParams) {
  if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
  if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
}

export function playerLabel(ug: { playerName: string | null; user: { username: string } | null }) {
  if (ug.user) return `@${ug.user.username}`;
  return ug.playerName || "—";
}
