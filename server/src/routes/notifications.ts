import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// The bell menu: the most recent alerts plus how many are still unread.
notificationsRouter.get("/", async (req: AuthedRequest, res) => {
  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { userId: req.userId!, readAt: null } }),
  ]);
  res.json({ notifications, unread });
});

const readSchema = z.object({ ids: z.array(z.string().max(40)).max(100).optional() });

// Mark everything read, or just the ids passed (used when one alert is opened).
notificationsRouter.post("/read", async (req: AuthedRequest, res) => {
  const parsed = readSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
  const ids = parsed.data.ids;
  await prisma.notification.updateMany({
    where: { userId: req.userId!, readAt: null, ...(ids && ids.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  const unread = await prisma.notification.count({ where: { userId: req.userId!, readAt: null } });
  res.json({ ok: true, unread });
});
