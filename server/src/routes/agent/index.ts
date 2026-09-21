import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../../middleware/auth";

export const agentRouter = Router();

// AGENT is the day-to-day operations role; ADMIN/MASTER_ADMIN can also view this dashboard.
agentRouter.use(requireAuth, requireRole("AGENT", "ADMIN", "MASTER_ADMIN"));

agentRouter.get("/stats", async (_req, res) => {
  const [gameAccountCount, pendingCashouts, gameBalanceSum] = await Promise.all([
    prisma.userGame.count(),
    prisma.transaction.count({ where: { type: "CASHOUT", status: "PENDING" } }),
    prisma.userGame.aggregate({ _sum: { balance: true } }),
  ]);
  res.json({
    gameAccountCount,
    pendingCashouts,
    totalGameBalance: gameBalanceSum._sum.balance || 0,
  });
});

// "Game Balances" — aggregate balance per game, mirrors the reference's provider-balance
// screen but reads our own stored data only (no live third-party balance check).
agentRouter.get("/game-balances", async (_req, res) => {
  const rows = await prisma.userGame.groupBy({
    by: ["gameId"],
    _sum: { balance: true },
    _count: { _all: true },
  });
  const games = await prisma.game.findMany({ where: { id: { in: rows.map((r) => r.gameId) } } });
  const gameById = new Map(games.map((g) => [g.id, g]));
  res.json({
    balances: rows.map((r) => ({
      game: gameById.get(r.gameId),
      totalBalance: r._sum.balance || 0,
      accountCount: r._count._all,
    })),
  });
});

// "Game Records" — every player's per-game account, searchable.
agentRouter.get("/game-records", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where: Prisma.UserGameWhereInput = search
    ? { user: { OR: [{ username: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] } }
    : {};

  const accounts = await prisma.userGame.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, fullName: true, username: true } },
      game: { select: { id: true, name: true } },
    },
  });
  res.json({ accounts });
});

// "Recharge Ledger" — our own recharge (deposit) / redeem (cashout) transaction ledger.
agentRouter.get("/ledger", async (req, res) => {
  const type = req.query.type === "REDEEM" ? "CASHOUT" : "DEPOSIT";
  const transactions = await prisma.transaction.findMany({
    where: { type },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, fullName: true, username: true } } },
  });
  res.json({ transactions });
});

// An agent's own recent actions (their slice of the audit log).
agentRouter.get("/activity", async (req: AuthedRequest, res) => {
  const logs = await prisma.auditLog.findMany({
    where: { actorId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ logs });
});
