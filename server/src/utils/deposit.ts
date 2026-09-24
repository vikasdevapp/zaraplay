import { Prisma, Transaction } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { calcReferralBonus } from "./bonus";
import { getPlatformSettings } from "../lib/settings";

// Credits a PENDING deposit (amount + stashed bonus + first-deposit referral) and marks it
// COMPLETED. Shared by admin approval and the payment gateway callback; the status flip is a
// conditional update inside the same DB transaction, so whichever caller loses a race gets
// null back and nothing is credited twice.
export async function completeDeposit(transactionId: string, extraMeta?: Prisma.JsonObject): Promise<Transaction | null> {
  const settings = await getPlatformSettings();

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction || transaction.type !== "DEPOSIT" || transaction.status !== "PENDING") return null;

    const claimed = await tx.transaction.updateMany({
      where: { id: transactionId, status: "PENDING" },
      data: {
        status: "COMPLETED",
        ...(extraMeta ? { meta: { ...((transaction.meta as Prisma.JsonObject) || {}), ...extraMeta } } : {}),
      },
    });
    if (claimed.count === 0) return null;

    const meta = (transaction.meta as { bonusKind?: string; isFirstDeposit?: boolean } | null) || {};
    const bonusAmount = Number(transaction.payoutAmount || 0);
    const bonusKind = meta.bonusKind || "DEPOSIT_BONUS";
    const amount = Number(transaction.amount);

    await tx.wallet.update({
      where: { userId: transaction.userId },
      data: {
        balance: { increment: amount + bonusAmount },
        totalDeposited: { increment: amount },
        lastDepositAmount: amount,
        hasDeposited: true,
      },
    });

    await tx.transaction.create({
      data: {
        userId: transaction.userId,
        type: bonusKind as "SIGNUP_BONUS" | "WEEKEND_BONUS" | "DEPOSIT_BONUS",
        amount: bonusAmount,
        status: "COMPLETED",
        meta: { fromDepositId: transaction.id },
      },
    });

    if (meta.isFirstDeposit) {
      const depositor = await tx.user.findUnique({ where: { id: transaction.userId }, select: { referredById: true } });
      if (depositor?.referredById) {
        const referralAmount = calcReferralBonus(amount, settings);
        await tx.wallet.update({
          where: { userId: depositor.referredById },
          data: { balance: { increment: referralAmount } },
        });
        await tx.transaction.create({
          data: {
            userId: depositor.referredById,
            type: "REFERRAL_BONUS",
            amount: referralAmount,
            status: "COMPLETED",
            meta: { fromUserId: transaction.userId },
          },
        });
      }
    }

    return tx.transaction.findUnique({ where: { id: transactionId } });
  });
}

// Marks a PENDING deposit REJECTED (nothing was credited, so nothing to undo).
export async function rejectDeposit(transactionId: string, note: string | null, extraMeta?: Prisma.JsonObject) {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction || transaction.type !== "DEPOSIT" || transaction.status !== "PENDING") return null;
  const res = await prisma.transaction.updateMany({
    where: { id: transactionId, status: "PENDING" },
    data: {
      status: "REJECTED",
      adminNote: note,
      ...(extraMeta ? { meta: { ...((transaction.meta as Prisma.JsonObject) || {}), ...extraMeta } } : {}),
    },
  });
  return res.count ? prisma.transaction.findUnique({ where: { id: transactionId } }) : null;
}
