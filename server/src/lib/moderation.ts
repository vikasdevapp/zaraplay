import { prisma } from "./prisma";
import { notifyUser } from "./webpush";
import { clearSession } from "./tokens";
import { logAudit } from "./audit";

export class ModerationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Only players (role USER) can be warned or blocked from these tools — never staff accounts.
async function playerOrThrow(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) throw new ModerationError(404, "User not found.");
  if (user.role !== "USER") throw new ModerationError(400, "This action is only for player accounts.");
  return user;
}

/** Sends a warning that lands in the player's notification bell (and a push). */
export async function warnUser(userId: string, message: string, byId: string) {
  await playerOrThrow(userId);
  const body = message.trim();
  if (!body) throw new ModerationError(400, "Enter a warning message.");
  await notifyUser(userId, { title: "⚠️ Warning from Zara Plays", body, kind: "WARNING" });
  await logAudit(byId, "USER_WARNED", { targetType: "User", targetId: userId, meta: { message: body } });
}

/** Blocks or unblocks a player. Blocking logs them out everywhere and notifies them. */
export async function setUserBlocked(userId: string, blocked: boolean, reason: string | undefined, byId: string) {
  await playerOrThrow(userId);
  await prisma.user.update({
    where: { id: userId },
    data: { blockedAt: blocked ? new Date() : null, blockedReason: blocked ? reason?.trim() || null : null },
  });
  if (blocked) {
    await clearSession(userId).catch(() => {}); // sign them out of every device
    await notifyUser(userId, {
      title: "Account blocked",
      body: reason?.trim() || "Your account has been blocked. Please contact support.",
      kind: "WARNING",
    });
  }
  await logAudit(byId, blocked ? "USER_BLOCKED" : "USER_UNBLOCKED", { targetType: "User", targetId: userId, meta: { reason: reason?.trim() || null } });
}
