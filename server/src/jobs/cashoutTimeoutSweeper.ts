import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { refundCashout } from "../utils/payout";
import { notifyUser } from "../lib/webpush";

const INTERVAL_MS = 60_000; // Check every 1 minute
const TIMEOUT_MS = 60 * 60_000; // 1 hour timeout
const LOCK_KEY = "lock:cashout-timeout-sweeper";

export async function sweepExpiredCashouts() {
  const locked = await redis.set(LOCK_KEY, "1", "PX", INTERVAL_MS - 5_000, "NX");
  if (!locked) return;

  const expiredBefore = new Date(Date.now() - TIMEOUT_MS);

  // Find all PENDING cashout requests older than 1 hour, that are not yet handed over to a payment gateway
  const expiredCashouts = await prisma.transaction.findMany({
    where: {
      type: "CASHOUT",
      status: "PENDING",
      gatewayProvider: null,
      createdAt: { lt: expiredBefore },
    },
    take: 50,
  });

  for (const cashout of expiredCashouts) {
    try {
      const updated = await refundCashout(
        cashout.id,
        "Auto-rejected: Not approved by admin within 1 hour.",
        { autoRejected: true },
        { onlyIfUnclaimed: true }
      );

      if (updated) {
        // Send push notification to user
        await notifyUser(cashout.userId, {
          title: "Withdrawal Status",
          body: "Withdraw failed please try again",
          kind: "WALLET",
          link: "/wallet",
        });
      }
    } catch (err) {
      console.error(`Failed to auto-reject cashout ${cashout.id}:`, err);
    }
  }
}

export function startCashoutTimeoutSweeper() {
  const run = () => sweepExpiredCashouts().catch((err) => console.error("Cashout timeout sweeper error:", err));
  setInterval(run, INTERVAL_MS).unref();
  setTimeout(run, 5_000).unref();
  console.log("Cashout 1-hour timeout sweeper started");
}
