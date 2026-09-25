import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { createTransfer, FINAL_FAILURE_STATES, gateway, GatewayError, ORDER_STATE, TRANSFER_ACCOUNT_FIELD } from "../../lib/ggusonepay";
import { PROVIDER, syncCashout } from "../../lib/paymentSync";
import { openSecret } from "../../lib/secretBox";
import { completeCashout, refundCashout } from "../../utils/payout";

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
  // The only query that loads the sealed card number (omitted everywhere else).
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id }, omit: { payoutSecret: false } });
  if (!transaction || transaction.type !== "CASHOUT") return res.status(404).json({ error: "Cashout request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });
  if (transaction.gatewayProvider) return res.status(409).json({ error: "This payout was already sent to the payment gateway." });

  const payout = (transaction.meta as { payout?: { wayCode: string; account: string; cardValid?: string } } | null)?.payout;
  const auditMeta = { userId: transaction.userId, amount: transaction.amount, payout };

  // No payout details (manual request, or gateway not configured): the admin paid it by hand.
  if (!payout || !gateway.transferEnabled) {
    const updated = await completeCashout(transaction.id, { paidManually: true });
    if (!updated) return res.status(409).json({ error: "This request was already processed." });
    await logAudit(req.userId!, "CASHOUT_APPROVED", { targetType: "Transaction", targetId: transaction.id, meta: auditMeta });
    return res.json({ transaction: updated });
  }

  // Build the gateway's wayParam before claiming, so a bad/missing card record fails cleanly.
  let wayParam: Record<string, string>;
  if (payout.wayCode === "card") {
    if (!transaction.payoutSecret || !payout.cardValid) {
      return res.status(400).json({ error: "Card details are missing for this request; reject it and ask the user to resubmit." });
    }
    try {
      wayParam = { cardNumber: openSecret(transaction.payoutSecret), cardValid: payout.cardValid };
    } catch {
      return res.status(500).json({ error: "Could not decrypt the card details (check PAYOUT_ENCRYPTION_KEY)." });
    }
  } else {
    const field = TRANSFER_ACCOUNT_FIELD[payout.wayCode];
    if (!field) return res.status(400).json({ error: `Unsupported payout method: ${payout.wayCode}` });
    wayParam = { [field]: payout.account };
  }

  // Claim the cashout for the gateway before calling it, so a double click or a concurrent
  // reject can't send the same payout twice or refund one that's already on its way.
  const claimed = await prisma.transaction.updateMany({
    where: { id: transaction.id, status: "PENDING", gatewayProvider: null },
    data: { gatewayProvider: PROVIDER },
  });
  if (claimed.count === 0) return res.status(409).json({ error: "This request was already processed." });

  try {
    const order = await createTransfer({
      mchOrderNo: transaction.id,
      amount: Number(transaction.payoutAmount ?? transaction.amount),
      wayCode: payout.wayCode,
      wayParam,
    });
    await prisma.transaction.update({
      where: { id: transaction.id },
      // The card number has done its job once the gateway holds the transfer.
      data: { gatewayOrderNo: order.transferOrderNo, payoutSecret: null },
    });
    await logAudit(req.userId!, "CASHOUT_APPROVED", {
      targetType: "Transaction",
      targetId: transaction.id,
      meta: { ...auditMeta, transferOrderNo: order.transferOrderNo },
    });

    let updated = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    if (order.state === ORDER_STATE.SUCCESS) updated = await completeCashout(transaction.id, { gatewayState: order.state });
    else if (FINAL_FAILURE_STATES.includes(order.state)) {
      updated = await refundCashout(transaction.id, `Payout failed: ${order.errMsg || "rejected by gateway"}`, { gatewayState: order.state });
    }
    return res.json({ transaction: updated, note: "Payout sent to the payment gateway." });
  } catch (err) {
    if (err instanceof GatewayError) {
      // The gateway answered with a definite refusal, so nothing was sent: release the claim
      // and leave it pending for the admin to retry or reject.
      await prisma.transaction.update({ where: { id: transaction.id }, data: { gatewayProvider: null } });
      return res.status(502).json({ error: `Payment gateway refused the payout: ${err.message}` });
    }
    // Timeout/network error: the transfer may or may not exist, so keep the claim and let the
    // callback or a status check settle it.
    console.error(`[ggusonepay] create transfer uncertain for ${transaction.id}`, err);
    return res.status(202).json({
      error: "The gateway did not respond. The payout may still go through; use Check status in a minute.",
    });
  }
});

// Re-reads a gateway payout's state (for when a callback was missed).
adminCashoutsRouter.post("/:id/sync", async (req: AuthedRequest, res) => {
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "CASHOUT") return res.status(404).json({ error: "Cashout request not found." });
  if (transaction.gatewayProvider !== PROVIDER) return res.status(400).json({ error: "This cashout was not sent to the gateway." });
  try {
    res.json({ transaction: await syncCashout(transaction) });
  } catch (err) {
    res.status(502).json({ error: err instanceof GatewayError ? err.message : "Payment gateway is unavailable." });
  }
});

const rejectSchema = z.object({ reason: z.string().max(200).optional() });

adminCashoutsRouter.post("/:id/reject", async (req: AuthedRequest, res) => {
  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.type !== "CASHOUT") return res.status(404).json({ error: "Cashout request not found." });
  if (transaction.status !== "PENDING") return res.status(409).json({ error: `This request is already ${transaction.status.toLowerCase()}.` });
  if (transaction.gatewayProvider) {
    return res.status(409).json({ error: "This payout is already with the payment gateway and can't be rejected here." });
  }

  const updated = await refundCashout(transaction.id, parsed.data.reason || null, undefined, { onlyIfUnclaimed: true });
  if (!updated) return res.status(409).json({ error: "This request was already processed." });

  await logAudit(req.userId!, "CASHOUT_REJECTED", {
    targetType: "Transaction",
    targetId: transaction.id,
    meta: { userId: transaction.userId, amount: transaction.amount, reason: parsed.data.reason },
  });
  res.json({ transaction: updated });
});
