import { redis } from "./redis";
import { verifyCode } from "./totp";

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 10 * 60;

export type TwoFactorResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Checks a staff member's 2FA code at sign-in (and when they turn 2FA off). Wrong codes are
 * capped per account so the 6 digits can't be brute-forced, and each code's time-step can be
 * used once, so a code seen over someone's shoulder can't be replayed.
 */
export async function checkTwoFactor(userId: string, secret: string, code: string | undefined): Promise<TwoFactorResult> {
  const failKey = `2fa:fail:${userId}`;
  const failures = Number(await redis.get(failKey)) || 0;
  if (failures >= MAX_FAILURES) {
    return { ok: false, status: 429, error: "Too many wrong codes. Wait 10 minutes and try again." };
  }
  if (!code) return { ok: false, status: 401, error: "Enter the 6-digit code from your authenticator app." };

  const step = verifyCode(secret, code);
  if (step !== null) {
    // NX: only the first use of this time-step succeeds.
    const fresh = await redis.set(`2fa:used:${userId}:${step}`, "1", "EX", 120, "NX");
    if (fresh) {
      await redis.del(failKey);
      return { ok: true };
    }
  }
  const n = await redis.incr(failKey);
  if (n === 1) await redis.expire(failKey, WINDOW_SECONDS);
  return { ok: false, status: 401, error: step !== null ? "That code was already used. Wait for the next one." : "Invalid 2FA code." };
}
