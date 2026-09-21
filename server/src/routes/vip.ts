import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

export const vipRouter = Router();
vipRouter.use(requireAuth);

vipRouter.get("/", async (req: AuthedRequest, res) => {
  const [wallet, referralCount, tiers] = await Promise.all([
    prisma.wallet.findUnique({ where: { userId: req.userId! } }),
    prisma.user.count({ where: { referredById: req.userId! } }),
    prisma.vipTier.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  const totalDeposited = Number(wallet?.totalDeposited ?? 0);

  const qualifying = tiers.filter((t) => totalDeposited >= Number(t.minDeposit) && referralCount >= t.minReferrals);
  const currentTier = qualifying.length > 0 ? qualifying[qualifying.length - 1] : null;
  const currentIndex = currentTier ? tiers.findIndex((t) => t.id === currentTier.id) : -1;
  const nextTier = tiers[currentIndex + 1] || null;

  res.json({ currentTier, nextTier, tiers, totalDeposited, referralCount });
});
