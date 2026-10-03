import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { scopedGameIds } from "../../lib/gameScope";

/**
 * Per-game support inbox for the Agent Desk. A thread is (player, game); an agent (and their
 * staff) only see chats for their games, admins see all. Mounted under /api/agent/support.
 */
export const agentSupportRouter = Router();

const chatImageUrl = z.string().regex(/^\/uploads\/chat\/[\w.-]+$/, "Invalid image.");

const scopeOf = (req: AuthedRequest) => scopedGameIds({ id: req.userId!, role: req.role! });
async function gameAllowed(req: AuthedRequest, gameId: string) {
  const ids = await scopeOf(req);
  return ids === null || ids.includes(gameId);
}

// The games this actor supports (their scope; all for admins).
agentSupportRouter.get("/games", async (req: AuthedRequest, res) => {
  const ids = await scopeOf(req);
  const games = await prisma.game.findMany({
    where: ids === null ? {} : { id: { in: ids } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, imageUrl: true },
  });
  res.json({ games });
});

// One row per player who messaged about this game, newest first, with a reply-needed flag.
agentSupportRouter.get("/games/:gameId/threads", async (req: AuthedRequest, res) => {
  if (!(await gameAllowed(req, req.params.gameId))) return res.status(403).json({ error: "This game isn't one of yours." });
  const messages = await prisma.chatMessage.findMany({
    where: { gameId: req.params.gameId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, fullName: true, username: true } } },
  });
  const byUser = new Map<string, (typeof messages)[number]>();
  for (const m of messages) if (!byUser.has(m.userId)) byUser.set(m.userId, m);
  const threads = Array.from(byUser.values()).map((m) => ({
    user: m.user,
    lastMessage: m.body || (m.imageUrl ? "📷 Photo" : ""),
    lastSender: m.sender,
    lastAt: m.createdAt,
    needsReply: m.sender === "USER",
  }));
  res.json({ threads });
});

agentSupportRouter.get("/games/:gameId/threads/:userId/messages", async (req: AuthedRequest, res) => {
  if (!(await gameAllowed(req, req.params.gameId))) return res.status(403).json({ error: "This game isn't one of yours." });
  const messages = await prisma.chatMessage.findMany({
    where: { gameId: req.params.gameId, userId: req.params.userId },
    orderBy: { createdAt: "asc" },
    include: { sentBy: { select: { fullName: true, username: true } } },
  });
  res.json({ messages });
});

const replySchema = z
  .object({ body: z.string().max(2000).optional(), imageUrl: chatImageUrl.optional() })
  .refine((d) => (d.body && d.body.trim()) || d.imageUrl, "Message cannot be empty.");

agentSupportRouter.post("/games/:gameId/threads/:userId/messages", async (req: AuthedRequest, res) => {
  if (!(await gameAllowed(req, req.params.gameId))) return res.status(403).json({ error: "This game isn't one of yours." });
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  const message = await prisma.chatMessage.create({
    data: {
      userId: req.params.userId,
      gameId: req.params.gameId,
      sender: "AGENT",
      body: parsed.data.body?.trim() || "",
      imageUrl: parsed.data.imageUrl || null,
      sentById: req.userId!,
    },
    include: { sentBy: { select: { fullName: true, username: true } } },
  });
  res.status(201).json({ message });
});
