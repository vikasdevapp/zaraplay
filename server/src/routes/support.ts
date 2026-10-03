import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { uploadChatImage } from "../lib/upload";

export const supportRouter = Router();
supportRouter.use(requireAuth);

// Attach a proof photo to a chat message. Returns a site-relative URL to send with the message.
supportRouter.post("/upload", uploadChatImage.single("image"), (req: AuthedRequest, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded." });
  res.status(201).json({ url: `/uploads/chat/${req.file.filename}` });
});

// Only accept chat image URLs we produced, so a message can't point an <img> at anything else.
const chatImageUrl = z.string().regex(/^\/uploads\/chat\/[\w.-]+$/, "Invalid image.");

supportRouter.get("/agents", async (_req, res) => {
  const agents = await prisma.supportAgent.findMany({ orderBy: { name: "asc" } });
  res.json({ agents });
});

supportRouter.get("/agents/:agentId/messages", async (req: AuthedRequest, res) => {
  const messages = await prisma.chatMessage.findMany({
    where: { userId: req.userId!, agentId: req.params.agentId },
    orderBy: { createdAt: "asc" },
    omit: { sentById: true }, // which staff member replied is internal
  });
  res.json({ messages });
});

const sendSchema = z
  .object({ body: z.string().max(2000).optional(), imageUrl: chatImageUrl.optional() })
  .refine((d) => (d.body && d.body.trim()) || d.imageUrl, "Message cannot be empty.");

supportRouter.post("/agents/:agentId/messages", async (req: AuthedRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message cannot be empty." });

  const agent = await prisma.supportAgent.findUnique({ where: { id: req.params.agentId } });
  if (!agent) return res.status(404).json({ error: "Agent not found." });

  const message = await prisma.chatMessage.create({
    data: { userId: req.userId!, agentId: agent.id, sender: "USER", body: parsed.data.body?.trim() || "", imageUrl: parsed.data.imageUrl || null },
  });

  res.status(201).json({ message });
});
