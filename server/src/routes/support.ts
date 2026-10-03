import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { uploadChatImage } from "../lib/upload";

// Per-game support chat for players: a thread is (player, game), handled by that game's agent
// and their staff. (The old per-persona SupportAgent flow is gone.)
export const supportRouter = Router();
supportRouter.use(requireAuth);

// Attach a proof photo to a chat message. Returns a site-relative URL to send with the message.
supportRouter.post("/upload", uploadChatImage.single("image"), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  res.status(201).json({ url: `/uploads/chat/${req.file.filename}` });
});

// Only accept chat image URLs we produced, so a message can't point an <img> at anything else.
const chatImageUrl = z.string().regex(/^\/uploads\/chat\/[\w.-]+$/, "Invalid image.");

// The games the player can get support for (the ones they've added).
supportRouter.get("/games", async (req: AuthedRequest, res) => {
  const userGames = await prisma.userGame.findMany({
    where: { userId: req.userId!, status: { in: ["PENDING", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
    select: { game: { select: { id: true, name: true, imageUrl: true } } },
  });
  // De-duplicate by game id (a player has one account per game, but be safe).
  const seen = new Set<string>();
  const games = userGames
    .map((u) => u.game)
    .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  res.json({ games });
});

// A player may only chat about a game they've added.
async function assertOwnsGame(userId: string, gameId: string) {
  const ug = await prisma.userGame.findFirst({ where: { userId, gameId }, select: { id: true } });
  return !!ug;
}

supportRouter.get("/games/:gameId/messages", async (req: AuthedRequest, res) => {
  if (!(await assertOwnsGame(req.userId!, req.params.gameId))) return res.status(404).json({ error: "Game not found." });
  const messages = await prisma.chatMessage.findMany({
    where: { userId: req.userId!, gameId: req.params.gameId },
    orderBy: { createdAt: "asc" },
    omit: { sentById: true }, // which staff member replied is internal
  });
  res.json({ messages });
});

const sendSchema = z
  .object({ body: z.string().max(2000).optional(), imageUrl: chatImageUrl.optional() })
  .refine((d) => (d.body && d.body.trim()) || d.imageUrl, "Message cannot be empty.");

supportRouter.post("/games/:gameId/messages", async (req: AuthedRequest, res) => {
  if (!(await assertOwnsGame(req.userId!, req.params.gameId))) return res.status(404).json({ error: "Game not found." });
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  const message = await prisma.chatMessage.create({
    data: {
      userId: req.userId!,
      gameId: req.params.gameId,
      sender: "USER",
      body: parsed.data.body?.trim() || "",
      imageUrl: parsed.data.imageUrl || null,
    },
  });
  res.status(201).json({ message });
});
