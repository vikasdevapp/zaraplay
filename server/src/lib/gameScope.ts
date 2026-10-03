import { prisma } from "./prisma";

export type ScopeActor = { id: string; role: string };

export function isAdminRole(role: string) {
  return role === "ADMIN" || role === "MASTER_ADMIN";
}

/**
 * The set of game ids an actor may see/act on, or `null` for "all games".
 *  - ADMIN / MASTER_ADMIN -> null (everything)
 *  - AGENT                -> the games they own (Game.agentId)
 *  - SUPPORT (staff)      -> the single game they're scoped to (User.staffGameId)
 *  - anyone else          -> [] (nothing)
 */
export async function scopedGameIds(actor: ScopeActor): Promise<string[] | null> {
  if (isAdminRole(actor.role)) return null;
  if (actor.role === "AGENT") {
    const games = await prisma.game.findMany({ where: { agentId: actor.id }, select: { id: true } });
    return games.map((g) => g.id);
  }
  if (actor.role === "SUPPORT") {
    const u = await prisma.user.findUnique({ where: { id: actor.id }, select: { staffGameId: true } });
    return u?.staffGameId ? [u.staffGameId] : [];
  }
  return [];
}

/** A Prisma `where` fragment limiting a `gameId` column to the actor's scope ({} for admins). */
export function gameIdWhere(ids: string[] | null) {
  return ids === null ? {} : { gameId: { in: ids } };
}

/** A Prisma `where` fragment limiting a relation that has a `gameId` (e.g. userGame) to scope. */
export function nestedGameIdWhere(relation: string, ids: string[] | null) {
  return ids === null ? {} : { [relation]: { gameId: { in: ids } } };
}
