import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { deskRouter } from "./desk";
import { executeAutoWithdraw, isAutomated } from "../../lib/gameAutomation";
import { JuwaError } from "../../lib/juwa";
import { GameError, claimRequest, completeRequest, rejectRequest, releaseRequest, syncBalance, updateCredentials } from "../../lib/gameAccounts";

export const agentRouter = Router();

// AGENT is the day-to-day operations role; ADMIN/MASTER_ADMIN can also work this dashboard.
agentRouter.use(requireAuth, requireRole("AGENT", "ADMIN", "MASTER_ADMIN"));

agentRouter.use("/desk", deskRouter);

const actorOf = (req: AuthedRequest) => ({ id: req.userId!, role: req.role! });

function sendError(res: Response, err: unknown) {
  if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
  throw err;
}

agentRouter.get("/stats", async (req: AuthedRequest, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [gameAccountCount, gameBalanceSum, pendingByType, mine, doneToday, pendingCashouts] = await Promise.all([
    prisma.userGame.count({ where: { status: "ACTIVE" } }),
    prisma.userGame.aggregate({ where: { status: "ACTIVE" }, _sum: { balance: true } }),
    prisma.gameRequest.groupBy({ by: ["type"], where: { status: "PENDING" }, _count: { _all: true } }),
    prisma.gameRequest.count({ where: { status: "PENDING", claimedById: req.userId! } }),
    prisma.gameRequest.count({ where: { handledById: req.userId!, completedAt: { gte: startOfToday } } }),
    prisma.transaction.count({ where: { type: "CASHOUT", status: "PENDING" } }),
  ]);
  const pending = Object.fromEntries(pendingByType.map((r) => [r.type, r._count._all]));
  res.json({
    gameAccountCount,
    totalGameBalance: gameBalanceSum._sum.balance || 0,
    pendingRequests: pendingByType.reduce((n, r) => n + r._count._all, 0),
    pendingByType: pending,
    myOpenRequests: mine,
    handledToday: doneToday,
    pendingCashouts,
  });
});

// ------------------------------------------------------------------------------------------
// Request queue
// ------------------------------------------------------------------------------------------

const requestInclude = {
  user: { select: { id: true, fullName: true, username: true, email: true } },
  userGame: {
    select: {
      id: true,
      status: true,
      gameUsername: true,
      gamePassword: true,
      balance: true,
      balanceSyncedAt: true,
      game: { select: { id: true, name: true, imageUrl: true } },
    },
  },
  claimedBy: { select: { id: true, username: true } },
  handledBy: { select: { id: true, username: true } },
} satisfies Prisma.GameRequestInclude;

