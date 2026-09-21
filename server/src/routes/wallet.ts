import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { calcDepositBonus } from "../utils/bonus";
import { evaluateCashout } from "../utils/cashout";
import { getPlatformSettings } from "../lib/settings";

export const walletRouter = Router();
walletRouter.use(requireAuth);

walletRouter.get("/", async (req: AuthedRequest, res) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "Wallet not found." });
  res.json({ wallet });
});

walletRouter.get("/transactions", async (req: AuthedRequest, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ transactions });
});

const depositSchema = z.object({ amount: z.number().positive().max(1000000) });

// NOTE: this simulates a deposit landing (no real payment processor is wired up here).
walletRouter.post("/deposit", async (req: AuthedRequest, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid deposit amount." });
  const { amount } = parsed.data;

  const settings = await getPlatformSettings();
  if (amount < Number(settings.minDeposit) || amount > Number(settings.maxDeposit)) {
    return res.status(400).json({
      error: `Deposit must be between $${Number(settings.minDeposit).toFixed(2)} and $${Number(settings.maxDeposit).toFixed(2)}.`,
    });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "Wallet not found." });

  // Deposits are now a request, same as cashouts: nothing is credited until an admin
  // approves it (see server/src/routes/admin/deposits.ts). The bonus is computed now
  // (based on hasDeposited at request time) and stashed on the transaction so approval
  // doesn't need to re-derive it.
  const isFirstDeposit = !wallet.hasDeposited;
  const bonus = calcDepositBonus(amount, isFirstDeposit, settings);

  const transaction = await prisma.transaction.create({
    data: {
      userId: req.userId!,
      type: "DEPOSIT",
      amount,
      status: "PENDING",
      payoutAmount: bonus.amount,
      meta: { bonusKind: bonus.kind, bonusPercent: bonus.percent, isFirstDeposit },
    },
  });

  res.json({
    transaction,
    bonus,
    note: "Your deposit request is pending admin approval.",
  });
});

const cashoutSchema = z.object({
  amount: z.number().positive(),
  fromFreePlay: z.boolean().optional().default(false),
});

walletRouter.post("/cashout", async (req: AuthedRequest, res) => {
  const parsed = cashoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid cashout amount." });
  const { amount, fromFreePlay } = parsed.data;

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "Wallet not found." });

  const available = fromFreePlay ? Number(wallet.freePlay) : Number(wallet.balance);
  if (amount > available) {
    return res.status(400).json({ error: "Cashout amount exceeds available balance." });
  }

  const settings = await getPlatformSettings();
  const evaluation = evaluateCashout(amount, Number(wallet.lastDepositAmount), fromFreePlay, settings);
  if (!evaluation.eligible) {
    return res.status(400).json({ error: evaluation.reason });
  }

  // The full requested amount is held immediately (payout + forfeited both leave the
  // spendable balance) so the same funds can't be cashed out twice while pending review.
  // Approval just finalizes the hold; rejection refunds it.
  const result = await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({
      where: { userId: req.userId! },
      data: fromFreePlay
        ? { freePlay: { decrement: amount } }
        : { balance: { decrement: amount } },
    });
    const transaction = await tx.transaction.create({
      data: {
        userId: req.userId!,
        type: "CASHOUT",
        amount,
        status: "PENDING",
        payoutAmount: evaluation.payout,
        forfeitedAmount: evaluation.forfeited,
        meta: { fromFreePlay },
      },
    });
    return { wallet: w, transaction };
  });

  res.json({
    wallet: result.wallet,
    transaction: result.transaction,
    payout: evaluation.payout,
    forfeited: evaluation.forfeited,
    note:
      "Your cashout request is pending admin approval." +
      (evaluation.forfeited > 0
        ? " You requested more than your max cashout for this tier — the excess will be forfeited."
        : ""),
  });
});
