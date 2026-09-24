import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

function mergedMeta(meta: Prisma.JsonValue | null, extra?: Prisma.JsonObject) {
  return extra ? { meta: { ...((meta as Prisma.JsonObject) || {}), ...extra } } : {};
}

// Finalizes a PENDING cashout. The funds were already held when it was requested.
export async function completeCashout(transactionId: string, extraMeta?: Prisma.JsonObject) {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.type !== "CASHOUT" || transaction.status !== "PENDING") return null;
  const res = await prisma.transaction.updateMany({
    where: { id: transactionId, status: "PENDING" },
    data: { status: "COMPLETED", ...mergedMeta(transaction.meta, extraMeta) },
  });
  return res.count ? prisma.transaction.findUnique({ where: { id: transactionId } }) : null;
}

// Rejects a PENDING cashout and returns the held amount to the wallet it came from.
// onlyIfUnclaimed: manual rejects must not refund a payout already handed to the gateway.
export async function refundCashout(
  transactionId: string,
  note: string | null,
  extraMeta?: Prisma.JsonObject,
  opts: { onlyIfUnclaimed?: boolean } = {}
) {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction || transaction.type !== "CASHOUT" || transaction.status !== "PENDING") return null;

    const claimed = await tx.transaction.updateMany({
      where: { id: transactionId, status: "PENDING", ...(opts.onlyIfUnclaimed ? { gatewayProvider: null } : {}) },
      data: { status: "REJECTED", adminNote: note, ...mergedMeta(transaction.meta, extraMeta) },
    });
    if (claimed.count === 0) return null;

    const fromFreePlay = (transaction.meta as { fromFreePlay?: boolean } | null)?.fromFreePlay ?? false;
    await tx.wallet.update({
      where: { userId: transaction.userId },
      data: fromFreePlay ? { freePlay: { increment: transaction.amount } } : { balance: { increment: transaction.amount } },
    });
    return tx.transaction.findUnique({ where: { id: transactionId } });
  });
}
