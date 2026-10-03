import { Router, Response } from "express";
import { GameTxType, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireRole } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { GameError } from "../../lib/gameAccounts";
import { createManualAccount, createManualTransaction, lookupAccount, setBackendBalance, topUpBackend } from "../../lib/gameDesk";
import { gameIdWhere, ownGameWhere, effectiveGameWhere } from "../../lib/gameScope";

// Agent Desk: the manual game-distributor panel (mounted under /api/agent/desk, so it already
// requires an AGENT / ADMIN / MASTER_ADMIN session).
export const deskRouter = Router();

const adminOnly = requireRole("ADMIN", "MASTER_ADMIN");
const actorOf = (req: AuthedRequest) => ({ id: req.userId!, role: req.role! });
const scopeOf = (req: AuthedRequest) => req.scopeGameIds ?? null;

// Non-admins (agents / support staff) may only act on games in their scope.
function assertGameInScope(req: AuthedRequest, gameId: string) {
  const scope = scopeOf(req);
  if (scope === null) return;
  if (!scope.includes(gameId)) throw new GameError(403, "This game isn't one of yours.");
}

function sendError(res: Response, err: unknown) {
  if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
  throw err;
}

const TX_TYPES = ["RECHARGE", "BONUS", "REDEEM", "FREEPLAY"] as const;
const SOURCES = ["PAGE", "PERSONAL", "WEB"] as const;
const STAFF_ROLES = ["AGENT", "ADMIN", "MASTER_ADMIN"] as const;

function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}
/** The browser sends exact instants (start / end of the chosen local days). */
function dateRange(q: Record<string, unknown>): Prisma.DateTimeFilter | undefined {
  const from = str(q.from) ? new Date(str(q.from)) : null;
  const to = str(q.to) ? new Date(str(q.to)) : null;
  const range: Prisma.DateTimeFilter = {};
  if (from && !isNaN(from.getTime())) range.gte = from;
  if (to && !isNaN(to.getTime())) range.lte = to;
  return range.gte || range.lte ? range : undefined;
}
function paging(q: Record<string, unknown>) {
  const pageSize = [10, 20, 50, 100].includes(Number(q.pageSize)) ? Number(q.pageSize) : 20;
  const page = Math.max(1, Math.floor(Number(q.page)) || 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
const money = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 100) / 100;

// ------------------------------------------------------------------------------------------
// Lookups for forms and filters
// ------------------------------------------------------------------------------------------

deskRouter.get("/meta", async (req: AuthedRequest, res) => {
  const [games, staff] = await Promise.all([
    prisma.game.findMany({ where: ownGameWhere(scopeOf(req)), orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true } }),
    prisma.user.findMany({ where: { role: { in: [...STAFF_ROLES] } }, orderBy: { username: "asc" }, select: { id: true, username: true, role: true } }),
  ]);
  res.json({ games, staff });
});

