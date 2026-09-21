import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

export const marketplaceRouter = Router();
marketplaceRouter.use(requireAuth);

marketplaceRouter.get("/items", async (_req, res) => {
  const items = await prisma.marketplaceItem.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  res.json({ items });
});

// Redeeming spends free play immediately (held) and creates a PENDING cashout, so it
// flows through the same admin approval queue as any other cashout.
marketplaceRouter.post("/redeem/:itemId", async (req: AuthedRequest, res) => {
  const item = await prisma.marketplaceItem.findUnique({ where: { id: req.params.itemId } });
  if (!item || !item.isActive) return res.status(404).json({ error: "Item not available." });

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "Wallet not found." });

  if (Number(wallet.freePlay) < Number(item.fpCost)) {
    return res.status(400).json({ error: "Not enough free play to redeem this item." });
  }

  const result = await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({
      where: { userId: req.userId! },
      data: { freePlay: { decrement: item.fpCost } },
    });
    const transaction = await tx.transaction.create({
      data: {
        userId: req.userId!,
        type: "CASHOUT",
        amount: item.fpCost,
        status: "PENDING",
        payoutAmount: item.cashValue,
        forfeitedAmount: 0,
        meta: { fromFreePlay: true, marketplaceItemId: item.id, marketplaceItemName: item.name },
      },
    });
    return { wallet: w, transaction };
  });

  res.json({
    wallet: result.wallet,
    transaction: result.transaction,
    note: `Redeemed ${item.name} — $${Number(item.cashValue).toFixed(2)} pending admin approval.`,
  });
});
