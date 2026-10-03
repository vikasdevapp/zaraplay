import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { scopedSupportAgentIds } from "../../lib/gameScope";

/**
 * Per-game support inbox for the Agent Desk. An agent (and their support staff) only see the chat
 * personas attached to their games; admins see all. Mounted under /api/agent/support.
 */
export const agentSupportRouter = Router();

const chatImageUrl = z.string().regex(/^\/uploads\/chat\/[\w.-]+$/, "Invalid image.");

// Resolve the actor's allowed support-agent ids (null = all, for admins).
async function allowedAgentIds(req: AuthedRequest): Promise<string[] | null> {
  return scopedSupportAgentIds({ id: req.userId!, role: req.role! });
}
async function assertAgentAllowed(req: AuthedRequest, agentId: string) {
  const ids = await allowedAgentIds(req);
  if (ids === null) return true;
  return ids.includes(agentId);
}

// The support personas this actor handles (the ones attached to their games).
agentSupportRouter.get("/agents", async (req: AuthedRequest, res) => {
  const ids = await allowedAgentIds(req);
  const agents = await prisma.supportAgent.findMany({
    where: ids === null ? {} : { id: { in: ids } },
    orderBy: { name: "asc" },
  });
  res.json({ agents });
});

// One row per player who messaged this persona, newest first, with a reply-needed flag.
agentSupportRouter.get("/agents/:agentId/threads", async (req: AuthedRequest, res) => {
  if (!(await assertAgentAllowed(req, req.params.agentId))) return res.status(403).json({ error: "This support channel isn't one of yours." });
  const messages = await prisma.chatMessage.findMany({
    where: { agentId: req.params.agentId },
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

agentSupportRouter.get("/agents/:agentId/threads/:userId/messages", async (req: AuthedRequest, res) => {
  if (!(await assertAgentAllowed(req, req.params.agentId))) return res.status(403).json({ error: "This support channel isn't one of yours." });
  const messages = await prisma.chatMessage.findMany({
    where: { agentId: req.params.agentId, userId: req.params.userId },
    orderBy: { createdAt: "asc" },
    include: { sentBy: { select: { fullName: true, username: true } } },
  });
  res.json({ messages });
});

const replySchema = z
  .object({ body: z.string().max(2000).optional(), imageUrl: chatImageUrl.optional() })
  .refine((d) => (d.body && d.body.trim()) || d.imageUrl, "Message cannot be empty.");

agentSupportRouter.post("/agents/:agentId/threads/:userId/messages", async (req: AuthedRequest, res) => {
  if (!(await assertAgentAllowed(req, req.params.agentId))) return res.status(403).json({ error: "This support channel isn't one of yours." });
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  const message = await prisma.chatMessage.create({
    data: {
      userId: req.params.userId,
      agentId: req.params.agentId,
      sender: "AGENT",
      body: parsed.data.body?.trim() || "",
      imageUrl: parsed.data.imageUrl || null,
      sentById: req.userId!,
    },
    include: { sentBy: { select: { fullName: true, username: true } } },
  });
  res.status(201).json({ message });
});
