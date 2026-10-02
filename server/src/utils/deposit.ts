import { Prisma, Transaction } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { calcReferralBonus } from "./bonus";
import { getPlatformSettings } from "../lib/settings";
import { autoLoadDeposit } from "../lib/gameAccounts";
import { tryAutoRecharge } from "../lib/gameAutomation";

// Credits a PENDING deposit (amount + stashed bonus + first-deposit referral) and marks it
// COMPLETED. Shared by admin approval and the payment gateway callback; the status flip is a
// conditional update inside the same DB transaction, so whichever caller loses a race gets
// null back and nothing is credited twice.
//
// paidCents: the gateway confirmed a different amount than was requested (e.g. an ecashapp
// user typing their own amount). The deposit is then credited at what was actually paid, with
// the bonus recomputed at the same percentage, and the requested amount kept in meta — all in
// the same DB transaction as the credit.
export async function completeDeposit(
  transactionId: string,
  extraMeta?: Prisma.JsonObject,
  opts: { paidCents?: number } = {}
): Promise<Transaction | null> {
  const settings = await getPlatformSettings();
  let gameLoadRequestId: string | null = null;

  const result = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction || transaction.type !== "DEPOSIT" || transaction.status !== "PENDING") return null;

    const meta = (transaction.meta as { bonusKind?: string; bonusPercent?: number; isFirstDeposit?: boolean; gameLoad?: { userGameId?: string } } | null) || {};
    let amount = Number(transaction.amount);
    let bonusAmount = Number(transaction.payoutAmount || 0);
    let settle: Prisma.JsonObject = {};
    if (opts.paidCents !== undefined) {
      const paid = Math.round(opts.paidCents) / 100;
      if (!Number.isFinite(paid) || paid <= 0) return null;
      if (paid !== amount) {
        settle = { requestedAmount: amount, settledAtPaidAmount: true };
        amount = paid;
        bonusAmount = Math.round(paid * (Number(meta.bonusPercent) || 0)) / 100;
      }
    }

    const claimed = await tx.transaction.updateMany({
      where: { id: transactionId, status: "PENDING" },
      data: {
        status: "COMPLETED",
        amount,
        payoutAmount: bonusAmount,
        meta: { ...((transaction.meta as Prisma.JsonObject) || {}), ...(extraMeta || {}), ...settle },
      },
    });
    if (claimed.count === 0) return null;

    const bonusKind = meta.bonusKind || "DEPOSIT_BONUS";

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

    // Deposited "for" a game: the whole credit (deposit + bonus) goes straight into a load request.
    if (meta.gameLoad?.userGameId) {
      const load = await autoLoadDeposit(tx, transaction.userId, meta.gameLoad.userGameId, amount + bonusAmount, transaction.id);
      if (load) gameLoadRequestId = load.id;
    }

    return tx.transaction.findUnique({ where: { id: transactionId } });
  });

  // Outside the DB transaction: if the game is automated, apply the load on the platform now.
  if (gameLoadRequestId) tryAutoRecharge(gameLoadRequestId).catch(() => {});
  return result;
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
