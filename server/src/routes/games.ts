import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import {
  GameError,
  cancelRequest,
  requestBalanceCheck,
  requestGameAccount,
  requestPasswordReset,
  requestRecharge,
  requestRedeem,
  toMoney,
} from "../lib/gameAccounts";
import { tryAutoBalanceCheck, tryAutoCreateAccount, tryAutoRecharge, tryAutoResetPassword } from "../lib/gameAutomation";

export const gamesRouter = Router();

// Public: shown on the marketing landing page before signup, same as everything below
// requireAuth needs a logged-in session.
gamesRouter.get("/catalog", async (_req, res) => {
  const games = await prisma.game.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  res.json({ games });
});

gamesRouter.use(requireAuth);

function sendError(res: Response, err: unknown) {
  if (err instanceof GameError) return res.status(err.status).json({ error: err.message });
  throw err;
}

gamesRouter.get("/mine", async (req: AuthedRequest, res) => {
  const [userGames, wallet] = await Promise.all([
    prisma.userGame.findMany({
      where: { userId: req.userId!, status: { in: ["PENDING", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        gameUsername: true,
        gamePassword: true,
        balance: true,
        balanceSyncedAt: true,
        createdAt: true,
        game: true,
        // Open requests drive the "waiting for agent" badges on each game card.
        requests: {
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          select: { id: true, type: true, amount: true, createdAt: true, claimedById: true },
        },
      },
    }),
    prisma.wallet.findUnique({ where: { userId: req.userId! }, select: { balance: true } }),
  ]);
  res.json({
    userGames: userGames.map(({ requests, ...ug }) => ({
      ...ug,
      pendingRequests: requests.map(({ claimedById, ...r }) => ({ ...r, inProgress: !!claimedById })),
    })),
    walletBalance: wallet?.balance ?? 0,
  });
});

// Recent game requests (all states), so the player can see what was done or declined and why.
gamesRouter.get("/requests", async (req: AuthedRequest, res) => {
  const requests = await prisma.gameRequest.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      completedAmount: true,
      agentNote: true,
      claimedById: true,
      createdAt: true,
      completedAt: true,
      userGame: { select: { game: { select: { name: true } } } },
    },
  });
  res.json({
    requests: requests.map(({ userGame, claimedById, ...r }) => ({ ...r, gameName: userGame.game.name, inProgress: !!claimedById })),
  });
});

const amountSchema = z.number().finite();

const addGameSchema = z.object({ gameId: z.string().min(1), amount: amountSchema.optional() });

// Asks an agent to create the account; an optional first load is taken from the wallet now.
gamesRouter.post("/mine", async (req: AuthedRequest, res) => {
  const parsed = addGameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid game." });
  try {
    const amount = parsed.data.amount ? toMoney(parsed.data.amount) : 0;
    const result = await requestGameAccount(req.userId!, parsed.data.gameId, amount);
    // Automated game: create the real account now and hand back the login instantly.
    const auto = await tryAutoCreateAccount(result.userGameId).catch(() => ({ created: false }));
    res.status(201).json({ ...result, ...auto });
  } catch (err) {
    sendError(res, err);
  }
});

const moneySchema = z.object({ amount: amountSchema });

gamesRouter.post("/mine/:id/recharge", async (req: AuthedRequest, res) => {
  const parsed = moneySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter an amount." });
  try {
    const request = await requestRecharge(req.userId!, req.params.id, toMoney(parsed.data.amount));
    const loaded = await tryAutoRecharge(request.id).catch(() => false);
    res.status(201).json({ request, loaded });
  } catch (err) {
    sendError(res, err);
  }
});

gamesRouter.post("/mine/:id/redeem", async (req: AuthedRequest, res) => {
  const parsed = moneySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter an amount." });
  try {
    const request = await requestRedeem(req.userId!, req.params.id, toMoney(parsed.data.amount));
    res.status(201).json({ request });
  } catch (err) {
    sendError(res, err);
  }
});

gamesRouter.post("/mine/:id/reset-password", async (req: AuthedRequest, res) => {
  try {
    const request = await requestPasswordReset(req.userId!, req.params.id);
    const done = await tryAutoResetPassword(request.id).catch(() => false);
    res.status(201).json({ request, done });
  } catch (err) {
    sendError(res, err);
  }
});

// "Refresh balance": an agent re-reads it from the game platform.
gamesRouter.post("/mine/:id/balance-check", async (req: AuthedRequest, res) => {
  try {
    const { request, alreadyOpen } = await requestBalanceCheck(req.userId!, req.params.id);
    const done = alreadyOpen ? false : await tryAutoBalanceCheck(request.id).catch(() => false);
    res.status(alreadyOpen ? 200 : 201).json({ request, alreadyOpen, done });
  } catch (err) {
    sendError(res, err);
  }
});

gamesRouter.post("/requests/:id/cancel", async (req: AuthedRequest, res) => {
  try {
    await cancelRequest(req.userId!, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});
