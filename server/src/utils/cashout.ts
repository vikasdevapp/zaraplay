import type { PlatformSettings } from "../lib/settings";

export interface CashoutLimits {
  min: number;
  max: number | null; // null = unlimited
}

/**
 * Cashout tiers, keyed off the deposit amount that funded the balance being cashed out.
 * Boundary and multipliers come from Platform Rules (PlatformSettings):
 *  - below tier boundary's floor (min deposit)  -> not eligible for cashout
 *  - up to cashoutTierBoundary                  -> min = tier1Min x deposit, max = tier1Max x deposit
 *  - above cashoutTierBoundary                  -> min = tier2Min x deposit, max = unlimited
 */
export function getCashoutLimits(depositAmount: number, settings: PlatformSettings): CashoutLimits | null {
  const boundary = Number(settings.cashoutTierBoundary);
  const tier1Min = Number(settings.cashoutTier1MinMultiplier);
  const tier1Max = Number(settings.cashoutTier1MaxMultiplier);
  const tier2Min = Number(settings.cashoutTier2MinMultiplier);

  if (depositAmount <= 0) return null;
  if (depositAmount <= boundary) {
    return { min: depositAmount * tier1Min, max: depositAmount * tier1Max };
  }
  return { min: depositAmount * tier2Min, max: null };
}

export interface CashoutEvaluation {
  eligible: boolean;
  reason?: string;
  payout: number;
  forfeited: number;
}

/**
 * Evaluates a cashout request against the deposit-based tier. Requests above the tier max
 * are capped at the max and the remainder is reported as forfeited, matching the product's
 * "excess points are redeemed by the game" rule. Freeplay-funded cashouts are capped
 * separately at the freeplay cap regardless of deposit tier.
 */
export function evaluateCashout(
  requestedAmount: number,
  depositAmount: number,
  freeplayCapApplies: boolean,
  settings: PlatformSettings
): CashoutEvaluation {
  const limits = getCashoutLimits(depositAmount, settings);
  if (!limits) {
    return { eligible: false, reason: "Deposit amount too low to qualify for cashout.", payout: 0, forfeited: 0 };
  }
  if (requestedAmount < limits.min) {
    return {
      eligible: false,
      reason: `Minimum cashout for this deposit tier is $${limits.min.toFixed(2)}.`,
      payout: 0,
      forfeited: 0,
    };
  }
  if (requestedAmount < Number(settings.minWithdrawal)) {
    return {
      eligible: false,
      reason: `Minimum withdrawal is $${Number(settings.minWithdrawal).toFixed(2)}.`,
      payout: 0,
      forfeited: 0,
    };
  }

  let cap = limits.max ?? Infinity;
  cap = Math.min(cap, Number(settings.maxWithdrawal));
  if (freeplayCapApplies) cap = Math.min(cap, Number(settings.freeplayCashoutCap));

  const payout = Math.min(requestedAmount, cap);
  const forfeited = Math.max(0, requestedAmount - payout);

  return { eligible: true, payout, forfeited };
}
