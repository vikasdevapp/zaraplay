import { GameRequest, Prisma, UserGame } from "@prisma/client";
import { prisma } from "./prisma";
import { sendPushToUser } from "./webpush";
import { recordGameTx } from "./gameAccounts";
import { getJuwaClient, JuwaClient, JuwaError } from "./juwa";

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

    await tx.userGame.update({
      where: { id: ug.id },
      data: {
        status: "ACTIVE",
        gameUsername: created!.username,
        gamePassword: created!.password,
        gameUserId: created!.userId,
        balance: loadApplied ? firstLoad : 0,
        balanceSyncedAt: new Date(),
      },
    });

    if (firstLoad > 0 && loadApplied) {
      if (request.transactionId) await tx.transaction.update({ where: { id: request.transactionId }, data: { status: "COMPLETED" } });
      await recordGameTx(tx, { type: "RECHARGE", source: "WEB", gameId: ug.gameId, userGameId: ug.id, gameUsername: created!.username, amount: firstLoad, balanceAfter: firstLoad, staffId: null, gameRequestId: request.id });
    } else if (firstLoad > 0 && !loadApplied && request.transactionId) {
      // Account exists but the load didn't go through: hand the held money to the agent queue.
      await tx.gameRequest.update({ where: { id: request.id }, data: { transactionId: null } });
      await tx.gameRequest.create({ data: { userId: ug.userId!, userGameId: ug.id, type: "RECHARGE", amount: firstLoad, transactionId: request.transactionId } });
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
    const loaded = await tx.userGame.update({ where: { id: ug.id }, data: { balance: { increment: amount } } });
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

/**
 * An agent approved a redeem on an automated game: pull the money out via the API and credit the
 * wallet. Reads the real balance first (capping the payout at it) and forces the player offline
 * so the withdraw isn't blocked. Returns the real balance read, or throws a JuwaError to let the
 * agent fall back to a manual redeem.
 */
export async function executeAutoWithdraw(request: GameRequest, ug: UserGame & { game: { automationProvider: string | null } }) {
  const client = clientFor(ug.game.automationProvider);
  if (!client || !ug.gameUserId) throw new JuwaError(-1, "Automation is not available for this game.", true);

  await client.playerOffline(ug.gameUserId).catch(() => {}); // best effort; withdraw will tell us if still in game
  const realBalance = await client.userBalance(ug.gameUserId);
  const payout = Math.min(Number(request.amount), realBalance);
  if (payout <= 0) return { realBalance, payout: 0, transactionId: null };
  const { transactionId } = await client.withdraw(ug.gameUserId, payout, `wd_${request.id}`);
  return { realBalance, payout, transactionId };
}
