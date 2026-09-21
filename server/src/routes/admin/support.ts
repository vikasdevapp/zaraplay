import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";

export const adminSupportRouter = Router();

adminSupportRouter.get("/agents", async (_req, res) => {
  const agents = await prisma.supportAgent.findMany({ orderBy: { name: "asc" } });
  res.json({ agents });
});

const createAgentSchema = z.object({ name: z.string().min(1).max(60) });

adminSupportRouter.post("/agents", async (req, res) => {
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid name." });
  const agent = await prisma.supportAgent.create({ data: { name: parsed.data.name } });
  res.status(201).json({ agent });
});

const toggleAgentSchema = z.object({ isOnline: z.boolean() });

adminSupportRouter.patch("/agents/:id", async (req, res) => {
  const parsed = toggleAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });
  const agent = await prisma.supportAgent.update({ where: { id: req.params.id }, data: { isOnline: parsed.data.isOnline } });
  res.json({ agent });
});

// One row per user who has messaged this agent, with a preview of the latest message.
adminSupportRouter.get("/agents/:agentId/threads", async (req, res) => {
  const messages = await prisma.chatMessage.findMany({
    where: { agentId: req.params.agentId },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { id: true, fullName: true, username: true } } },
  });

  const byUser = new Map<string, (typeof messages)[number]>();
  for (const m of messages) {
    if (!byUser.has(m.userId)) byUser.set(m.userId, m);
  }

  const threads = Array.from(byUser.values()).map((m) => ({
    user: m.user,
    lastMessage: m.body,
    lastSender: m.sender,
    lastAt: m.createdAt,
    needsReply: m.sender === "USER",
  }));

  res.json({ threads });
});

adminSupportRouter.get("/agents/:agentId/threads/:userId/messages", async (req, res) => {
  const messages = await prisma.chatMessage.findMany({
    where: { agentId: req.params.agentId, userId: req.params.userId },
    orderBy: { createdAt: "asc" },
  });
  res.json({ messages });
});

const replySchema = z.object({ body: z.string().min(1).max(2000) });

adminSupportRouter.post("/agents/:agentId/threads/:userId/messages", async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  const message = await prisma.chatMessage.create({
    data: { userId: req.params.userId, agentId: req.params.agentId, sender: "AGENT", body: parsed.data.body },
  });
  res.status(201).json({ message });
});
