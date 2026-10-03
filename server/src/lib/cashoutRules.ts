import type { PlatformSettings } from "./settings";

/**
 * Cashout tiers for withdrawing winnings OUT of a game account, per the operator's rules:
 *  - the tier boundary is the funding deposit (recharge) amount
 *  - the min / max multipliers apply to the TOTAL that was loaded (deposit + bonus)
 *
 * Defaults (from Platform Rules): boundary $35; deposit $5–35 -> min 5x, max 10x total;
 * deposit > $35 -> min 3x total, max unlimited.
 */

export interface CashoutLimits {
  min: number;
  max: number | null; // null = no maximum
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function gameCashoutLimits(loadDeposit: number, loadTotal: number, settings: PlatformSettings): CashoutLimits | null {
  if (loadDeposit <= 0 || loadTotal <= 0) return null;
  const boundary = Number(settings.cashoutTierBoundary);
  const t1min = Number(settings.cashoutTier1MinMultiplier);
  const t1max = Number(settings.cashoutTier1MaxMultiplier);
  const t2min = Number(settings.cashoutTier2MinMultiplier);
  if (loadDeposit <= boundary) return { min: r2(t1min * loadTotal), max: r2(t1max * loadTotal) };
  return { min: r2(t2min * loadTotal), max: null };
}

export interface WithdrawSettlement {
  eligible: boolean;
  reason?: string;
  min: number;
  max: number | null;
  payout: number; // credited to the wallet
  forfeit: number; // above the cap, kept by the house
  leftover: number; // stays in the game and becomes the new load basis
}

/**
 * Settles a withdrawal of `requested` from a game balance of `balance`. Anything above the
 * tier cap is forfeited; whatever is within the cap but not withdrawn stays in the game and
 * becomes the new load basis (re-tiered on the next withdrawal).
 */
export function settleWithdraw(loadDeposit: number, loadTotal: number, balance: number, requested: number, settings: PlatformSettings): WithdrawSettlement {
  const limits = gameCashoutLimits(loadDeposit, loadTotal, settings);
  const base = { payout: 0, forfeit: 0, leftover: r2(balance) };
  if (!limits) return { eligible: false, reason: "This game has no active load to withdraw against.", min: 0, max: null, ...base };
  if (balance < limits.min) {
    return {
      eligible: false,
      reason: `Keep playing — you need at least $${limits.min.toFixed(2)} in the game to withdraw (you have $${r2(balance).toFixed(2)}).`,
      min: limits.min,
      max: limits.max,
      ...base,
    };
  }
  if (requested < limits.min) {
    return { eligible: false, reason: `Minimum withdrawal is $${limits.min.toFixed(2)}.`, min: limits.min, max: limits.max, ...base };
  }
  const cap = limits.max ?? Infinity;
  const effective = Math.min(requested, balance);
  const payout = r2(Math.min(effective, cap));
  const forfeit = r2(Math.max(0, balance - cap));
  const leftover = r2(Math.min(balance, cap) - payout);
  return { eligible: true, min: limits.min, max: limits.max, payout, forfeit, leftover };
}
