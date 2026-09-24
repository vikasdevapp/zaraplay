import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { completeDeposit, rejectDeposit } from "../../utils/deposit";
import { closePayOrder, GatewayError } from "../../lib/ggusonepay";
import { PROVIDER, syncDeposit } from "../../lib/paymentSync";

export const adminDepositsRouter = Router();

adminDepositsRouter.get("/", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "PENDING";
  const validStatuses = ["PENDING", "COMPLETED", "REJECTED"];
  const where = validStatuses.includes(status)
    ? { type: "DEPOSIT" as const, status: status as "PENDING" | "COMPLETED" | "REJECTED" }
    : { type: "DEPOSIT" as const };

  const deposits = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    include: { user: { select: { id: true, fullName: true, username: true, email: true } } },
  });
  res.json({ deposits });
});

adminDepositsRouter.post("/:id/approve", async (req: AuthedRequest, res) => {
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "DEPOSIT") return res.status(404).json({ error: "Deposit request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });

  // Gateway deposits credit themselves when the gateway confirms payment; approving one by hand
  // is only for settling an amount mismatch the gateway already reported as paid.
  if (transaction.gatewayProvider && !(transaction.meta as { amountMismatch?: boolean } | null)?.amountMismatch) {
    return res.status(409).json({ error: "This deposit is paid through the gateway. Use Check status instead." });
  }

  const updated = await completeDeposit(transaction.id, { approvedManually: true });
  if (!updated) return res.status(409).json({ error: "This request was already processed." });

  await logAudit(req.userId!, "DEPOSIT_APPROVED", {
    targetType: "Transaction",
    targetId: transaction.id,
    meta: { userId: transaction.userId, amount: Number(transaction.amount) },
  });
  res.json({ transaction: updated });
});

// Re-reads a gateway deposit's state (for when a callback was missed).
adminDepositsRouter.post("/:id/sync", async (req: AuthedRequest, res) => {
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "DEPOSIT") return res.status(404).json({ error: "Deposit request not found." });
  if (transaction.gatewayProvider !== PROVIDER) return res.status(400).json({ error: "This deposit was not made through the gateway." });
  try {
    res.json({ transaction: await syncDeposit(transaction) });
  } catch (err) {
    res.status(502).json({ error: err instanceof GatewayError ? err.message : "Payment gateway is unavailable." });
  }
});

const rejectSchema = z.object({ reason: z.string().max(200).optional() });

adminDepositsRouter.post("/:id/reject", async (req: AuthedRequest, res) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "DEPOSIT") return res.status(404).json({ error: "Deposit request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });

  if (transaction.gatewayProvider === PROVIDER) {
    // The user may have paid in the meantime: re-check, then close the order at the gateway
    // so it can't be paid after we've rejected it.
    try {
      const synced = await syncDeposit(transaction);
      if (synced.status !== "PENDING") {
        return res.status(409).json({ error: `The gateway reports this deposit as ${synced.status.toLowerCase()}.`, transaction: synced });
      }
      if ((synced.meta as { amountMismatch?: boolean } | null)?.amountMismatch) {
        return res.status(409).json({ error: "The user paid a different amount; approve it or settle it in the gateway dashboard." });
      }
      await closePayOrder(transaction.id);
    } catch (err) {
      return res.status(502).json({
        error: `Could not confirm with the payment gateway, so the deposit was left pending: ${err instanceof GatewayError ? err.message : "gateway unavailable"}`,
      });
    }
  }

  const updated = await rejectDeposit(transaction.id, parsed.data.reason || null);
  if (!updated) return res.status(409).json({ error: "This request was already processed." });

  await logAudit(req.userId!, "DEPOSIT_REJECTED", { targetType: "Transaction", targetId: transaction.id, meta: { userId: transaction.userId, reason: parsed.data.reason } });
  res.json({ transaction: updated });
});
