// Human-readable lines for staff audit-log entries (Agent Desk activity pages).

type Meta = Record<string, unknown> | null;

const m = (v: unknown) => `$${Number(v ?? 0).toFixed(2)}`;
const SOURCE: Record<string, string> = { PAGE: "Page", PERSONAL: "Personal", WEB: "Web" };

const LABELS: Record<string, (meta: Meta) => string> = {
  DESK_RECHARGE: (x) => `Recharge ${m(x?.amount)}${Number(x?.bonus) > 0 ? ` + ${m(x?.bonus)} bonus` : ""} · ${x?.gameUsername} · ${SOURCE[String(x?.source)] ?? ""}`,
  DESK_REDEEM: (x) => `Redeem ${m(x?.amount)} · ${x?.gameUsername} · ${SOURCE[String(x?.source)] ?? ""}`,
  DESK_FREEPLAY: (x) => `Free play ${m(x?.amount)} · ${x?.gameUsername} · ${SOURCE[String(x?.source)] ?? ""}`,
  DESK_ACCOUNT_CREATED: (x) => `Created game account ${x?.gameUsername ?? ""}`,
  DESK_BACKEND_TOPUP: (x) => `Backend top-up ${m(x?.amount)}`,
  DESK_BACKEND_BALANCE_SET: (x) => `Backend balance set ${m(x?.from)} → ${m(x?.to)}`,
  GAME_BALANCE_SYNCED: (x) => `Player balance updated ${m(x?.from)} → ${m(x?.to)}`,
  GAME_CREDENTIALS_UPDATED: () => "Game login edited",
  GAME_CREATE_ACCOUNT_COMPLETED: (x) => `Website account request done${Number(x?.amount) > 0 ? ` (loaded ${m(x?.amount)})` : ""}`,
  GAME_RECHARGE_COMPLETED: (x) => `Website load done ${m(x?.amount)}`,
  GAME_REDEEM_COMPLETED: (x) => `Website redeem done ${m(x?.redeemedAmount ?? x?.amount)}`,
  GAME_PASSWORD_RESET_COMPLETED: () => "Website password reset done",
};

export function describeActivity(action: string, meta: Meta) {
  const fn = LABELS[action];
  if (fn) return fn(meta);
  if (action.endsWith("_REJECTED")) return `Rejected ${action.replace(/^GAME_|_REJECTED$/g, "").replace(/_/g, " ").toLowerCase()} request${meta?.reason ? `: ${meta.reason}` : ""}`;
  return action.replace(/_/g, " ").toLowerCase();
}