agentRouter.get("/requests", async (req: AuthedRequest, res) => {
  const status = ["PENDING", "COMPLETED", "REJECTED", "CANCELLED"].includes(String(req.query.status)) ? String(req.query.status) : "PENDING";
  const type = ["CREATE_ACCOUNT", "RECHARGE", "REDEEM", "PASSWORD_RESET", "BALANCE_CHECK"].includes(String(req.query.type)) ? String(req.query.type) : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  const where: Prisma.GameRequestWhereInput = {
    status: status as Prisma.EnumGameRequestStatusFilter["equals"],
    ...(type ? { type: type as Prisma.EnumGameRequestTypeFilter["equals"] } : {}),
    ...(req.query.mine === "1" ? { claimedById: req.userId! } : {}),
    ...(search
      ? {
          OR: [
            { user: { username: { contains: search, mode: "insensitive" } } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            { userGame: { gameUsername: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const requests = await prisma.gameRequest.findMany({
    where,
    // Oldest first while waiting (first come, first served); newest first once finished.
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    include: requestInclude,
  });
  res.json({ requests });
});

agentRouter.post("/requests/:id/claim", async (req: AuthedRequest, res) => {
  try {
    await claimRequest(req.params.id, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

agentRouter.post("/requests/:id/release", async (req: AuthedRequest, res) => {
  try {
    await releaseRequest(req.params.id, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

const completeSchema = z.object({
  gameUsername: z.string().max(100).optional(),
  gamePassword: z.string().max(100).optional(),
  redeemedAmount: z.number().finite().optional(),
  remainingBalance: z.number().finite().optional(),
  balance: z.number().finite().optional(),
  note: z.string().max(300).optional(),
});

agentRouter.post("/requests/:id/complete", async (req: AuthedRequest, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });
  try {
    const input = { ...parsed.data };
    // Approving a redeem on an automated game (and no manual amounts entered): pull the money
    // out through the platform API, then record what actually came out.
    if (input.redeemedAmount === undefined) {
      const pending = await prisma.gameRequest.findUnique({ where: { id: req.params.id }, include: { userGame: { include: { game: true } } } });
      if (pending?.type === "REDEEM" && pending.status === "PENDING" && isAutomated(pending.userGame.game)) {
        try {
          const out = await executeAutoWithdraw(pending, pending.userGame);
          if (out.payout <= 0) return res.status(400).json({ error: `The player's game balance is $${out.realBalance.toFixed(2)} — nothing to redeem.` });
          input.redeemedAmount = out.payout;
          input.remainingBalance = Math.round((out.realBalance - out.payout) * 100) / 100;
        } catch (err) {
          const msg = err instanceof JuwaError ? err.message : "the game platform could not be reached";
          return res.status(502).json({ error: `Automatic redeem failed (${msg}). Do it on the platform and enter the amounts manually.`, manualFallback: true });
        }
      }
    }
    const request = await completeRequest(req.params.id, actorOf(req), input);
    await logAudit(req.userId!, `GAME_${request.type}_COMPLETED`, {
      targetType: "GameRequest",
      targetId: request.id,
      meta: {
        userId: request.userId,
        amount: Number(request.amount),
        ...(input.redeemedAmount !== undefined ? { redeemedAmount: input.redeemedAmount, remainingBalance: input.remainingBalance } : {}),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

const rejectSchema = z.object({ reason: z.string().min(1, "Give a reason.").max(300) });

agentRouter.post("/requests/:id/reject", async (req: AuthedRequest, res) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Tell the player why this request was rejected." });
  try {
    const request = await rejectRequest(req.params.id, actorOf(req), parsed.data.reason);
    await logAudit(req.userId!, `GAME_${request.type}_REJECTED`, {
      targetType: "GameRequest",
      targetId: request.id,
      meta: { userId: request.userId, amount: Number(request.amount), reason: parsed.data.reason },
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// ------------------------------------------------------------------------------------------
// Game accounts
// ------------------------------------------------------------------------------------------

// "Game Balances": total recorded balance per game across active accounts.
agentRouter.get("/game-balances", async (_req, res) => {
  const rows = await prisma.userGame.groupBy({
    by: ["gameId"],
    where: { status: "ACTIVE" },
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

// "Game Records": every player's game account with its login, searchable.
agentRouter.get("/game-records", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where: Prisma.UserGameWhereInput = {
    status: { in: ["ACTIVE", "PENDING"] },
    ...(search
      ? {
          OR: [
            { user: { username: { contains: search, mode: "insensitive" } } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            { gameUsername: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const accounts = await prisma.userGame.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, fullName: true, username: true } },
      game: { select: { id: true, name: true } },
      balanceSyncedBy: { select: { username: true } },
    },
  });
  res.json({ accounts });
});

const balanceSchema = z.object({ balance: z.number().finite() });

agentRouter.post("/game-accounts/:id/balance", async (req: AuthedRequest, res) => {
  const parsed = balanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid balance." });
  try {
    const before = await prisma.userGame.findUnique({ where: { id: req.params.id }, select: { balance: true, userId: true } });
    await syncBalance(req.params.id, actorOf(req), parsed.data.balance);
    await logAudit(req.userId!, "GAME_BALANCE_SYNCED", {
      targetType: "UserGame",
      targetId: req.params.id,
      meta: { userId: before?.userId, from: Number(before?.balance ?? 0), to: parsed.data.balance },
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

const credentialsSchema = z.object({ gameUsername: z.string().min(1).max(100), gamePassword: z.string().min(1).max(100) });

agentRouter.put("/game-accounts/:id/credentials", async (req: AuthedRequest, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Username and password are required." });
  try {
    await updateCredentials(req.params.id, parsed.data.gameUsername, parsed.data.gamePassword);
    await logAudit(req.userId!, "GAME_CREDENTIALS_UPDATED", { targetType: "UserGame", targetId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

// ------------------------------------------------------------------------------------------
// Ledger and activity
// ------------------------------------------------------------------------------------------

// "Recharge Ledger": wallet deposits/cashouts, or game loads/redeems.
agentRouter.get("/ledger", async (req, res) => {
  const map: Record<string, Prisma.TransactionWhereInput["type"]> = {
    DEPOSIT: "DEPOSIT",
    REDEEM: "CASHOUT",
    GAME_RECHARGE: "GAME_RECHARGE",
    GAME_REDEEM: "GAME_REDEEM",
  };
  const type = map[String(req.query.type)] ?? "DEPOSIT";
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
