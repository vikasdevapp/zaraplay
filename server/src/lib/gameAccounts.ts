import { GameRequest, GameTxSource, GameTxType, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { notifyUser } from "./webpush";
import { getPlatformSettings } from "./settings";
import { gameCashoutLimits } from "./cashoutRules";

/**
 * Player game accounts on third-party platforms (Juwa, Fire Kirin, ...), worked by agents.
 *
 * Money model:
 *  - Wallet.balance is the player's cash on this site.
 *  - UserGame.balance is our record of the credits inside their game account. The real credits
 *    live on the game's own platform; agents load/unload them there and mirror it here.
 *
 * Every change goes through a GameRequest in the agents' queue:
 *  - CREATE_ACCOUNT / RECHARGE take the amount out of the wallet immediately (held as a PENDING
 *    GAME_RECHARGE transaction) and refund it if the agent rejects or the player cancels.
 *  - REDEEM holds nothing (the credits sit on the game platform); on completion the agent enters
 *    what was actually redeemed and what is left, and the wallet is credited.
 *
 * Every state change is a conditional update inside a DB transaction, so a request can only be
 * completed, rejected or cancelled once, and the wallet can never go negative.
 */

export class GameError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const MIN_GAME_AMOUNT = 5;
export const MAX_GAME_AMOUNT = 100000;
const MAX_OPEN_RECHARGES_PER_GAME = 5;
// A balance that was re-read this recently doesn't need another check yet.
const BALANCE_CHECK_COOLDOWN_MS = 5 * 60 * 1000;

type Tx = Prisma.TransactionClient;
type Actor = { id: string; role: string };

const isAdminRole = (role: string) => role === "ADMIN" || role === "MASTER_ADMIN";

/** A login is unique per game; the database enforces it, this spots the violation. */
export function isDuplicateLogin(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Game platforms treat usernames case-insensitively, so "VIP1" and "vip1" are the same login.
 * (The DB unique index is exact-case; this closes the gap.)
 */
export async function assertLoginFree(tx: Tx | typeof prisma, gameId: string, gameUsername: string, exceptUserGameId?: string) {
  const clash = await tx.userGame.findFirst({
    where: {
      gameId,
      gameUsername: { equals: gameUsername, mode: "insensitive" },
      ...(exceptUserGameId ? { NOT: { id: exceptUserGameId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new GameError(409, "That game username is already registered for this game.");
}

/**
 * Writes one Agent Desk ledger row and moves the game's backend balance: loads, bonuses and
 * free play draw credits from our backend, redeems return them.
 */
export async function recordGameTx(
  tx: Tx,
  row: {
    type: GameTxType;
    source: GameTxSource;
    gameId: string;
    userGameId: string;
    gameUsername: string;
    amount: number;
    balanceAfter: number;
    staffId: string | null;
    gameRequestId?: string | null;
    note?: string | null;
  }
) {
  const delta = row.type === "REDEEM" ? row.amount : -row.amount;
  await tx.game.update({ where: { id: row.gameId }, data: { backendBalance: { increment: delta } } });
  return tx.gameTransaction.create({ data: { ...row, note: row.note?.trim() || null } });
}

/** Cents-exact amount, or an error. */
export function toMoney(value: number): number {
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || Math.abs(value * 100 - cents) > 1e-6) throw new GameError(400, "Amount can have at most 2 decimal places.");
  const amount = cents / 100;
  if (amount < MIN_GAME_AMOUNT) throw new GameError(400, `Minimum amount is $${MIN_GAME_AMOUNT.toFixed(2)}.`);
  if (amount > MAX_GAME_AMOUNT) throw new GameError(400, `Maximum amount is $${MAX_GAME_AMOUNT.toFixed(2)}.`);
  return amount;
}

/** Takes `amount` from the wallet's cash balance, or throws if it isn't there. */
async function debitWallet(tx: Tx, userId: string, amount: number) {
  const res = await tx.wallet.updateMany({
    where: { userId, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (res.count === 0) throw new GameError(400, "Not enough balance in your wallet. Deposit first, then try again.");
}

/** Holds wallet money for a load and creates the request that the agent will complete. */
async function createLoadRequest(
  tx: Tx,
  userId: string,
  userGameId: string,
  gameId: string,
  type: "CREATE_ACCOUNT" | "RECHARGE",
  amount: number,
  source: string,
  // The deposit that funds the cashout tier (deposit-and-load). Plain loads leave it null and
  // use the load amount as the basis.
  loadDeposit?: number
) {
  let transactionId: string | null = null;
  if (amount > 0) {
    await debitWallet(tx, userId, amount);
    const t = await tx.transaction.create({
      data: { userId, type: "GAME_RECHARGE", amount, status: "PENDING", meta: { userGameId, gameId, source } },
    });
    transactionId = t.id;
  }
  return tx.gameRequest.create({ data: { userId, userGameId, type, amount, transactionId, loadDeposit: loadDeposit ?? null } });
}

/** The tier basis a completed load sets on the account: deposit for the boundary, amount as total. */
export function loadBasis(request: { amount: Prisma.Decimal | number; loadDeposit: Prisma.Decimal | number | null }) {
  const total = Number(request.amount);
  const deposit = request.loadDeposit != null ? Number(request.loadDeposit) : total;
  return { loadTotal: total, loadDeposit: deposit };
}

// ---------------------------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------------------------

export async function requestGameAccount(userId: string, gameId: string, firstLoad: number) {
  const amount = firstLoad ? toMoney(firstLoad) : 0;
  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || !game.isActive) throw new GameError(404, "This game is not available.");

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.userGame.findUnique({ where: { userId_gameId: { userId, gameId } } });
      let userGameId: string;
      if (existing) {
        if (existing.status !== "REJECTED") throw new GameError(409, "You already have this game.");
        // Re-requesting after a rejection reuses the row; only an unconditional REJECTED -> PENDING flip.
        const flipped = await tx.userGame.updateMany({
          where: { id: existing.id, status: "REJECTED" },
          data: { status: "PENDING", gameUsername: null, gamePassword: null, balance: 0, loadDeposit: 0, loadTotal: 0, balanceSyncedAt: null, balanceSyncedById: null },
        });
        if (!flipped.count) throw new GameError(409, "You already have this game.");
        userGameId = existing.id;
      } else {
        const created = await tx.userGame.create({ data: { userId, gameId, status: "PENDING" } });
        userGameId = created.id;
      }
      const request = await createLoadRequest(tx, userId, userGameId, gameId, "CREATE_ACCOUNT", amount, "add_game");
      return { userGameId, request };
    });
  } catch (err) {
    // Two simultaneous "add game" clicks: the unique (userId, gameId) index lets only one through.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new GameError(409, "You already have this game.");
    throw err;
  }
}

async function ownGame(userId: string, userGameId: string) {
  const ug = await prisma.userGame.findFirst({ where: { id: userGameId, userId }, include: { game: true } });
  if (!ug) throw new GameError(404, "Game account not found.");
  return ug;
}

export async function requestRecharge(userId: string, userGameId: string, requested: number, source = "wallet") {
  const amount = toMoney(requested);
  const ug = await ownGame(userId, userGameId);
  if (ug.status === "REJECTED") throw new GameError(400, "This game account was not created. Add the game again.");
  return prisma.$transaction(async (tx) => {
    const open = await tx.gameRequest.count({ where: { userGameId, type: "RECHARGE", status: "PENDING" } });
    if (open >= MAX_OPEN_RECHARGES_PER_GAME) {
      throw new GameError(429, "You already have several loads waiting for this game. Please wait for them to finish.");
    }
    return createLoadRequest(tx, userId, userGameId, ug.gameId, "RECHARGE", amount, source);
  });
}

export async function requestRedeem(userId: string, userGameId: string, requested: number) {
  const amount = toMoney(requested);
  const ug = await ownGame(userId, userGameId);
  if (ug.status !== "ACTIVE") throw new GameError(400, "This game account isn't ready yet.");
  // Enforce the cashout playthrough rule up front (automated games do this live against the
  // real balance; here we use the recorded balance so manual redeems can't be filed too early).
  const settings = await getPlatformSettings();
  const limits = gameCashoutLimits(Number(ug.loadDeposit), Number(ug.loadTotal), settings);
  if (limits) {
    const balance = Number(ug.balance);
    if (balance < limits.min) {
      throw new GameError(400, `Keep playing — you need at least $${limits.min.toFixed(2)} in the game to withdraw (you have $${balance.toFixed(2)}).`);
    }
    if (amount < limits.min) throw new GameError(400, `Minimum withdrawal is $${limits.min.toFixed(2)}.`);
  }
  const pending = await prisma.gameRequest.findFirst({ where: { userGameId, type: "REDEEM", status: "PENDING" } });
  if (pending) throw new GameError(409, "You already have a redeem request for this game. Please wait for it to finish.");
  return prisma.gameRequest.create({ data: { userId, userGameId, type: "REDEEM", amount } });
}

export async function requestPasswordReset(userId: string, userGameId: string) {
  const ug = await ownGame(userId, userGameId);
  if (ug.status !== "ACTIVE") throw new GameError(400, "This game account isn't ready yet.");
  const pending = await prisma.gameRequest.findFirst({ where: { userGameId, type: "PASSWORD_RESET", status: "PENDING" } });
  if (pending) throw new GameError(409, "A password reset is already in progress for this game.");
  return prisma.gameRequest.create({ data: { userId, userGameId, type: "PASSWORD_RESET" } });
}

/**
 * "Refresh balance": asks an agent to re-read the balance on the game platform. Idempotent —
 * an open check is returned rather than duplicated — and throttled after a recent update.
 */
export async function requestBalanceCheck(userId: string, userGameId: string) {
  const ug = await ownGame(userId, userGameId);
  if (ug.status !== "ACTIVE") throw new GameError(400, "This game account isn't ready yet.");
  const open = await prisma.gameRequest.findFirst({ where: { userGameId, type: "BALANCE_CHECK", status: "PENDING" } });
  if (open) return { request: open, alreadyOpen: true };
  // Automated games read the balance with a cheap API call, so they skip the anti-spam cooldown
  // that exists only to protect the manual agent queue.
  if (!ug.game.automationProvider && ug.balanceSyncedAt && Date.now() - ug.balanceSyncedAt.getTime() < BALANCE_CHECK_COOLDOWN_MS) {
    const mins = Math.max(1, Math.round((Date.now() - ug.balanceSyncedAt.getTime()) / 60000));
    throw new GameError(429, `Your balance was updated ${mins} min ago. You can ask again in a few minutes.`);
  }
  const request = await prisma.gameRequest.create({ data: { userId, userGameId, type: "BALANCE_CHECK" } });
  return { request, alreadyOpen: false };
}

/**
 * Any time an agent records a balance they actually saw on the game platform, open balance
 * checks for that account are answered by it — nobody has to do the same lookup twice.
 */
async function answerOpenBalanceChecks(tx: Tx, userGameId: string, actorId: string, balance: number) {
  const open = await tx.gameRequest.findMany({ where: { userGameId, type: "BALANCE_CHECK", status: "PENDING" }, select: { id: true, userId: true } });
  if (!open.length) return [];
  await tx.gameRequest.updateMany({
    where: { id: { in: open.map((r) => r.id) }, status: "PENDING" },
    data: { status: "COMPLETED", completedAmount: balance, handledById: actorId, completedAt: new Date(), agentNote: "Answered by a balance update" },
  });
  return open;
}

/** A player can withdraw a request until an agent starts working on it. */
export async function cancelRequest(userId: string, requestId: string) {
  const request = await prisma.gameRequest.findFirst({ where: { id: requestId, userId } });
  if (!request) throw new GameError(404, "Request not found.");
  if (request.status !== "PENDING") throw new GameError(400, "This request is already finished.");
  if (request.claimedById) throw new GameError(400, "An agent is already working on this request, so it can't be cancelled now.");

  return prisma.$transaction(async (tx) => {
    const done = await tx.gameRequest.updateMany({
      where: { id: requestId, status: "PENDING", claimedById: null },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    if (!done.count) throw new GameError(400, "An agent is already working on this request, so it can't be cancelled now.");
    await refundHeld(tx, request, "Cancelled by player");
    if (request.type === "CREATE_ACCOUNT") await closeUnopenedAccount(tx, request.userGameId, "Account request cancelled");
  });
}

// ---------------------------------------------------------------------------------------------
// Shared settlement helpers
// ---------------------------------------------------------------------------------------------

/** Returns money held for a CREATE_ACCOUNT / RECHARGE request to the wallet. */
async function refundHeld(tx: Tx, request: GameRequest, note: string) {
  if (!request.transactionId) return;
  const res = await tx.transaction.updateMany({
    where: { id: request.transactionId, status: "PENDING" },
    data: { status: "REJECTED", adminNote: note },
  });
  if (res.count) await tx.wallet.update({ where: { userId: request.userId }, data: { balance: { increment: request.amount } } });
}

/** When an account will never be created, its other open loads are refunded too. */
async function closeUnopenedAccount(tx: Tx, userGameId: string, note: string) {
  await tx.userGame.updateMany({ where: { id: userGameId, status: "PENDING" }, data: { status: "REJECTED" } });
  const open = await tx.gameRequest.findMany({ where: { userGameId, status: "PENDING" } });
  for (const r of open) {
    const closed = await tx.gameRequest.updateMany({
      where: { id: r.id, status: "PENDING" },
      data: { status: "CANCELLED", agentNote: note, completedAt: new Date() },
    });
    if (closed.count) await refundHeld(tx, r, note);
  }
}

// ---------------------------------------------------------------------------------------------
// Agent actions
// ---------------------------------------------------------------------------------------------

export async function claimRequest(requestId: string, actor: Actor) {
  const res = await prisma.gameRequest.updateMany({
    where: { id: requestId, status: "PENDING", claimedById: null },
    data: { claimedById: actor.id, claimedAt: new Date() },
  });
  if (!res.count) {
    const r = await prisma.gameRequest.findUnique({ where: { id: requestId }, include: { claimedBy: { select: { username: true } } } });
    if (!r) throw new GameError(404, "Request not found.");
    if (r.status !== "PENDING") throw new GameError(409, "This request is already finished.");
    if (r.claimedById === actor.id) return;
    throw new GameError(409, `@${r.claimedBy?.username ?? "another agent"} is already working on this request.`);
  }
}

export async function releaseRequest(requestId: string, actor: Actor) {
  const res = await prisma.gameRequest.updateMany({
    where: { id: requestId, status: "PENDING", ...(isAdminRole(actor.role) ? {} : { claimedById: actor.id }) },
    data: { claimedById: null, claimedAt: null },
  });
  if (!res.count) throw new GameError(409, "You can only release a pending request you are working on.");
}

/**
 * Moves a request PENDING -> final status exactly once. Agents may finish requests that are
 * unclaimed or claimed by themselves; admins may finish any.
 */
async function finishRequest(tx: Tx, requestId: string, actor: Actor, data: Prisma.GameRequestUncheckedUpdateManyInput) {
  const request = await tx.gameRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new GameError(404, "Request not found.");
  const res = await tx.gameRequest.updateMany({
    where: {
      id: requestId,
      status: "PENDING",
      ...(isAdminRole(actor.role) ? {} : { OR: [{ claimedById: null }, { claimedById: actor.id }] }),
    },
    data: { ...data, handledById: actor.id, completedAt: new Date(), claimedById: request.claimedById ?? actor.id, claimedAt: request.claimedAt ?? new Date() },
  });
  if (!res.count) {
    if (request.status !== "PENDING") throw new GameError(409, "This request is already finished.");
    throw new GameError(409, "Another agent is working on this request.");
  }
  return request;
}

export interface CompleteInput {
  gameUsername?: string;
  gamePassword?: string;
  redeemedAmount?: number;
  remainingBalance?: number;
  // BALANCE_CHECK: the balance the game platform shows now.
  balance?: number;
  note?: string;
}

export async function completeRequest(requestId: string, actor: Actor, input: CompleteInput) {
  const result = await completeInTx(requestId, actor, input).catch((err) => {
    if (isDuplicateLogin(err)) throw new GameError(409, "That game username is already registered for this game.");
    throw err;
  });

  notifyUser(result.request.userId, { body: result.notify, kind: "GAME", link: "/games" }).catch(() => {});
  return result.request;
}

function completeInTx(requestId: string, actor: Actor, input: CompleteInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.gameRequest.findUnique({ where: { id: requestId }, include: { userGame: { include: { game: true } } } });
    if (!current) throw new GameError(404, "Request not found.");
    const ug = current.userGame;
    const note = input.note?.trim() || null;

    switch (current.type) {
      case "CREATE_ACCOUNT": {
        const username = input.gameUsername?.trim();
        const password = input.gamePassword?.trim();
        if (!username || !password) throw new GameError(400, "Enter the game username and password you created.");
        await assertLoginFree(tx, ug.gameId, username, ug.id);
        const request = await finishRequest(tx, requestId, actor, { status: "COMPLETED", completedAmount: current.amount, agentNote: note });
        const basis = loadBasis(request);
        const created = await tx.userGame.update({
          where: { id: ug.id },
          data: {
            status: "ACTIVE",
            gameUsername: username,
            gamePassword: password,
            balance: { increment: request.amount },
            loadDeposit: { increment: basis.loadDeposit },
            loadTotal: { increment: basis.loadTotal },
            balanceSyncedAt: new Date(),
            balanceSyncedById: actor.id,
            createdById: actor.id,
          },
        });
        if (request.transactionId) await tx.transaction.update({ where: { id: request.transactionId }, data: { status: "COMPLETED" } });
        if (Number(request.amount) > 0) {
          await recordGameTx(tx, {
            type: "RECHARGE",
            source: "WEB",
            gameId: ug.gameId,
            userGameId: ug.id,
            gameUsername: username,
            amount: Number(request.amount),
            balanceAfter: Number(created.balance),
            staffId: actor.id,
            gameRequestId: request.id,
          });
        }
        return { request, notify: `Your ${ug.game.name} account is ready. Open My Games to see your login.` };
      }

      case "RECHARGE": {
        if (ug.status !== "ACTIVE") throw new GameError(400, "Create this player's game account first (see their Create Account request).");
        const request = await finishRequest(tx, requestId, actor, { status: "COMPLETED", completedAmount: current.amount, agentNote: note });
        const basis = loadBasis(request);
        const loaded = await tx.userGame.update({
          where: { id: ug.id },
          // Adds to the recorded balance; not a fresh read of it, so balanceSyncedAt stays as is.
          data: { balance: { increment: request.amount }, loadDeposit: { increment: basis.loadDeposit }, loadTotal: { increment: basis.loadTotal } },
        });
        if (request.transactionId) await tx.transaction.update({ where: { id: request.transactionId }, data: { status: "COMPLETED" } });
        await recordGameTx(tx, {
          type: "RECHARGE",
          source: "WEB",
          gameId: ug.gameId,
          userGameId: ug.id,
          gameUsername: ug.gameUsername!,
          amount: Number(request.amount),
          balanceAfter: Number(loaded.balance),
          staffId: actor.id,
          gameRequestId: request.id,
        });
        return { request, notify: `$${Number(request.amount).toFixed(2)} has been loaded into ${ug.game.name}.` };
      }

      case "REDEEM": {
        const redeemed = input.redeemedAmount;
        const remaining = input.remainingBalance;
        if (redeemed === undefined || remaining === undefined) throw new GameError(400, "Enter the amount redeemed and the balance left in the game.");
        const redeemedAmount = toMoney(redeemed);
        if (redeemedAmount > Number(current.amount)) {
          throw new GameError(400, `You can't redeem more than the player asked for ($${Number(current.amount).toFixed(2)}).`);
        }
        const remainingBalance = Math.round(remaining * 100) / 100;
        if (!Number.isFinite(remainingBalance) || remainingBalance < 0 || remainingBalance > 10_000_000) {
          throw new GameError(400, "Enter a valid remaining game balance.");
        }
        const request = await finishRequest(tx, requestId, actor, { status: "COMPLETED", completedAmount: redeemedAmount, agentNote: note });
        const t = await tx.transaction.create({
          data: {
            userId: request.userId,
            type: "GAME_REDEEM",
            amount: redeemedAmount,
            status: "COMPLETED",
            meta: { userGameId: ug.id, gameId: ug.gameId, requestedAmount: Number(request.amount) },
          },
        });
        await tx.gameRequest.update({ where: { id: request.id }, data: { transactionId: t.id } });
        await tx.wallet.update({ where: { userId: request.userId }, data: { balance: { increment: redeemedAmount } } });
        await tx.userGame.update({
          where: { id: ug.id },
          // Whatever stays in the game re-tiers as the new load basis for the next withdrawal.
          data: { balance: remainingBalance, loadDeposit: remainingBalance, loadTotal: remainingBalance, balanceSyncedAt: new Date(), balanceSyncedById: actor.id },
        });
        await recordGameTx(tx, {
          type: "REDEEM",
          source: "WEB",
          gameId: ug.gameId,
          userGameId: ug.id,
          gameUsername: ug.gameUsername!,
          amount: redeemedAmount,
          balanceAfter: remainingBalance,
          staffId: actor.id,
          gameRequestId: request.id,
        });
        await answerOpenBalanceChecks(tx, ug.id, actor.id, remainingBalance);
        return { request, notify: `$${redeemedAmount.toFixed(2)} from ${ug.game.name} has been added to your wallet.` };
      }

      case "BALANCE_CHECK": {
        if (ug.status !== "ACTIVE") throw new GameError(400, "This game account isn't active.");
        const value = Math.round((input.balance ?? NaN) * 100) / 100;
        if (!Number.isFinite(value) || value < 0 || value > 10_000_000) throw new GameError(400, "Enter the balance the game shows now.");
        const request = await finishRequest(tx, requestId, actor, { status: "COMPLETED", completedAmount: value, agentNote: note });
        await tx.userGame.update({ where: { id: ug.id }, data: { balance: value, balanceSyncedAt: new Date(), balanceSyncedById: actor.id } });
        await answerOpenBalanceChecks(tx, ug.id, actor.id, value);
        return { request, notify: `Your ${ug.game.name} balance is $${value.toFixed(2)}.` };
      }

      case "PASSWORD_RESET": {
        const password = input.gamePassword?.trim();
        if (!password) throw new GameError(400, "Enter the new game password you set.");
        const request = await finishRequest(tx, requestId, actor, { status: "COMPLETED", agentNote: note });
        await tx.userGame.update({ where: { id: ug.id }, data: { gamePassword: password } });
        return { request, notify: `Your ${ug.game.name} password has been reset. Open My Games to see it.` };
      }
    }
    throw new GameError(400, "Unknown request type.");
  });
}

export async function rejectRequest(requestId: string, actor: Actor, reason: string) {
  const note = reason.trim();
  if (!note) throw new GameError(400, "Tell the player why this request was rejected.");
  const request = await prisma.$transaction(async (tx) => {
    const r = await finishRequest(tx, requestId, actor, { status: "REJECTED", agentNote: note });
    await refundHeld(tx, r, `Rejected: ${note}`);
    if (r.type === "CREATE_ACCOUNT") await closeUnopenedAccount(tx, r.userGameId, `Account request rejected: ${note}`);
    return r;
  });
  const refunded = request.transactionId && request.type !== "REDEEM" ? ` $${Number(request.amount).toFixed(2)} was returned to your wallet.` : "";
  notifyUser(request.userId, { body: `Your game request was declined: ${note}.${refunded}`, kind: "GAME", link: "/games" }).catch(() => {});
  return request;
}

/** Agent re-reads the player's balance on the game platform and records it here. */
export async function syncBalance(userGameId: string, actor: Actor, balance: number) {
  const value = Math.round(balance * 100) / 100;
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) throw new GameError(400, "Enter a valid balance.");
  const answered = await prisma.$transaction(async (tx) => {
    const res = await tx.userGame.updateMany({
      where: { id: userGameId, status: "ACTIVE" },
      data: { balance: value, balanceSyncedAt: new Date(), balanceSyncedById: actor.id },
    });
    if (!res.count) throw new GameError(404, "Active game account not found.");
    return answerOpenBalanceChecks(tx, userGameId, actor.id, value);
  });
  if (answered.length) {
    const ug = await prisma.userGame.findUnique({ where: { id: userGameId }, select: { game: { select: { name: true } } } });
    notifyUser(answered[0].userId, { body: `Your ${ug?.game.name ?? "game"} balance is $${value.toFixed(2)}.`, kind: "GAME", link: "/games" }).catch(() => {});
  }
}

/** Fixes the stored login for an existing account (e.g. a typo when it was created). */
export async function updateCredentials(userGameId: string, gameUsername: string, gamePassword: string) {
  const username = gameUsername.trim();
  const password = gamePassword.trim();
  if (!username || !password) throw new GameError(400, "Username and password are required.");
  const current = await prisma.userGame.findUnique({ where: { id: userGameId }, select: { gameId: true } });
  if (!current) throw new GameError(404, "Active game account not found.");
  await assertLoginFree(prisma, current.gameId, username, userGameId);
  const res = await prisma.userGame
    .updateMany({ where: { id: userGameId, status: "ACTIVE" }, data: { gameUsername: username, gamePassword: password } })
    .catch((err) => {
      if (isDuplicateLogin(err)) throw new GameError(409, "That game username is already registered for this game.");
      throw err;
    });
  if (!res.count) throw new GameError(404, "Active game account not found.");
}

/**
 * Called inside completeDeposit: a deposit made "for" a game is loaded into it straight away
 * (deposit + bonus). If the game account no longer accepts loads, the money simply stays in
 * the wallet.
 */
export async function autoLoadDeposit(tx: Tx, userId: string, userGameId: string, amount: number, depositId: string, depositBasis?: number) {
  const ug = await tx.userGame.findFirst({ where: { id: userGameId, userId, status: { in: ["PENDING", "ACTIVE"] } } });
  if (!ug || amount <= 0) return null;
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet || Number(wallet.balance) < amount) return null;
  // loadTotal basis = deposit + bonus (amount); the tier boundary is set by the deposit alone.
  const basis = depositBasis != null ? Math.min(Math.round(depositBasis * 100) / 100, Math.round(amount * 100) / 100) : undefined;
  return createLoadRequest(tx, userId, ug.id, ug.gameId, "RECHARGE", Math.round(amount * 100) / 100, `deposit:${depositId}`, basis);
}
