import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { sendSms } from "../../lib/sms";
import { sendPushBroadcast, isPushConfigured } from "../../lib/webpush";

export const adminBroadcastRouter = Router();

adminBroadcastRouter.get("/", async (_req, res) => {
  const broadcasts = await prisma.broadcastMessage.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ broadcasts });
});

const sendSchema = z.object({
  channel: z.enum(["SMS", "EMAIL", "PUSH"]),
  subject: z.string().max(120).optional(),
  body: z.string().min(1).max(2000),
});

// SMS delivers for real via Twilio when configured (lib/sms.ts falls back to a console log
// otherwise). PUSH delivers for real via Web Push when VAPID keys are configured. EMAIL still
// just records the send — no bulk email provider (SendGrid/SES) is wired up, see README.
adminBroadcastRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { channel, subject, body } = parsed.data;

  if (channel === "EMAIL" && !subject) {
    return res.status(400).json({ error: "Subject is required for email broadcasts." });
  }

  let recipientCount = 0;
  let note: string | undefined;

  if (channel === "SMS") {
    const recipients = await prisma.user.findMany({ where: { phone: { not: null }, phoneVerified: true }, select: { phone: true } });
    let delivered = 0;
    for (const r of recipients) {
      try {
        const sent = await sendSms(r.phone!, body.slice(0, 300));
        if (sent.delivered) delivered += 1;
      } catch (err) {
        console.error("Broadcast SMS failed for a recipient:", err);
      }
    }
    recipientCount = recipients.length;
    note = delivered === recipients.length ? undefined : "Twilio not configured — recorded only, not actually delivered (see README).";
  } else if (channel === "PUSH") {
    recipientCount = await sendPushBroadcast({ title: subject || "Zara Plays", body });
    if (!isPushConfigured()) note = "Push notifications not configured yet — recorded only, not actually delivered.";
  } else {
    recipientCount = await prisma.user.count({ where: { role: "USER" } });
    note = "Provider not configured — recorded only, not actually delivered.";
  }

  const broadcast = await prisma.broadcastMessage.create({
    data: { channel, subject: subject || null, body, recipientCount },
  });

  await logAudit(req.userId!, "BROADCAST_SENT", { targetType: "BroadcastMessage", targetId: broadcast.id, meta: { channel, recipientCount } });
  res.status(201).json({ broadcast, note });
});
