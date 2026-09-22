import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const pushRouter = Router();

pushRouter.get("/vapid-public-key", (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

pushRouter.use(requireAuth);

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

pushRouter.post("/subscribe", async (req: AuthedRequest, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid subscription." });
  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: req.userId!, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: req.userId!, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });

  res.status(201).json({ ok: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

pushRouter.post("/unsubscribe", async (req: AuthedRequest, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });

  await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: req.userId! } });
  res.json({ ok: true });
});

pushRouter.get("/status", async (req: AuthedRequest, res) => {
  const count = await prisma.pushSubscription.count({ where: { userId: req.userId! } });
  res.json({ subscribed: count > 0 });
});
