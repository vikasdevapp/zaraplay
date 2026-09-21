import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";

export const adminBroadcastRouter = Router();

adminBroadcastRouter.get("/", async (_req, res) => {
  const broadcasts = await prisma.broadcastMessage.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ broadcasts });
});

const sendSchema = z.object({
  channel: z.enum(["SMS", "EMAIL"]),
  subject: z.string().max(120).optional(),
  body: z.string().min(1).max(2000),
});

// Sends to every user. No Twilio/SendGrid credentials are wired up yet (per project scope,
// see README) — this records the send and reports the recipient count it would have reached.
adminBroadcastRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { channel, subject, body } = parsed.data;

  if (channel === "EMAIL" && !subject) {
    return res.status(400).json({ error: "Subject is required for email broadcasts." });
  }

  const recipientCount = await prisma.user.count({
    where: channel === "SMS" ? { phone: { not: null }, phoneVerified: true } : { role: "USER" },
  });

  const broadcast = await prisma.broadcastMessage.create({
    data: { channel, subject: subject || null, body, recipientCount },
  });

  await logAudit(req.userId!, "BROADCAST_SENT", { targetType: "BroadcastMessage", targetId: broadcast.id, meta: { channel, recipientCount } });
  res.status(201).json({ broadcast, note: "Provider not configured — recorded only, not actually delivered." });
});
