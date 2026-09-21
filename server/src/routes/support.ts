import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

export const supportRouter = Router();
supportRouter.use(requireAuth);

supportRouter.get("/agents", async (_req, res) => {
  const agents = await prisma.supportAgent.findMany({ orderBy: { name: "asc" } });
  res.json({ agents });
});

supportRouter.get("/agents/:agentId/messages", async (req: AuthedRequest, res) => {
  const messages = await prisma.chatMessage.findMany({
    where: { userId: req.userId!, agentId: req.params.agentId },
    orderBy: { createdAt: "asc" },
  });
  res.json({ messages });
});

const sendSchema = z.object({ body: z.string().min(1).max(2000) });

supportRouter.post("/agents/:agentId/messages", async (req: AuthedRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  const agent = await prisma.supportAgent.findUnique({ where: { id: req.params.agentId } });
  if (!agent) return res.status(404).json({ error: "Agent not found." });

  const message = await prisma.chatMessage.create({
    data: { userId: req.userId!, agentId: agent.id, sender: "USER", body: parsed.data.body },
  });

  res.status(201).json({ message });
});
