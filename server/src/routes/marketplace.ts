import { Router } from "express";
import { requireAuth } from "../middleware/auth";
// prisma intentionally not imported — the Marketplace (Free Play) is retired; see below.

export const marketplaceRouter = Router();
marketplaceRouter.use(requireAuth);

// The Marketplace ran on Free Play, which has been retired. The endpoints stay mounted so old
// clients don't hard-crash, but the feature is no longer offered (hidden from the app nav too).
marketplaceRouter.get("/items", async (_req, res) => {
  res.json({ items: [] });
});

marketplaceRouter.post("/redeem/:itemId", async (_req, res) => {
  res.status(410).json({ error: "The Marketplace is no longer available." });
});
