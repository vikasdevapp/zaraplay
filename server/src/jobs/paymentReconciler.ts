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
  // Separate batches so slow payouts can't crowd out deposits; mismatched deposits are
  // waiting on an admin and would otherwise clog the batch forever.
  // (Filtered in code: a JSON-path NOT in SQL also drops rows that lack the key entirely.)
  const [depositCandidates, cashouts] = await Promise.all([
    prisma.transaction.findMany({ where: { ...base, type: "DEPOSIT" }, orderBy: { createdAt: "asc" }, take: BATCH * 4 }),
    prisma.transaction.findMany({ where: { ...base, type: "CASHOUT" }, orderBy: { createdAt: "asc" }, take: BATCH }),
  ]);
  const deposits = depositCandidates
    .filter((t) => !(t.meta as { amountMismatch?: boolean } | null)?.amountMismatch)
    .slice(0, BATCH);

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
