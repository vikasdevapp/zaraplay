import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { scopedGameIds } from "../../lib/gameScope";

/**
 * Per-game support ticket inbox for the Agent Desk. An agent (and their staff) only see tickets for
 * their games; admins see all. Each ticket carries a status (NEW/PENDING/SOLVED) and an unread
 * count. Mounted under /api/agent/support.
 */
export const agentSupportRouter = Router();

const chatImageUrl = z.string().regex(/^\/uploads\/chat\/[\w.-]+$/, "Invalid image.");

const scopeOf = (req: AuthedRequest) => scopedGameIds({ id: req.userId!, role: req.role! });
async function gameAllowed(req: AuthedRequest, gameId: string) {
  const ids = await scopeOf(req);
  return ids === null || ids.includes(gameId);
}

// The games this actor supports (their scope; all for admins), each with its open-ticket counts.
agentSupportRouter.get("/games", async (req: AuthedRequest, res) => {
  const ids = await scopeOf(req);
  const where = ids === null ? {} : { id: { in: ids } };
  const games = await prisma.game.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, imageUrl: true },
  });
  // Count tickets that still need attention (NEW) per game, for a quick badge.
  const grouped = await prisma.supportTicket.groupBy({
    by: ["gameId"],
    where: { status: "NEW", ...(ids === null ? {} : { gameId: { in: ids } }) },
    _count: { _all: true },
  });
  const newByGame = new Map(grouped.map((g) => [g.gameId, g._count._all]));
  res.json({ games: games.map((g) => ({ ...g, newTickets: newByGame.get(g.id) ?? 0 })) });
});

const statusEnum = ["NEW", "PENDING", "SOLVED"] as const;

// Tickets for a game, newest-updated first, optionally filtered by status.
agentSupportRouter.get("/games/:gameId/tickets", async (req: AuthedRequest, res) => {
  if (!(await gameAllowed(req, req.params.gameId))) return res.status(403).json({ error: "This game isn't one of yours." });
  const status = statusEnum.find((s) => s === req.query.status);
  const tickets = await prisma.supportTicket.findMany({
    where: { gameId: req.params.gameId, ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      user: { select: { id: true, fullName: true, username: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, imageUrl: true, sender: true, createdAt: true } },
    },
  });
  // How many tickets each of these users has ever opened (for "how many times they contacted us").
  const userIds = [...new Set(tickets.map((t) => t.userId))];
  const counts = await prisma.supportTicket.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true } });
  const totalByUser = new Map(counts.map((c) => [c.userId, c._count._all]));

  res.json({
    tickets: tickets.map((t) => {
      const last = t.messages[0];
      return {
        id: t.id,
        status: t.status,
        unread: t.staffUnread,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        user: t.user,
        userTicketCount: totalByUser.get(t.userId) ?? 1,
        lastMessage: last ? last.body || (last.imageUrl ? "📷 Photo" : "") : "",
        lastSender: last?.sender ?? null,
      };
    }),
  });
});

// Opening a ticket marks it read (clears the unread counter).
agentSupportRouter.get("/tickets/:ticketId/messages", async (req: AuthedRequest, res) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.ticketId } });
  if (!ticket || !ticket.gameId || !(await gameAllowed(req, ticket.gameId))) return res.status(404).json({ error: "Ticket not found." });
  const messages = await prisma.chatMessage.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "asc" },
    include: { sentBy: { select: { fullName: true, username: true } } },
  });
  if (ticket.staffUnread > 0) {
    await prisma.supportTicket.update({ where: { id: ticket.id }, data: { staffUnread: 0, staffLastReadAt: new Date() } });
  }
  res.json({ ticket: { id: ticket.id, status: ticket.status }, messages });
});

const replySchema = z
  .object({ body: z.string().max(2000).optional(), imageUrl: chatImageUrl.optional() })
  .refine((d) => (d.body && d.body.trim()) || d.imageUrl, "Message cannot be empty.");

agentSupportRouter.post("/tickets/:ticketId/messages", async (req: AuthedRequest, res) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.ticketId } });
  if (!ticket || !ticket.gameId || !(await gameAllowed(req, ticket.gameId))) return res.status(404).json({ error: "Ticket not found." });
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  const message = await prisma.chatMessage.create({
    data: {
      userId: ticket.userId,
      gameId: ticket.gameId,
      ticketId: ticket.id,
      sender: "AGENT",
      body: parsed.data.body?.trim() || "",
      imageUrl: parsed.data.imageUrl || null,
      sentById: req.userId!,
    },
    include: { sentBy: { select: { fullName: true, username: true } } },
  });
  // Replying moves it to PENDING (in progress) and clears the unread flag.
  await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "PENDING", staffUnread: 0, staffLastReadAt: new Date() } });
  res.status(201).json({ message });
});

agentSupportRouter.post("/tickets/:ticketId/resolve", async (req: AuthedRequest, res) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.ticketId } });
  if (!ticket || !ticket.gameId || !(await gameAllowed(req, ticket.gameId))) return res.status(404).json({ error: "Ticket not found." });
  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { status: "SOLVED", resolvedAt: new Date(), resolvedById: req.userId!, staffUnread: 0 },
  });
  res.json({ ok: true });
});

agentSupportRouter.post("/tickets/:ticketId/reopen", async (req: AuthedRequest, res) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.ticketId } });
  if (!ticket || !ticket.gameId || !(await gameAllowed(req, ticket.gameId))) return res.status(404).json({ error: "Ticket not found." });
  await prisma.supportTicket.update({ where: { id: ticket.id }, data: { status: "PENDING", resolvedAt: null, resolvedById: null } });
  res.json({ ok: true });
});
