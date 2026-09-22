import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";

export const adminRouletteRouter = Router();

adminRouletteRouter.get("/prizes", async (_req, res) => {
  const prizes = await prisma.roulettePrize.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({ prizes });
});

const prizeSchema = z.object({
  label: z.string().min(1).max(30),
  amount: z.number().nonnegative().default(0),
  weight: z.number().int().positive().default(1),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#8b5cf6"),
  sortOrder: z.number().int().default(0),
});

adminRouletteRouter.post("/prizes", async (req: AuthedRequest, res) => {
  const parsed = prizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const prize = await prisma.roulettePrize.create({ data: parsed.data });
  await logAudit(req.userId!, "ROULETTE_PRIZE_CREATED", { targetType: "RoulettePrize", targetId: prize.id, meta: { label: prize.label } });
  res.status(201).json({ prize });
});

const updateSchema = prizeSchema.partial().extend({ isActive: z.boolean().optional() });

adminRouletteRouter.patch("/prizes/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const prize = await prisma.roulettePrize.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!prize) return res.status(404).json({ error: "Prize not found." });

  await logAudit(req.userId!, "ROULETTE_PRIZE_UPDATED", { targetType: "RoulettePrize", targetId: prize.id, meta: parsed.data });
  res.json({ prize });
});

adminRouletteRouter.delete("/prizes/:id", async (req: AuthedRequest, res) => {
  const prize = await prisma.roulettePrize.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!prize) return res.status(404).json({ error: "Prize not found." });
  await logAudit(req.userId!, "ROULETTE_PRIZE_DELETED", { targetType: "RoulettePrize", targetId: prize.id, meta: { label: prize.label } });
  res.json({ ok: true });
});

adminRouletteRouter.get("/spins", async (_req, res) => {
  const spins = await prisma.rouletteSpin.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, fullName: true, username: true } } },
  });
  res.json({ spins });
});
