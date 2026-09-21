import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";

export const adminCashoutsRouter = Router();

adminCashoutsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "PENDING";
  const validStatuses = ["PENDING", "COMPLETED", "REJECTED"];
  const where = validStatuses.includes(status) ? { type: "CASHOUT" as const, status: status as "PENDING" | "COMPLETED" | "REJECTED" } : { type: "CASHOUT" as const };

  const cashouts = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    include: { user: { select: { id: true, fullName: true, username: true, email: true } } },
  });
  res.json({ cashouts });
});

adminCashoutsRouter.post("/:id/approve", async (req: AuthedRequest, res) => {
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "CASHOUT") return res.status(404).json({ error: "Cashout request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });

  const updated = await prisma.transaction.update({
    where: { id: transaction.id },
    data: { status: "COMPLETED" },
  });
  await logAudit(req.userId!, "CASHOUT_APPROVED", { targetType: "Transaction", targetId: transaction.id, meta: { userId: transaction.userId, amount: transaction.amount } });
  res.json({ transaction: updated });
});

const rejectSchema = z.object({ reason: z.string().max(200).optional() });

adminCashoutsRouter.post("/:id/reject", async (req: AuthedRequest, res) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "CASHOUT") return res.status(404).json({ error: "Cashout request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });

  const fromFreePlay = (transaction.meta as { fromFreePlay?: boolean } | null)?.fromFreePlay ?? false;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { userId: transaction.userId },
      data: fromFreePlay
        ? { freePlay: { increment: transaction.amount } }
        : { balance: { increment: transaction.amount } },
    });
    return tx.transaction.update({
      where: { id: transaction.id },
      data: { status: "REJECTED", adminNote: parsed.data.reason || null },
    });
  });

  await logAudit(req.userId!, "CASHOUT_REJECTED", {
    targetType: "Transaction",
    targetId: transaction.id,
    meta: { userId: transaction.userId, amount: transaction.amount, reason: parsed.data.reason },
  });
  res.json({ transaction: updated });
});
