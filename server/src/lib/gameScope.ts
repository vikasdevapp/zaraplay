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

/**
 * The support-agent (chat persona) ids an actor may handle, or `null` for all (admins). These are
 * the SupportAgents attached to the actor's scoped games.
 */
export async function scopedSupportAgentIds(actor: ScopeActor): Promise<string[] | null> {
  const games = await scopedGameIds(actor);
  if (games === null) return null;
  const rows = await prisma.game.findMany({
    where: { id: { in: games }, supportAgentId: { not: null } },
    select: { supportAgentId: true },
  });
  return [...new Set(rows.map((r) => r.supportAgentId!).filter(Boolean))];
}

/** A Prisma `where` fragment limiting the Game table's own `id` to the actor's scope. */
export function ownGameWhere(ids: string[] | null) {
  return ids === null ? {} : { id: { in: ids } };
}

/**
 * The effective `gameId` filter combining the actor's scope with a requested gameId, so a
 * requested id can never widen the scope:
 *  - admin (null scope): the requested id, or no filter.
 *  - scoped, id in scope: just that id.
 *  - scoped, id out of scope: an impossible filter (empty result).
 *  - scoped, no id: all of the scope.
 */
export function effectiveGameWhere(ids: string[] | null, requested?: string) {
  if (ids === null) return requested ? { gameId: requested } : {};
  if (requested) return ids.includes(requested) ? { gameId: requested } : { gameId: { in: [] as string[] } };
  return { gameId: { in: ids } };
}

/** A Prisma `where` fragment limiting a relation that has a `gameId` (e.g. userGame) to scope. */
export function nestedGameIdWhere(relation: string, ids: string[] | null) {
  return ids === null ? {} : { [relation]: { gameId: { in: ids } } };
}

/**
 * A Prisma `where` fragment that limits to players who have at least one game in scope. Used for
 * wallet-level rows (cashouts/deposits) that aren't tied to a game but belong to such a player.
 */
export function playerInScopeWhere(ids: string[] | null) {
  return ids === null ? {} : { user: { games: { some: { gameId: { in: ids } } } } };
}

/** Whether a player falls in an actor's scope (holds a game the actor manages; true for admins). */
export async function isPlayerInScope(actor: ScopeActor, userId: string): Promise<boolean> {
  const ids = await scopedGameIds(actor);
  if (ids === null) return true;
  const ug = await prisma.userGame.findFirst({ where: { userId, gameId: { in: ids } }, select: { id: true } });
  return !!ug;
}
