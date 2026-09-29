import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { gateway } from "../lib/ggusonepay";
import { PROVIDER, syncCashout, syncDeposit } from "../lib/paymentSync";

// The gateway only calls back on *successful* payments, so abandoned deposits would sit in
// PENDING forever, and a missed callback would leave a paid order uncredited. This sweep
// re-checks open gateway orders with the query API and closes deposits past their expiry.

const INTERVAL_MS = 2 * 60_000;
const MIN_AGE_MS = 3 * 60_000; // give the normal callback a chance first
const BATCH = 50;
const LOCK_KEY = "lock:payment-reconciler";

export async function reconcileOnce() {
  // One sweep at a time across all API instances.
  const locked = await redis.set(LOCK_KEY, "1", "PX", INTERVAL_MS - 5_000, "NX");
  if (!locked) return;

  const olderThan = new Date(Date.now() - MIN_AGE_MS);
  const base = { gatewayProvider: PROVIDER, status: "PENDING" as const, createdAt: { lt: olderThan } };
  // Separate batches so slow payouts can't crowd out deposits. Paid deposits (whatever the
  // amount) are credited by syncDeposit, so nothing waits on an admin here.
  const [deposits, cashouts] = await Promise.all([
    prisma.transaction.findMany({ where: { ...base, type: "DEPOSIT" }, orderBy: { createdAt: "asc" }, take: BATCH }),
    prisma.transaction.findMany({ where: { ...base, type: "CASHOUT" }, orderBy: { createdAt: "asc" }, take: BATCH }),
  ]);

  for (const transaction of [...deposits, ...cashouts]) {
    try {
      if (transaction.type === "DEPOSIT") await syncDeposit(transaction, { closeIfExpired: true });
      else if (transaction.type === "CASHOUT") await syncCashout(transaction);
    } catch (err) {
      console.error(`[ggusonepay] reconcile failed for ${transaction.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

export function startPaymentReconciler() {
  if (!gateway.payEnabled && !gateway.transferEnabled) return;
  const run = () => reconcileOnce().catch((err) => console.error("[ggusonepay] reconcile sweep failed", err));
  setInterval(run, INTERVAL_MS).unref();
  setTimeout(run, 15_000).unref();
  console.log("Payment reconciler started");
}
