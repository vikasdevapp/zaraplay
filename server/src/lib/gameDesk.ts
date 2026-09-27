import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { GameError, assertLoginFree, isDuplicateLogin, recordGameTx, toMoney } from "./gameAccounts";

/**
 * Agent Desk: the manual counterpart of a game distributor panel.
 *
 * Agents do the work on each game's own back office, then record it here. PAGE / PERSONAL
 * transactions are for players who paid the agent outside this site, so they never touch a
 * website wallet; WEB transactions are written by the website request flow (gameAccounts.ts).
 *
 * Every movement updates, in one DB transaction:
 *  - the player's recorded game balance (UserGame.balance)
 *  - our credit balance on that game's backend (Game.backendBalance): loads, bonuses and free
 *    play draw on it, redeems return to it
 *  - the GameTransaction ledger (with the balance after the movement)
 */

type Tx = Prisma.TransactionClient;
type Actor = { id: string; role: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

const duplicateLogin = () => new GameError(409, "That game username is already registered for this game.");

async function findAccount(tx: Tx | typeof prisma, gameId: string, gameUsername: string) {
  const username = gameUsername.trim();
  if (!username) throw new GameError(400, "Enter the player's game username.");
  const ug = await tx.userGame.findFirst({
    where: { gameId, gameUsername: { equals: username, mode: "insensitive" } },
    include: { game: { select: { id: true, name: true } }, user: { select: { id: true, username: true, fullName: true } } },
  });
  if (!ug) throw new GameError(404, `No account "${username}" found for this game. Create it first.`);
  if (ug.status !== "ACTIVE") throw new GameError(400, "This game account isn't active.");
  return ug;
}

// ---------------------------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------------------------

export async function createManualAccount(
  input: { gameId: string; gameUsername: string; gamePassword: string; playerName?: string; linkUserId?: string },
  actor: Actor
) {
  const username = input.gameUsername.trim();
  const password = input.gamePassword.trim();
  if (!username || !password) throw new GameError(400, "Enter the game username and password you created.");

  const game = await prisma.game.findUnique({ where: { id: input.gameId } });
  if (!game) throw new GameError(404, "Game not found.");

  let userId: string | null = null;
  if (input.linkUserId) {
    const user = await prisma.user.findFirst({ where: { id: input.linkUserId, role: "USER" } });
    if (!user) throw new GameError(404, "Website player not found.");
    const has = await prisma.userGame.findUnique({ where: { userId_gameId: { userId: user.id, gameId: game.id } } });
    if (has && has.status !== "REJECTED") {
      throw new GameError(409, `@${user.username} already has a ${game.name} account${has.status === "PENDING" ? " request — finish it from Requests" : ""}.`);
    }
    userId = user.id;
  }
  const playerName = input.playerName?.trim() || null;
  if (!userId && !playerName) throw new GameError(400, "Enter the player's name, or link a website player.");

  try {
    return await prisma.$transaction(async (tx) => {
      await assertLoginFree(tx, game.id, username);
      // A website player's old rejected request is reused so (userId, gameId) stays unique.
      if (userId) {
        const rejected = await tx.userGame.findUnique({ where: { userId_gameId: { userId, gameId: game.id } } });
        if (rejected) {
          return tx.userGame.update({
            where: { id: rejected.id },
            data: { status: "ACTIVE", gameUsername: username, gamePassword: password, playerName, balance: 0, createdById: actor.id, balanceSyncedAt: new Date(), balanceSyncedById: actor.id },
          });
        }
      }
      return tx.userGame.create({
        data: {
          userId,
          gameId: game.id,
          status: "ACTIVE",
          gameUsername: username,
          gamePassword: password,
          playerName,
          createdById: actor.id,
          balanceSyncedAt: new Date(),
          balanceSyncedById: actor.id,
        },
      });
    });
  } catch (err) {
    if (isDuplicateLogin(err)) throw duplicateLogin();
    throw err;
  }
}

/** "Check User Balance": the account as we have it recorded. */
export async function lookupAccount(gameId: string, gameUsername: string) {
  const ug = await findAccount(prisma, gameId, gameUsername);
  return {
    id: ug.id,
    game: ug.game,
    gameUsername: ug.gameUsername,
    playerName: ug.playerName,
    user: ug.user,
    balance: ug.balance,
    balanceSyncedAt: ug.balanceSyncedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

export interface ManualTxInput {
  type: "RECHARGE" | "REDEEM" | "FREEPLAY";
  gameId: string;
  gameUsername: string;
  amount: number;
  bonus?: number;
  source: "PAGE" | "PERSONAL";
  note?: string;
}

export async function createManualTransaction(input: ManualTxInput, actor: Actor) {
  const amount = toMoney(input.amount);
  const bonus = input.type === "RECHARGE" && input.bonus ? toMoney(input.bonus) : 0;

  return prisma.$transaction(async (tx) => {
    const ug = await findAccount(tx, input.gameId, input.gameUsername);
    const base = { source: input.source, gameId: ug.gameId, userGameId: ug.id, gameUsername: ug.gameUsername!, staffId: actor.id, note: input.note };

    if (input.type === "REDEEM") {
      // Conditional: never takes the recorded balance below zero, even with two agents at once.
      const res = await tx.userGame.updateMany({
        where: { id: ug.id, balance: { gte: amount } },
        data: { balance: { decrement: amount }, balanceSyncedAt: new Date(), balanceSyncedById: actor.id },
      });
      if (!res.count) {
        const current = await tx.userGame.findUniqueOrThrow({ where: { id: ug.id } });
        throw new GameError(
          400,
          `Recorded balance is only $${Number(current.balance).toFixed(2)}. If the player has more on the game, use Check User Balance to update it first.`
        );
      }
      const after = await tx.userGame.findUniqueOrThrow({ where: { id: ug.id } });
      return [await recordGameTx(tx, { ...base, type: "REDEEM", amount, balanceAfter: Number(after.balance) })];
    }

    const total = round2(amount + bonus);
    const updated = await tx.userGame.update({
      where: { id: ug.id },
      data: { balance: { increment: total }, balanceSyncedAt: new Date(), balanceSyncedById: actor.id },
    });
    const finalBalance = Number(updated.balance);
    const rows = [];
    if (input.type === "FREEPLAY") {
      rows.push(await recordGameTx(tx, { ...base, type: "FREEPLAY", amount, balanceAfter: finalBalance }));
    } else {
      rows.push(await recordGameTx(tx, { ...base, type: "RECHARGE", amount, balanceAfter: round2(finalBalance - bonus) }));
      if (bonus > 0) rows.push(await recordGameTx(tx, { ...base, type: "BONUS", amount: bonus, balanceAfter: finalBalance }));
    }
    return rows;
  });
}

// ---------------------------------------------------------------------------------------------
// Game backends
// ---------------------------------------------------------------------------------------------

export async function topUpBackend(gameId: string, amountIn: number, note: string | undefined, actor: Actor) {
  const amount = toMoneyLarge(amountIn);
  return prisma.$transaction(async (tx) => {
    const game = await tx.game.update({
      where: { id: gameId },
      data: { backendBalance: { increment: amount }, backendUpdatedAt: new Date() },
    }).catch(() => null);
    if (!game) throw new GameError(404, "Game not found.");
    return tx.backendTopUp.create({
      data: { gameId, amount, balanceAfter: game.backendBalance, note: note?.trim() || null, staffId: actor.id },
    });
  });
}

/** Correct the backend balance to what the game's back office actually shows. */
export async function setBackendBalance(gameId: string, value: number, lowAt?: number) {
  const balance = round2(value);
  if (!Number.isFinite(balance) || Math.abs(balance) > 1e11) throw new GameError(400, "Enter a valid balance.");
  const data: Prisma.GameUpdateInput = { backendBalance: balance, backendUpdatedAt: new Date() };
  if (lowAt !== undefined) {
    if (!Number.isFinite(lowAt) || lowAt < 0 || lowAt > 1e11) throw new GameError(400, "Enter a valid low-balance alert.");
    data.backendLowAt = round2(lowAt);
  }
  const res = await prisma.game.updateMany({ where: { id: gameId }, data: data as Prisma.GameUpdateManyMutationInput });
  if (!res.count) throw new GameError(404, "Game not found.");
}

function toMoneyLarge(value: number) {
  const n = round2(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1e11) throw new GameError(400, "Enter a valid amount.");
  return n;
}
