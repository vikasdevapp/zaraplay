import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { calcReferralBonus } from "../../utils/bonus";
import { getPlatformSettings } from "../../lib/settings";

export const adminDepositsRouter = Router();

adminDepositsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "PENDING";
  const validStatuses = ["PENDING", "COMPLETED", "REJECTED"];
  const where = validStatuses.includes(status)
    ? { type: "DEPOSIT" as const, status: status as "PENDING" | "COMPLETED" | "REJECTED" }
    : { type: "DEPOSIT" as const };

  const deposits = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    include: { user: { select: { id: true, fullName: true, username: true, email: true } } },
  });
  res.json({ deposits });
});

adminDepositsRouter.post("/:id/approve", async (req: AuthedRequest, res) => {
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "DEPOSIT") return res.status(404).json({ error: "Deposit request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });

  const meta = (transaction.meta as { bonusKind?: string; isFirstDeposit?: boolean } | null) || {};
  const bonusAmount = Number(transaction.payoutAmount || 0);
  const bonusKind = meta.bonusKind || "DEPOSIT_BONUS";
  const isFirstDeposit = !!meta.isFirstDeposit;
  const amount = Number(transaction.amount);
  const settings = await getPlatformSettings();

  const updated = await prisma.$transaction(async (tx) => {
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

    if (isFirstDeposit) {
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

    return tx.transaction.update({ where: { id: transaction.id }, data: { status: "COMPLETED" } });
  });

  await logAudit(req.userId!, "DEPOSIT_APPROVED", { targetType: "Transaction", targetId: transaction.id, meta: { userId: transaction.userId, amount } });
  res.json({ transaction: updated });
});

const rejectSchema = z.object({ reason: z.string().max(200).optional() });

adminDepositsRouter.post("/:id/reject", async (req: AuthedRequest, res) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "DEPOSIT") return res.status(404).json({ error: "Deposit request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });

  const updated = await prisma.transaction.update({
    where: { id: transaction.id },
    data: { status: "REJECTED", adminNote: parsed.data.reason || null },
  });

  await logAudit(req.userId!, "DEPOSIT_REJECTED", { targetType: "Transaction", targetId: transaction.id, meta: { userId: transaction.userId, reason: parsed.data.reason } });
  res.json({ transaction: updated });
});
