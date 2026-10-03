import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sendPushToUser } from "./webpush";
import { loadBasis, recordGameTx } from "./gameAccounts";
import { getJuwaClient, JuwaClient, JuwaError } from "./juwa";
import { getPlatformSettings } from "./settings";
import { settleWithdraw } from "./cashoutRules";

/**
 * Drives game platforms through their agent API so player actions happen instantly instead of
 * waiting for an agent. Every operation does its network calls OUTSIDE the DB transaction, then
 * commits in a short transaction. On any failure the request is left PENDING for the agent
 * queue, so nothing is ever stuck — automation is a fast path, the manual queue is the floor.
 */

type Tx = Prisma.TransactionClient;

export function isAutomated(game: { automationProvider: string | null }) {
  return game.automationProvider === "JUWA";
}

function clientFor(provider: string | null): JuwaClient | null {
  // Only JUWA today; this is where other providers plug in.
  return provider === "JUWA" ? getJuwaClient() : null;
}

const CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (l/1/o/0)
function randomToken(n: number) {
  return Array.from(require("crypto").randomBytes(n) as Buffer, (b) => CHARS[b % CHARS.length]).join("");
}
// Letters/numbers/underscore only (Juwa code 18); kept short and unique.
const newUsername = () => `zp${randomToken(8)}`;
const newPassword = () => randomToken(10);

export interface AutoCreateResult {
  created: boolean;
  gameUsername?: string;
  gamePassword?: string;
  // addUser succeeded but the first load couldn't be applied; it's queued for an agent.
  loadPending?: boolean;
}

/** Marks a fresh, unclaimed request done by automation (no agent); returns false if it was taken. */
async function autoFinish(tx: Tx, requestId: string, data: Prisma.GameRequestUncheckedUpdateManyInput) {
  const res = await tx.gameRequest.updateMany({
    where: { id: requestId, status: "PENDING", claimedById: null },
    data: { ...data, completedAt: new Date() },
  });
  return res.count > 0;
}

/**
 * Player added a game on an automated platform: create the real account (and apply the first
 * load) via the API, then activate it here. Returns { created: false } to fall back to an agent.
 */
