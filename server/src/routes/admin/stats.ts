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
    freePlayLiabilitySum,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.game.count({ where: { isActive: true } }),
    prisma.transaction.count({ where: { type: "CASHOUT", status: "PENDING" } }),
    prisma.transaction.aggregate({ where: { type: "DEPOSIT" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { type: "CASHOUT", status: "COMPLETED" }, _sum: { payoutAmount: true } }),
    prisma.wallet.aggregate({ _sum: { balance: true } }),
    prisma.wallet.aggregate({ _sum: { freePlay: true } }),
  ]);

  res.json({
    totalUsers,
    activeGames,
    pendingCashouts,
    totalDeposited: depositSum._sum.amount || 0,
    totalPaidOut: payoutSum._sum.payoutAmount || 0,
    walletLiability: walletLiabilitySum._sum.balance || 0,
    freePlayLiability: freePlayLiabilitySum._sum.freePlay || 0,
  });
});
