import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";

export const adminMarketplaceRouter = Router();

adminMarketplaceRouter.get("/", async (_req, res) => {
  const items = await prisma.marketplaceItem.findMany({ orderBy: { sortOrder: "asc" } });
  res.json({ items });
});

const itemSchema = z.object({
  name: z.string().min(1).max(60),
  category: z.string().min(1).max(30).default("Starter"),
  fpCost: z.number().positive(),
  cashValue: z.number().positive(),
  sortOrder: z.number().int().default(0),
});

adminMarketplaceRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const item = await prisma.marketplaceItem.create({ data: parsed.data });
  await logAudit(req.userId!, "MARKETPLACE_ITEM_CREATED", { targetType: "MarketplaceItem", targetId: item.id, meta: { name: item.name } });
  res.status(201).json({ item });
});

const updateSchema = itemSchema.partial().extend({ isActive: z.boolean().optional() });

adminMarketplaceRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const item = await prisma.marketplaceItem.update({ where: { id: req.params.id }, data: parsed.data }).catch(() => null);
  if (!item) return res.status(404).json({ error: "Item not found." });

  await logAudit(req.userId!, "MARKETPLACE_ITEM_UPDATED", { targetType: "MarketplaceItem", targetId: item.id, meta: parsed.data });
  res.json({ item });
});

adminMarketplaceRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const item = await prisma.marketplaceItem.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!item) return res.status(404).json({ error: "Item not found." });
  await logAudit(req.userId!, "MARKETPLACE_ITEM_DELETED", { targetType: "MarketplaceItem", targetId: item.id, meta: { name: item.name } });
  res.json({ ok: true });
});
