import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const leaderboardRouter = Router();
leaderboardRouter.use(requireAuth);

// Ranks players by lifetime deposits — a standard "top players" leaderboard. Only username
// and rank are exposed, never email/full name, since this is visible to every logged-in user.
leaderboardRouter.get("/", async (req: AuthedRequest, res) => {
  const top = await prisma.wallet.findMany({
    where: { totalDeposited: { gt: 0 } },
    orderBy: { totalDeposited: "desc" },
    take: 20,
    include: { user: { select: { id: true, username: true } } },
  });

  const entries = top.map((w, i) => ({
    rank: i + 1,
    userId: w.user.id,
    username: w.user.username,
    totalDeposited: w.totalDeposited,
    isMe: w.user.id === req.userId,
  }));

  res.json({ entries });
});