export async function tryAutoCreateAccount(userGameId: string): Promise<AutoCreateResult> {
  const ug = await prisma.userGame.findUnique({ where: { id: userGameId }, include: { game: true } });
  if (!ug || ug.status !== "PENDING") return { created: false };
  if (!ug.game.automationProvider) return { created: false }; // manual game — expected, no log
  const client = clientFor(ug.game.automationProvider);
  if (!client) {
    console.warn(`[juwa-auto] ${ug.game.name} is set to automation but JUWA_BASE_URL/JUWA_AGENT_ID/JUWA_SECRET_KEY are not all set on the server — using the agent queue.`);
    return { created: false };
  }

  const request = await prisma.gameRequest.findFirst({ where: { userGameId, type: "CREATE_ACCOUNT", status: "PENDING", claimedById: null } });
  if (!request) return { created: false };
  const firstLoad = Number(request.amount);

  // Create the platform account (retry a new name if the platform says it's taken).
  let created: { userId: string; username: string; password: string } | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const username = newUsername();
    const password = newPassword();
    const clash = await prisma.userGame.findFirst({ where: { gameId: ug.gameId, gameUsername: { equals: username, mode: "insensitive" } }, select: { id: true } });
    if (clash) continue;
    try {
      const r = await client.addUser(username, password);
      created = { userId: r.userId, username, password };
    } catch (err) {
      if (err instanceof JuwaError && err.code === 20) continue; // name taken on the platform: try another
      const detail = err instanceof JuwaError ? `code ${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
      console.warn(`[juwa-auto] addUser failed for ${ug.game.name} (${detail}) — falling back to the agent queue.`);
      return { created: false }; // any other error (IP, permission, network): fall back to agent
    }
  }
  if (!created) return { created: false };

  // Apply the first load, if any. A failure here doesn't un-create the account.
  let loadApplied = false;
  if (firstLoad > 0) {
    try {
      await client.recharge(created.userId, firstLoad, `rc_${request.id}`);
      loadApplied = true;
    } catch (err) {
      const detail = err instanceof JuwaError ? `code ${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
      console.warn(`[juwa-auto] account ${created.username} created but first load failed (${detail}) — load queued for an agent.`);
      loadApplied = false;
    }
  }

  await prisma.$transaction(async (tx) => {
    const finished = await autoFinish(tx, request.id, {
      status: "COMPLETED",
      completedAmount: loadApplied ? firstLoad : 0,
      agentNote: "Created automatically on the game platform.",
    });
    if (!finished) return; // an agent grabbed it first; leave their flow alone

    const basis = loadApplied ? loadBasis(request) : { loadDeposit: 0, loadTotal: 0 };
    await tx.userGame.update({
      where: { id: ug.id },
      data: {
        status: "ACTIVE",
        gameUsername: created!.username,
        gamePassword: created!.password,
        gameUserId: created!.userId,
        balance: loadApplied ? firstLoad : 0,
        loadDeposit: basis.loadDeposit,
        loadTotal: basis.loadTotal,
        balanceSyncedAt: new Date(),
      },
    });

    if (firstLoad > 0 && loadApplied) {
      if (request.transactionId) await tx.transaction.update({ where: { id: request.transactionId }, data: { status: "COMPLETED" } });
      await recordGameTx(tx, { type: "RECHARGE", source: "WEB", gameId: ug.gameId, userGameId: ug.id, gameUsername: created!.username, amount: firstLoad, balanceAfter: firstLoad, staffId: null, gameRequestId: request.id });
    } else if (firstLoad > 0 && !loadApplied && request.transactionId) {
      // Account exists but the load didn't go through: hand the held money to the agent queue.
      await tx.gameRequest.update({ where: { id: request.id }, data: { transactionId: null } });
      await tx.gameRequest.create({ data: { userId: ug.userId!, userGameId: ug.id, type: "RECHARGE", amount: firstLoad, transactionId: request.transactionId, loadDeposit: request.loadDeposit } });
    }
  });

  return { created: true, gameUsername: created.username, gamePassword: created.password, loadPending: firstLoad > 0 && !loadApplied };
}

/** Player loaded more into an automated game: apply it via the API, else leave it for an agent. */
export async function tryAutoRecharge(requestId: string): Promise<boolean> {
  const request = await prisma.gameRequest.findUnique({ where: { id: requestId }, include: { userGame: { include: { game: true } } } });
  if (!request || request.type !== "RECHARGE" || request.status !== "PENDING") return false;
  const ug = request.userGame;
  const client = clientFor(ug.game.automationProvider);
  if (!client || !ug.gameUserId || ug.status !== "ACTIVE") return false;

  const amount = Number(request.amount);
  try {
    await client.recharge(ug.gameUserId, amount, `rc_${request.id}`);
  } catch {
    return false;
  }

  const notify = await prisma.$transaction(async (tx) => {
    if (!(await autoFinish(tx, request.id, { status: "COMPLETED", completedAmount: amount, agentNote: "Loaded automatically on the game platform." }))) return null;
    const basis = loadBasis(request);
    const loaded = await tx.userGame.update({ where: { id: ug.id }, data: { balance: { increment: amount }, loadDeposit: { increment: basis.loadDeposit }, loadTotal: { increment: basis.loadTotal } } });
    if (request.transactionId) await tx.transaction.update({ where: { id: request.transactionId }, data: { status: "COMPLETED" } });
    await recordGameTx(tx, { type: "RECHARGE", source: "WEB", gameId: ug.gameId, userGameId: ug.id, gameUsername: ug.gameUsername!, amount, balanceAfter: Number(loaded.balance), staffId: null, gameRequestId: request.id });
    return `$${amount.toFixed(2)} has been loaded into ${ug.game.name}.`;
  });
  if (notify) sendPushToUser(ug.userId!, { title: "Zara Plays", body: notify }).catch(() => {});
  return !!notify;
}

