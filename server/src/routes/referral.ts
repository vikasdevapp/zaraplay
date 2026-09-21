import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

export const referralRouter = Router();
referralRouter.use(requireAuth);

referralRouter.get("/", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { referralCode: true },
  });
  const referrals = await prisma.user.findMany({
    where: { referredById: req.userId! },
    select: { id: true, username: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const earned = await prisma.transaction.aggregate({
    where: { userId: req.userId!, type: "REFERRAL_BONUS" },
    _sum: { amount: true },
  });

  res.json({
    referralCode: user?.referralCode,
    referralCount: referrals.length,
    referrals,
    totalEarned: earned._sum.amount || 0,
  });
});
