import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const adminGameAccountsRouter = Router();

adminGameAccountsRouter.get("/", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const gameId = typeof req.query.gameId === "string" ? req.query.gameId : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 25;

  const where: Prisma.UserGameWhereInput = {};
  if (gameId) where.gameId = gameId;
  if (search) {
    where.user = {
      OR: [
        { username: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const [accounts, total] = await Promise.all([
    prisma.userGame.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        game: { select: { id: true, name: true } },
      },
    }),
    prisma.userGame.count({ where }),
  ]);

  res.json({ accounts, total, page, pageSize });
});

// Aggregate balance per game — the read-only equivalent of "Games Balance" (no live
// third-party balance check, since that would require the automation layer this project
// doesn't implement — see README).
adminGameAccountsRouter.get("/balances", async (_req, res) => {
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