/** Player asked to reset their password on an automated game: set a new one via the API. */
export async function tryAutoResetPassword(requestId: string): Promise<boolean> {
  const request = await prisma.gameRequest.findUnique({ where: { id: requestId }, include: { userGame: { include: { game: true } } } });
  if (!request || request.type !== "PASSWORD_RESET" || request.status !== "PENDING") return false;
  const ug = request.userGame;
  const client = clientFor(ug.game.automationProvider);
  if (!client || !ug.gameUserId) return false;

  const password = newPassword();
  try {
    await client.resetPassword(ug.gameUserId, password);
  } catch {
    return false;
  }
  const done = await prisma.$transaction(async (tx) => {
    if (!(await autoFinish(tx, request.id, { status: "COMPLETED", agentNote: "Password reset automatically on the game platform." }))) return false;
    await tx.userGame.update({ where: { id: ug.id }, data: { gamePassword: password } });
    return true;
  });
  if (done) sendPushToUser(ug.userId!, { title: "Zara Plays", body: `Your ${ug.game.name} password has been reset. Open My Games to see it.` }).catch(() => {});
  return done;
}

/** Player tapped "Refresh balance" on an automated game: read it live and answer the check. */
export async function tryAutoBalanceCheck(requestId: string): Promise<boolean> {
  const request = await prisma.gameRequest.findUnique({ where: { id: requestId }, include: { userGame: { include: { game: true } } } });
  if (!request || request.type !== "BALANCE_CHECK" || request.status !== "PENDING") return false;
  const ug = request.userGame;
  const client = clientFor(ug.game.automationProvider);
  if (!client || !ug.gameUserId) return false;

  let balance: number;
  try {
    balance = await client.userBalance(ug.gameUserId);
  } catch {
    return false;
  }
  const done = await prisma.$transaction(async (tx) => {
    if (!(await autoFinish(tx, request.id, { status: "COMPLETED", completedAmount: balance, agentNote: "Balance read automatically from the game platform." }))) return false;
    await tx.userGame.update({ where: { id: ug.id }, data: { balance, balanceSyncedAt: new Date() } });
    // Answer any other open balance checks for this account with the same reading.
    await tx.gameRequest.updateMany({
      where: { userGameId: ug.id, type: "BALANCE_CHECK", status: "PENDING", id: { not: request.id } },
      data: { status: "COMPLETED", completedAmount: balance, completedAt: new Date(), agentNote: "Answered by a balance read." },
    });
    return true;
  });
  if (done) sendPushToUser(ug.userId!, { title: "Zara Plays", body: `Your ${ug.game.name} balance is $${balance.toFixed(2)}.` }).catch(() => {});
  return done;
}

export type AutoWithdrawResult =
  // Paid out instantly: payout credited to the wallet, forfeit kept by the house, leftover re-tiered.
  | { status: "done"; payout: number; forfeit: number; leftover: number; min: number; max: number | null; balance: number }
  // Rules not met (e.g. playthrough) — nothing moved; `reason` is the player-facing message.
  | { status: "rejected"; reason: string; min: number; max: number | null; balance: number }
  // The game platform couldn't be reached; the caller should queue the redeem for an agent.
  | { status: "fallback" };

/**
 * Player tapped "Withdraw Credits" on an automated game. Reads the real balance live, applies the
 * cashout tier rules, and — when eligible — pulls the money out via the API and credits the wallet,
 * all without an agent. Anything above the tier cap is forfeited; whatever stays in the game
 * re-tiers as the next load basis. If the platform can't be reached it returns "fallback" so the
 * caller can hand the redeem to the agent queue instead (automation is the fast path, never a wall).
 */
