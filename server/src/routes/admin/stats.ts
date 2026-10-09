import { Router } from "express";
import { prisma } from "../../lib/prisma";

export const adminStatsRouter = Router();

adminStatsRouter.get("/", async (_req, res) => {
  const [
    totalUsers,
    activeGames,
    pendingCashouts,
    depositSum,
    payoutSum,
    walletLiabilitySum,
    withdrawableLiabilitySum,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.game.count({ where: { isActive: true } }),
    prisma.transaction.count({ where: { type: "CASHOUT", status: "PENDING" } }),
    prisma.transaction.aggregate({ where: { type: "DEPOSIT" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: "CASHOUT", status: "COMPLETED" }, _sum: { payoutAmount: true } }),
    prisma.wallet.aggregate({ _sum: { balance: true } }),
    prisma.wallet.aggregate({ _sum: { withdrawable: true } }),
  ]);

  res.json({
    totalUsers,
    activeGames,
    pendingCashouts,
    totalDeposited: depositSum._sum.amount || 0,
    totalPaidOut: payoutSum._sum.payoutAmount || 0,
    walletLiability: walletLiabilitySum._sum.balance || 0,
    // Money that is currently directly cashable (played through a game) — the real payout exposure.
    withdrawableLiability: withdrawableLiabilitySum._sum.withdrawable || 0,
  });
});
