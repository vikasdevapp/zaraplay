import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { deskRouter } from "./desk";
import { agentStaffRouter } from "./staff";
import { agentSupportRouter } from "./support";
import { agentPlayersRouter } from "./players";
import { makeCashoutsRouter } from "../admin/cashouts";
import { relinkGameUserId } from "../../lib/gameAutomation";
import { scopedGameIds, gameIdWhere, nestedGameIdWhere, playerInScopeWhere } from "../../lib/gameScope";
import { GameError, claimRequest, completeRequest, rejectRequest, releaseRequest, syncBalance, updateCredentials } from "../../lib/gameAccounts";

export const agentRouter = Router();

// AGENT and per-game SUPPORT staff work this dashboard, each limited to their own games; ADMIN /
// MASTER_ADMIN see everything.
agentRouter.use(requireAuth, requireRole("AGENT", "SUPPORT", "ADMIN", "MASTER_ADMIN"));

// Compute the actor's game scope once per request (null = all games, for admins).
agentRouter.use(async (req: AuthedRequest, _res, next) => {
  try {
    req.scopeGameIds = await scopedGameIds({ id: req.userId!, role: req.role! });
    next();
  } catch (err) {
    next(err);
  }
});

agentRouter.use("/desk", deskRouter);
// An agent running their own per-game support staff (AGENT only — enforced inside).
agentRouter.use("/staff", agentStaffRouter);
// Cashouts for the actor's games only (same logic as the admin panel, scoped by the middleware).
agentRouter.use("/cashouts", makeCashoutsRouter());
// Per-game support inbox (scoped to the chat personas of the actor's games).
agentRouter.use("/support", agentSupportRouter);
// Warn / block players in the actor's games.
agentRouter.use("/players", agentPlayersRouter);

const actorOf = (req: AuthedRequest) => ({ id: req.userId!, role: req.role! });

function sendError(res: Response, err: unknown) {
  if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
  throw err;
}

// Non-admins (agents / support staff) may only act on requests and accounts whose game is in
// their scope. Admins (scope === null) pass straight through.
async function assertRequestInScope(req: AuthedRequest, requestId: string) {
  const scope = req.scopeGameIds ?? null;
  if (scope === null) return;
  const found = await prisma.gameRequest.findFirst({ where: { id: requestId, userGame: { gameId: { in: scope } } }, select: { id: true } });
  if (!found) throw new GameError(403, "This request isn't for one of your games.");
}
async function assertAccountInScope(req: AuthedRequest, userGameId: string) {
  const scope = req.scopeGameIds ?? null;
  if (scope === null) return;
  const found = await prisma.userGame.findFirst({ where: { id: userGameId, gameId: { in: scope } }, select: { id: true } });
  if (!found) throw new GameError(403, "This account isn't for one of your games.");
}

agentRouter.get("/stats", async (req: AuthedRequest, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const scope = req.scopeGameIds ?? null;
  const ugScope = gameIdWhere(scope); // { gameId: { in } } on UserGame
  const reqScope = nestedGameIdWhere("userGame", scope); // { userGame: { gameId: { in } } } on GameRequest
  const [gameAccountCount, gameBalanceSum, pendingByType, mine, doneToday, pendingCashouts, supportNew] = await Promise.all([
    prisma.userGame.count({ where: { status: "ACTIVE", ...ugScope } }),
    prisma.userGame.aggregate({ where: { status: "ACTIVE", ...ugScope }, _sum: { balance: true } }),
    prisma.gameRequest.groupBy({ by: ["type"], where: { status: "PENDING", ...reqScope }, _count: { _all: true } }),
    prisma.gameRequest.count({ where: { status: "PENDING", claimedById: req.userId!, ...reqScope } }),
    prisma.gameRequest.count({ where: { handledById: req.userId!, completedAt: { gte: startOfToday }, ...reqScope } }),
    prisma.transaction.count({ where: { type: "CASHOUT", status: "PENDING", ...playerInScopeWhere(scope) } }),
    // Support tickets awaiting a first reply, for the Support nav badge.
    prisma.supportTicket.count({ where: { status: "NEW", ...gameIdWhere(scope) } }),
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
    supportNew,
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
    ...nestedGameIdWhere("userGame", req.scopeGameIds ?? null),
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
    await assertRequestInScope(req, req.params.id);
    await claimRequest(req.params.id, actorOf(req));
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

agentRouter.post("/requests/:id/release", async (req: AuthedRequest, res) => {
  try {
    await assertRequestInScope(req, req.params.id);
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
    await assertRequestInScope(req, req.params.id);
    const input = { ...parsed.data };
    // Redeems on automated games are settled instantly for the player (see autoWithdrawFromGame);
    // anything that reaches this queue is either a manual game or a redeem that fell back because
    // the platform was unreachable, so the agent completes it by entering the amounts.
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
    await assertRequestInScope(req, req.params.id);
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
agentRouter.get("/game-balances", async (req: AuthedRequest, res) => {
  const rows = await prisma.userGame.groupBy({
    by: ["gameId"],
    where: { status: "ACTIVE", ...gameIdWhere(req.scopeGameIds ?? null) },
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
agentRouter.get("/game-records", async (req: AuthedRequest, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const where: Prisma.UserGameWhereInput = {
    status: { in: ["ACTIVE", "PENDING"] },
    ...gameIdWhere(req.scopeGameIds ?? null),
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
    await assertAccountInScope(req, req.params.id);
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
    await assertAccountInScope(req, req.params.id);
    await updateCredentials(req.params.id, parsed.data.gameUsername, parsed.data.gamePassword);
    // Point automation at the (possibly existing) platform account this login belongs to.
    const relink = await relinkGameUserId(req.params.id);
    await logAudit(req.userId!, "GAME_CREDENTIALS_UPDATED", { targetType: "UserGame", targetId: req.params.id, meta: { relinked: relink.linked } });
    res.json({ ok: true, ...relink });
  } catch (err) {
    sendError(res, err);
  }
});

// ------------------------------------------------------------------------------------------
// Ledger and activity
// ------------------------------------------------------------------------------------------

// "Recharge Ledger": wallet deposits/cashouts, or game loads/redeems.
agentRouter.get("/ledger", async (req: AuthedRequest, res) => {
  const map: Record<string, Prisma.TransactionWhereInput["type"]> = {
    DEPOSIT: "DEPOSIT",
    REDEEM: "CASHOUT",
    GAME_RECHARGE: "GAME_RECHARGE",
    GAME_REDEEM: "GAME_REDEEM",
  };
  const type = map[String(req.query.type)] ?? "DEPOSIT";
  const transactions = await prisma.transaction.findMany({
    // Wallet rows aren't game-tagged; limit non-admins to players who have a game in their scope.
    where: { type, ...playerInScopeWhere(req.scopeGameIds ?? null) },
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