export async function autoWithdrawFromGame(userId: string, userGameId: string, requested: number): Promise<AutoWithdrawResult> {
  const ug = await prisma.userGame.findFirst({ where: { id: userGameId, userId }, include: { game: true } });
  if (!ug || !ug.gameUserId || ug.status !== "ACTIVE") return { status: "fallback" };
  const client = clientFor(ug.game.automationProvider);
  if (!client) return { status: "fallback" };

  // Read the live balance (and force the player offline so the later withdraw isn't blocked).
  let realBalance: number;
  try {
    await client.playerOffline(ug.gameUserId).catch(() => {});
    realBalance = await client.userBalance(ug.gameUserId);
  } catch (err) {
    const detail = err instanceof JuwaError ? `code ${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    console.warn(`[juwa-auto] balance read failed for withdraw on ${ug.game.name} (${detail}) — handing the redeem to the agent queue.`);
    return { status: "fallback" };
  }

  // Keep our recorded balance honest regardless of the outcome.
  await prisma.userGame.update({ where: { id: ug.id }, data: { balance: realBalance, balanceSyncedAt: new Date() } }).catch(() => {});

  const settings = await getPlatformSettings();
  const s = settleWithdraw(Number(ug.loadDeposit), Number(ug.loadTotal), realBalance, requested, settings);
  if (!s.eligible) return { status: "rejected", reason: s.reason!, min: s.min, max: s.max, balance: realBalance };

  // Pull out everything that isn't staying in the game: the payout plus any forfeited overflow.
  const pulled = Math.round((s.payout + s.forfeit) * 100) / 100;
  try {
    if (pulled > 0) await client.withdraw(ug.gameUserId, pulled, `wd_${ug.id}_${Date.now()}`);
  } catch (err) {
    const detail = err instanceof JuwaError ? `code ${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
    console.warn(`[juwa-auto] withdraw API failed on ${ug.game.name} (${detail}) — handing the redeem to the agent queue.`);
    return { status: "fallback" };
  }

  const note = s.forfeit > 0 ? `Auto-withdraw: $${s.forfeit.toFixed(2)} forfeited above the cashout cap.` : "Withdrawn automatically from the game platform.";
  await prisma.$transaction(async (tx) => {
    const t = await tx.transaction.create({
      data: {
        userId,
        type: "GAME_REDEEM",
        amount: s.payout,
        status: "COMPLETED",
        meta: { userGameId: ug.id, gameId: ug.gameId, requestedAmount: requested, forfeit: s.forfeit, leftover: s.leftover, auto: true },
      },
    });
    const req = await tx.gameRequest.create({
      data: { userId, userGameId: ug.id, type: "REDEEM", amount: requested, status: "COMPLETED", completedAmount: s.payout, completedAt: new Date(), transactionId: t.id, agentNote: note },
    });
    if (s.payout > 0) await tx.wallet.update({ where: { userId }, data: { balance: { increment: s.payout } } });
    await tx.userGame.update({
      where: { id: ug.id },
      // Whatever stays in the game re-tiers as the new load basis for the next withdrawal.
      data: { balance: s.leftover, loadDeposit: s.leftover, loadTotal: s.leftover, balanceSyncedAt: new Date() },
    });
    if (s.payout > 0) {
      await recordGameTx(tx, { type: "REDEEM", source: "WEB", gameId: ug.gameId, userGameId: ug.id, gameUsername: ug.gameUsername!, amount: s.payout, balanceAfter: s.leftover, staffId: null, gameRequestId: req.id, note });
    }
  });

  if (s.payout > 0) {
    const body = s.forfeit > 0
      ? `$${s.payout.toFixed(2)} from ${ug.game.name} was added to your wallet. $${s.forfeit.toFixed(2)} above the cashout cap was forfeited.`
      : `$${s.payout.toFixed(2)} from ${ug.game.name} has been added to your wallet.`;
    sendPushToUser(userId, { title: "Zara Plays", body }).catch(() => {});
  }
  return { status: "done", payout: s.payout, forfeit: s.forfeit, leftover: s.leftover, min: s.min, max: s.max, balance: realBalance };
}
