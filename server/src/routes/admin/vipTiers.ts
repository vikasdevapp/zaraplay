import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";

export const adminVipTiersRouter = Router();

adminVipTiersRouter.get("/", async (_req, res) => {
  const tiers = await prisma.vipTier.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({ tiers });
});

const tierSchema = z.object({
  name: z.string().min(1).max(40),
  emoji: z.string().min(1).max(8).default("⭐"),
  colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#D4AF37"),
  minDeposit: z.number().nonnegative().default(0),
  minReferrals: z.number().int().nonnegative().default(0),
  perks: z.array(z.string().max(120)).default([]),
  sortOrder: z.number().int().default(0),
});

adminVipTiersRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = tierSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const tier = await prisma.vipTier.create({ data: parsed.data });
  await logAudit(req.userId!, "VIP_TIER_CREATED", { targetType: "VipTier", targetId: tier.id, meta: { name: tier.name } });
  res.status(201).json({ tier });
});

const updateSchema = tierSchema.partial().extend({ isActive: z.boolean().optional() });

adminVipTiersRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const tier = await prisma.vipTier.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!tier) return res.status(404).json({ error: "Tier not found." });

  await logAudit(req.userId!, "VIP_TIER_UPDATED", { targetType: "VipTier", targetId: tier.id, meta: parsed.data });
  res.json({ tier });
});

adminVipTiersRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const tier = await prisma.vipTier.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!tier) return res.status(404).json({ error: "Tier not found." });
  await logAudit(req.userId!, "VIP_TIER_DELETED", { targetType: "VipTier", targetId: tier.id, meta: { name: tier.name } });
  res.json({ ok: true });
});
