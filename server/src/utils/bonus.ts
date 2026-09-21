import type { PlatformSettings } from "../lib/settings";

export type BonusKind = "SIGNUP_BONUS" | "WEEKEND_BONUS" | "DEPOSIT_BONUS";

export interface BonusResult {
  kind: BonusKind;
  percent: number;
  amount: number;
}

const isTuesday = (d: Date) => d.getDay() === 2;

/**
 * Which bonus applies to a given deposit, per the operator-configurable Platform Rules:
 *  - first-ever deposit: signupBonusPercent
 *  - any deposit on a Tuesday: weekendBonusPercent
 *  - otherwise: regularBonusPercent
 */
export function calcDepositBonus(depositAmount: number, isFirstDeposit: boolean, settings: PlatformSettings, now = new Date()): BonusResult {
  if (isFirstDeposit) {
    const percent = Number(settings.signupBonusPercent);
    return { kind: "SIGNUP_BONUS", percent, amount: depositAmount * (percent / 100) };
  }
  if (isTuesday(now)) {
    const percent = Number(settings.weekendBonusPercent);
    return { kind: "WEEKEND_BONUS", percent, amount: depositAmount * (percent / 100) };
  }
  const percent = Number(settings.regularBonusPercent);
  return { kind: "DEPOSIT_BONUS", percent, amount: depositAmount * (percent / 100) };
}

/** Referral bonus: referralBonusPercent of the referred user's first deposit, credited to the referrer. */
export function calcReferralBonus(referredUserFirstDepositAmount: number, settings: PlatformSettings): number {
  return referredUserFirstDepositAmount * (Number(settings.referralBonusPercent) / 100);
}
