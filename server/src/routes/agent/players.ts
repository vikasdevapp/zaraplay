import { Router, Response } from "express";
import { z } from "zod";
import { AuthedRequest } from "../../middleware/auth";
import { isPlayerInScope } from "../../lib/gameScope";
import { ModerationError, setUserBlocked, warnUser } from "../../lib/moderation";

/**
 * Agent/staff moderation of the players in their games: warn or block. Scoped — an actor can only
 * act on a player who holds one of their games (admins can act on anyone). Mounted at
 * /api/agent/players.
 */
export const agentPlayersRouter = Router();

function sendError(res: Response, err: unknown) {
  if (err instanceof ModerationError) return res.status(err.status).json({ error: err.message });
  throw err;
}

async function assertInScope(req: AuthedRequest, userId: string) {
  const ok = await isPlayerInScope({ id: req.userId!, role: req.role! }, userId);
  if (!ok) throw new ModerationError(403, "This player isn't in one of your games.");
}

const warnSchema = z.object({ message: z.string().min(1).max(500) });

agentPlayersRouter.post("/:id/warn", async (req: AuthedRequest, res) => {
  const parsed = warnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a warning message." });
  try {
    await assertInScope(req, req.params.id);
    await warnUser(req.params.id, parsed.data.message, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

const blockSchema = z.object({ reason: z.string().max(500).optional() });

agentPlayersRouter.post("/:id/block", async (req: AuthedRequest, res) => {
  const parsed = blockSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });
  try {
    await assertInScope(req, req.params.id);
    await setUserBlocked(req.params.id, true, parsed.data.reason, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

agentPlayersRouter.post("/:id/unblock", async (req: AuthedRequest, res) => {
  try {
    await assertInScope(req, req.params.id);
    await setUserBlocked(req.params.id, false, undefined, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});
