import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { uploadChatImage } from "../lib/upload";
import { optimizeImageInPlace } from "../lib/imageOptimize";

// Per-game support tickets for players. A ticket is one conversation; once staff mark it SOLVED it
// clears from the player's view and the next message opens a fresh ticket.
export const supportRouter = Router();
supportRouter.use(requireAuth);

// Attach a proof photo to a chat message. Returns a site-relative URL to send with the message.
supportRouter.post("/upload", uploadChatImage.single("image"), async (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  await optimizeImageInPlace(req.file.path, 1280);
  res.status(201).json({ url: `/uploads/chat/${req.file.filename}` });
});

const chatImageUrl = z.string().regex(/^\/uploads\/chat\/[\w.-]+$/, "Invalid image.");

// The games the player can get support for (the ones they've added).
supportRouter.get("/games", async (req: AuthedRequest, res) => {
  const userGames = await prisma.userGame.findMany({
    where: { userId: req.userId!, status: { in: ["PENDING", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
    select: { game: { select: { id: true, name: true, imageUrl: true } } },
  });
  const seen = new Set<string>();
  const games = userGames.map((u) => u.game).filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)));
  res.json({ games });
});

async function assertOwnsGame(userId: string, gameId: string) {
  const ug = await prisma.userGame.findFirst({ where: { userId, gameId }, select: { id: true } });
  return !!ug;
}

// The player's current (not-yet-solved) ticket for a game, if any.
function activeTicket(userId: string, gameId: string) {
  return prisma.supportTicket.findFirst({
    where: { userId, gameId, status: { not: "SOLVED" } },
    orderBy: { createdAt: "desc" },
  });
}

supportRouter.get("/games/:gameId/messages", async (req: AuthedRequest, res) => {
  if (!(await assertOwnsGame(req.userId!, req.params.gameId))) return res.status(404).json({ error: "Game not found." });
  const ticket = await activeTicket(req.userId!, req.params.gameId);
  if (!ticket) return res.json({ messages: [], ticketStatus: null });
  const messages = await prisma.chatMessage.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "asc" },
    omit: { sentById: true },
  });
  res.json({ messages, ticketStatus: ticket.status });
});

const sendSchema = z
  .object({ body: z.string().max(2000).optional(), imageUrl: chatImageUrl.optional() })
  .refine((d) => (d.body && d.body.trim()) || d.imageUrl, "Message cannot be empty.");

supportRouter.post("/games/:gameId/messages", async (req: AuthedRequest, res) => {
  if (!(await assertOwnsGame(req.userId!, req.params.gameId))) return res.status(404).json({ error: "Game not found." });
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  // Reuse the open ticket or start a new one; sending always leaves it NEW (waiting for staff)
  // and bumps the unread counter staff see.
  let ticket = await activeTicket(req.userId!, req.params.gameId);
  if (!ticket) {
    ticket = await prisma.supportTicket.create({ data: { userId: req.userId!, gameId: req.params.gameId, status: "NEW", staffUnread: 1 } });
  } else {
    await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "NEW", staffUnread: { increment: 1 } } });
  }

  const message = await prisma.chatMessage.create({
    data: {
      userId: req.userId!,
      gameId: req.params.gameId,
      ticketId: ticket.id,
      sender: "USER",
      body: parsed.data.body?.trim() || "",
      imageUrl: parsed.data.imageUrl || null,
    },
  });
  res.status(201).json({ message, ticketStatus: "NEW" });
});