// Website players, for linking a desk-created account to someone registered on the site.
deskRouter.get("/players", async (req, res) => {
  const q = str(req.query.q);
  if (q.length < 2) return res.json({ players: [] });
  const players = await prisma.user.findMany({
    where: {
      role: "USER",
      OR: [
        { username: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { fullName: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 8,
    select: { id: true, username: true, fullName: true, email: true },
  });
  res.json({ players });
});

// ------------------------------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------------------------------

deskRouter.get("/dashboard", async (req: AuthedRequest, res) => {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const scope = scopeOf(req);
  // Limit the monthly-count raw query to the actor's games (empty fragment for admins).
  const rawGameFilter = scope ? Prisma.sql`AND "gameId" = ANY(${scope})` : Prisma.empty;

  const [players, transactions, monthly, monthTotals, games] = await Promise.all([
    prisma.userGame.count({ where: { status: "ACTIVE", ...gameIdWhere(scope) } }),
    prisma.gameTransaction.count({ where: gameIdWhere(scope) }),
    prisma.$queryRaw<{ m: number; n: bigint }[]>`
      SELECT EXTRACT(MONTH FROM "createdAt")::int AS m, COUNT(*) AS n
      FROM "GameTransaction" WHERE "createdAt" >= ${yearStart} ${rawGameFilter}
      GROUP BY 1`,
    prisma.gameTransaction.groupBy({
      by: ["type", "source"],
      where: { createdAt: { gte: monthStart }, ...gameIdWhere(scope) },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.game.findMany({ where: ownGameWhere(scope), select: { id: true, name: true, backendBalance: true, backendLowAt: true } }),
  ]);

  const byMonth = Array.from({ length: 12 }, (_, i) => Number(monthly.find((r) => r.m === i + 1)?.n ?? 0));
  const totals = Object.fromEntries(
    TX_TYPES.map((t) => {
      const rows = monthTotals.filter((r) => r.type === t);
      return [
        t,
        {
          amount: money(rows.reduce((s, r) => s + Number(r._sum.amount ?? 0), 0)),
          count: rows.reduce((s, r) => s + r._count._all, 0),
          bySource: Object.fromEntries(
            SOURCES.map((src) => {
              const r = rows.find((x) => x.source === src);
              return [src, { amount: money(r?._sum.amount), count: r?._count._all ?? 0 }];
            })
          ),
        },
      ];
    })
  );
  const lowBackends = games
    .filter((g) => Number(g.backendLowAt) > 0 && Number(g.backendBalance) <= Number(g.backendLowAt))
    .map((g) => ({ id: g.id, name: g.name, backendBalance: money(g.backendBalance), backendLowAt: money(g.backendLowAt) }));

  res.json({
    players,
    transactions,
    year: now.getFullYear(),
    month: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
    byMonth,
    totals,
    lowBackends,
  });
});

// ------------------------------------------------------------------------------------------
// Transactions
// ------------------------------------------------------------------------------------------

deskRouter.get("/transactions", async (req: AuthedRequest, res) => {
  const q = req.query as Record<string, unknown>;
  const type = TX_TYPES.find((t) => t === q.type);
  const source = SOURCES.find((s) => s === q.source);
  const search = str(q.search);
  const where: Prisma.GameTransactionWhereInput = {
    ...effectiveGameWhere(scopeOf(req), str(q.gameId) || undefined),
    ...(type ? { type } : {}),
    ...(source ? { source } : {}),
    ...(str(q.staffId) ? { staffId: str(q.staffId) } : {}),
    ...(dateRange(q) ? { createdAt: dateRange(q) } : {}),
    ...(search
      ? {
          OR: [
            { gameUsername: { contains: search, mode: "insensitive" } },
            { userGame: { playerName: { contains: search, mode: "insensitive" } } },
            { userGame: { user: { username: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const { page, pageSize, skip, take } = paging(q);

  const [rows, total, sums] = await Promise.all([
    prisma.gameTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        game: { select: { name: true } },
        staff: { select: { username: true } },
        userGame: { select: { playerName: true, user: { select: { username: true } } } },
      },
    }),
    prisma.gameTransaction.count({ where }),
    prisma.gameTransaction.groupBy({ by: ["type", "source"], where, _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const stats = Object.fromEntries(
    TX_TYPES.map((t) => {
      const rs = sums.filter((s) => s.type === t);
      return [
        t,
        {
          amount: money(rs.reduce((n, r) => n + Number(r._sum.amount ?? 0), 0)),
          count: rs.reduce((n, r) => n + r._count._all, 0),
          bySource: Object.fromEntries(SOURCES.map((src) => {
            const r = rs.find((x) => x.source === src);
            return [src, { amount: money(r?._sum.amount), count: r?._count._all ?? 0 }];
          })),
        },
      ];
    })
  );

  res.json({ rows, total, page, pageSize, stats });
});

const txSchema = z.object({
  type: z.enum(["RECHARGE", "REDEEM", "FREEPLAY"]),
  gameId: z.string().min(1),
  gameUsername: z.string().min(1).max(100),
  amount: z.number().finite(),
  bonus: z.number().finite().optional(),
  source: z.enum(["PAGE", "PERSONAL"]),
  note: z.string().max(300).optional(),
});

deskRouter.post("/transactions", async (req: AuthedRequest, res) => {
  const parsed = txSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  try {
    assertGameInScope(req, parsed.data.gameId);
    const rows = await createManualTransaction(parsed.data, actorOf(req));
    await logAudit(req.userId!, `DESK_${parsed.data.type}`, {
      targetType: "GameTransaction",
      targetId: rows[0].id,
      meta: { gameUsername: rows[0].gameUsername, amount: parsed.data.amount, bonus: parsed.data.bonus ?? 0, source: parsed.data.source },
    });
    res.status(201).json({ transactions: rows, balanceAfter: rows[rows.length - 1].balanceAfter });
  } catch (err) {
    sendError(res, err);
  }
});

// ------------------------------------------------------------------------------------------
// Game accounts
// ------------------------------------------------------------------------------------------

deskRouter.get("/accounts/lookup", async (req: AuthedRequest, res) => {
  try {
    assertGameInScope(req, str(req.query.gameId));
    const account = await lookupAccount(str(req.query.gameId), str(req.query.username));
    res.json({ account });
  } catch (err) {
    sendError(res, err);
  }
});

const accountSchema = z.object({
  gameId: z.string().min(1),
  gameUsername: z.string().min(1).max(100),
  gamePassword: z.string().min(1).max(100),
  playerName: z.string().max(80).optional(),
  linkUserId: z.string().max(40).optional(),
});

deskRouter.post("/accounts", async (req: AuthedRequest, res) => {
  const parsed = accountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the game, username and password." });
  try {
    assertGameInScope(req, parsed.data.gameId);
    const account = await createManualAccount(parsed.data, actorOf(req));
    await logAudit(req.userId!, "DESK_ACCOUNT_CREATED", { targetType: "UserGame", targetId: account.id, meta: { gameUsername: account.gameUsername } });
    res.status(201).json({ account });
  } catch (err) {
    sendError(res, err);
  }
});

deskRouter.get("/accounts", async (req: AuthedRequest, res) => {
  const q = req.query as Record<string, unknown>;
  const search = str(q.search);
  const where: Prisma.UserGameWhereInput = {
    status: "ACTIVE",
    ...effectiveGameWhere(scopeOf(req), str(q.gameId) || undefined),
    ...(str(q.staffId) ? { createdById: str(q.staffId) } : {}),
    ...(dateRange(q) ? { createdAt: dateRange(q) } : {}),
    ...(search
      ? {
          OR: [
            { gameUsername: { contains: search, mode: "insensitive" } },
            { playerName: { contains: search, mode: "insensitive" } },
            { user: { username: { contains: search, mode: "insensitive" } } },
            { user: { email: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const { page, pageSize, skip, take } = paging(q);
  const [rows, total] = await Promise.all([
    prisma.userGame.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        game: { select: { id: true, name: true } },
        user: { select: { id: true, username: true, fullName: true } },
        createdBy: { select: { username: true } },
        balanceSyncedBy: { select: { username: true } },
      },
    }),
    prisma.userGame.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});

// ------------------------------------------------------------------------------------------
// Per-game reports and backends
// ------------------------------------------------------------------------------------------

// "Game Records": per-game credit totals for a period.
deskRouter.get("/game-records", async (req: AuthedRequest, res) => {
  const range = dateRange(req.query as Record<string, unknown>);
  const scope = scopeOf(req);
  const [games, sums, accounts] = await Promise.all([
    prisma.game.findMany({ where: ownGameWhere(scope), orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.gameTransaction.groupBy({ by: ["gameId", "type"], where: { ...gameIdWhere(scope), ...(range ? { createdAt: range } : {}) }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.userGame.groupBy({ by: ["gameId"], where: { status: "ACTIVE", ...gameIdWhere(scope) }, _count: { _all: true } }),
  ]);
  const records = games.map((g) => {
    const get = (t: GameTxType) => sums.find((s) => s.gameId === g.id && s.type === t);
    const recharge = money(get("RECHARGE")?._sum.amount);
    const bonus = money(get("BONUS")?._sum.amount);
    const freeplay = money(get("FREEPLAY")?._sum.amount);
    const redeem = money(get("REDEEM")?._sum.amount);
    return {
      game: g,
      accounts: accounts.find((a) => a.gameId === g.id)?._count._all ?? 0,
      recharge,
      bonus,
      freeplay,
      redeem,
      transactions: sums.filter((s) => s.gameId === g.id).reduce((n, s) => n + s._count._all, 0),
      // Credits given out minus credits taken back.
      net: money(recharge + bonus + freeplay - redeem),
    };
  });
  res.json({ records });
});

// "Games Balance": our backend credit per game, plus what players hold there.
deskRouter.get("/games-balance", async (req: AuthedRequest, res) => {
  const scope = scopeOf(req);
  const [games, held] = await Promise.all([
    prisma.game.findMany({ where: ownGameWhere(scope), orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isActive: true, backendBalance: true, backendLowAt: true, backendUpdatedAt: true } }),
    prisma.userGame.groupBy({ by: ["gameId"], where: { status: "ACTIVE", ...gameIdWhere(scope) }, _sum: { balance: true }, _count: { _all: true } }),
  ]);
  res.json({
    games: games.map((g) => {
      const h = held.find((x) => x.gameId === g.id);
      return {
        ...g,
        backendBalance: money(g.backendBalance),
        backendLowAt: money(g.backendLowAt),
        low: Number(g.backendLowAt) > 0 && Number(g.backendBalance) <= Number(g.backendLowAt),
        accounts: h?._count._all ?? 0,
        playerBalance: money(h?._sum.balance),
      };
    }),
  });
});

const backendSchema = z.object({ balance: z.number().finite(), lowAt: z.number().finite().optional() });

deskRouter.post("/games/:id/backend", async (req: AuthedRequest, res) => {
  const parsed = backendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid balance." });
  // Only admins change the alert threshold; any agent can correct the balance itself.
  const lowAt = req.role === "ADMIN" || req.role === "MASTER_ADMIN" ? parsed.data.lowAt : undefined;
  try {
    assertGameInScope(req, req.params.id);
    const before = await prisma.game.findUnique({ where: { id: req.params.id }, select: { backendBalance: true } });
    await setBackendBalance(req.params.id, parsed.data.balance, lowAt);
    await logAudit(req.userId!, "DESK_BACKEND_BALANCE_SET", {
      targetType: "Game",
      targetId: req.params.id,
      meta: { from: money(before?.backendBalance), to: parsed.data.balance, ...(lowAt !== undefined ? { lowAt } : {}) },
    });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

const topUpSchema = z.object({ amount: z.number().finite(), note: z.string().max(300).optional() });

deskRouter.post("/games/:id/topups", async (req: AuthedRequest, res) => {
  const parsed = topUpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid amount." });
  try {
    assertGameInScope(req, req.params.id);
    const topUp = await topUpBackend(req.params.id, parsed.data.amount, parsed.data.note, actorOf(req));
    await logAudit(req.userId!, "DESK_BACKEND_TOPUP", { targetType: "Game", targetId: req.params.id, meta: { amount: parsed.data.amount } });
    res.status(201).json({ topUp });
  } catch (err) {
    sendError(res, err);
  }
});

// "Recharge Ledger": credits bought for game backends.
deskRouter.get("/topups", async (req: AuthedRequest, res) => {
  const q = req.query as Record<string, unknown>;
  const where: Prisma.BackendTopUpWhereInput = {
    ...effectiveGameWhere(scopeOf(req), str(q.gameId) || undefined),
    ...(str(q.staffId) ? { staffId: str(q.staffId) } : {}),
    ...(dateRange(q) ? { createdAt: dateRange(q) } : {}),
  };
  const { page, pageSize, skip, take } = paging(q);
  const [rows, total, sum] = await Promise.all([
    prisma.backendTopUp.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { game: { select: { name: true } }, staff: { select: { username: true } } },
    }),
    prisma.backendTopUp.count({ where }),
    prisma.backendTopUp.aggregate({ where, _sum: { amount: true } }),
  ]);
  res.json({ rows, total, page, pageSize, totalAmount: money(sum._sum.amount) });
});

// ------------------------------------------------------------------------------------------
// Staff activity (admins see every agent; agents use /api/agent/activity for their own)
// ------------------------------------------------------------------------------------------

deskRouter.get("/staff-activity", adminOnly, async (req, res) => {
  const q = req.query as Record<string, unknown>;
  const where: Prisma.AuditLogWhereInput = {
    actor: { role: { in: [...STAFF_ROLES] } },
    ...(str(q.staffId) ? { actorId: str(q.staffId) } : {}),
    ...(dateRange(q) ? { createdAt: dateRange(q) } : {}),
  };
  const { page, pageSize, skip, take } = paging(q);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { actor: { select: { username: true, role: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});


