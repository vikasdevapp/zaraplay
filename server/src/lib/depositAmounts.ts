/**
 * Fixed deposit amounts the payment gateway accepts, per method. Users pick one of these
 * (no free entry) so they never hit the gateway's "Not allowed amount" rejection.
 *
 * Keyed by wayCode. A method not listed here allows free entry within the platform min/max.
 * These mirror what GGUSOnePay accepts for the merchant — update here if the gateway changes
 * them. (Admin-editable storage can replace this later without touching callers.)
 */

const CASHAPP = [9.99, 14.99, 17.99, 19.99, 24.99, 29.99, 30.99, 39.99, 49.99, 59.99, 99.99, 124.99, 129.99, 149.99, 199.99, 249.99, 299.99, 399.99, 499.99];
const WALLET_PAY = [9.99, 14.99, 17.99, 19.99, 24.99, 29.99, 30.99, 39.99, 49.99, 59.99, 99.99, 124.99, 129.99, 149.99, 199.99];
const CHIME = [20, 25, 30, 31, 40, 50, 60, 100, 125, 130, 150, 200, 300, 400, 500];

export const DEPOSIT_AMOUNTS: Record<string, number[]> = {
  cashapp: CASHAPP,
  ecashapp: CASHAPP,
  applepay: WALLET_PAY,
  googlepay: WALLET_PAY,
  chime: CHIME,
};

/** The allowed amounts for a method, or null when the method takes any amount (min/max only). */
export function amountsFor(wayCode: string): number[] | null {
  return DEPOSIT_AMOUNTS[wayCode] ?? null;
}

/** Whether `amount` is allowed for `wayCode` (cent-exact match against the fixed list). */
export function isAllowedDepositAmount(wayCode: string, amount: number): boolean {
  const list = amountsFor(wayCode);
  if (!list) return true;
  const cents = Math.round(amount * 100);
  return list.some((a) => Math.round(a * 100) === cents);
}
