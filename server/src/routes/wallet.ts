import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { calcDepositBonus } from "../utils/bonus";
import { evaluateCashout } from "../utils/cashout";
import { getPlatformSettings } from "../lib/settings";
import { createPayOrder, gateway, GatewayError, publicIpv4, TRANSFER_ACCOUNT_FIELD } from "../lib/ggusonepay";
import { PROVIDER, syncDeposit } from "../lib/paymentSync";
import { rejectDeposit } from "../utils/deposit";

export const walletRouter = Router();
walletRouter.use(requireAuth);

walletRouter.get("/", async (req: AuthedRequest, res) => {
  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "Wallet not found." });
  res.json({ wallet });
});

walletRouter.get("/transactions", async (req: AuthedRequest, res) => {
  const transactions = await prisma.transaction.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json({ transactions });
});

walletRouter.get("/payment-options", (_req, res) => {
  res.json({
    deposit: { gateway: gateway.payEnabled, methods: gateway.payEnabled ? gateway.payWayCodes : [] },
    cashout: {
      gateway: gateway.transferEnabled,
      methods: gateway.transferEnabled ? gateway.transferWayCodes.filter((w) => TRANSFER_ACCOUNT_FIELD[w]) : [],
    },
  });
});

const MAX_OPEN_GATEWAY_DEPOSITS = 3;

const depositSchema = z.object({
  amount: z.number().positive().max(1000000),
  wayCode: z.string().max(30).optional(),
  deviceId: z.string().max(200).optional(),
});

walletRouter.post("/deposit", async (req: AuthedRequest, res) => {
  const parsed = depositSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid deposit amount." });
  const { wayCode, deviceId } = parsed.data;
  // Whole cents only, so the DB amount and the gateway's integer-cents amount always agree.
  const amount = Math.round(parsed.data.amount * 100) / 100;

  const settings = await getPlatformSettings();
  if (amount < Number(settings.minDeposit) || amount > Number(settings.maxDeposit)) {
    return res.status(400).json({
      error: `Deposit must be between $${Number(settings.minDeposit).toFixed(2)} and $${Number(settings.maxDeposit).toFixed(2)}.`,
    });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "Wallet not found." });

  // Deposits are now a request, same as cashouts: nothing is credited until an admin
  // approves it (see server/src/routes/admin/deposits.ts). The bonus is computed now
  // (based on hasDeposited at request time) and stashed on the transaction so approval
  // doesn't need to re-derive it.
  const isFirstDeposit = !wallet.hasDeposited;
  const bonus = calcDepositBonus(amount, isFirstDeposit, settings);

  if (gateway.payEnabled) {
    const method = wayCode || gateway.payWayCodes[0];
    if (!gateway.payWayCodes.includes(method)) return res.status(400).json({ error: "Unsupported payment method." });

    // Each order counts against the merchant's test/daily limits, so unpaid ones are capped;
    // the user can resume an open one from their transaction list instead.
    const openOrders = await prisma.transaction.count({
      where: {
        userId: req.userId!,
        type: "DEPOSIT",
        status: "PENDING",
        gatewayProvider: PROVIDER,
        createdAt: { gt: new Date(Date.now() - gateway.orderExpireSeconds * 1000) },
      },
    });
    if (openOrders >= MAX_OPEN_GATEWAY_DEPOSITS) {
      return res.status(429).json({
        error: "You have unfinished payments. Continue one from your transactions below, or wait for it to expire.",
      });
    }

    // The transaction id doubles as the gateway's mchOrderNo, so callbacks map straight back.
    const transaction = await prisma.transaction.create({
      data: {
        userId: req.userId!,
        type: "DEPOSIT",
        amount,
        status: "PENDING",
        payoutAmount: bonus.amount,
        gatewayProvider: PROVIDER,
        meta: { bonusKind: bonus.kind, bonusPercent: bonus.percent, isFirstDeposit, wayCode: method },
      },
    });

    try {
      const order = await createPayOrder({
        mchOrderNo: transaction.id,
        amount,
        wayCode: method,
        userId: req.userId!,
        clientIp: publicIpv4(req.ip),
        deviceId,
      });
      const updated = await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          gatewayOrderNo: order.payOrderNo,
          meta: { ...(transaction.meta as object), cashierUrl: order.cashierUrl, expireTimestamp: order.expireTimestamp },
        },
      });
      return res.json({ transaction: updated, bonus, cashierUrl: order.cashierUrl });
    } catch (err) {
      const message = err instanceof GatewayError ? err.message : "Payment gateway is unavailable.";
      console.error(`[ggusonepay] create pay order failed for ${transaction.id}`, err);
      await rejectDeposit(transaction.id, `Gateway error: ${message}`);
      return res.status(502).json({ error: "Could not start the payment. Please try again shortly." });
    }
  }

  // No gateway configured: fall back to a manual request an admin approves.
  const transaction = await prisma.transaction.create({
    data: {
      userId: req.userId!,
      type: "DEPOSIT",
      amount,
      status: "PENDING",
      payoutAmount: bonus.amount,
      meta: { bonusKind: bonus.kind, bonusPercent: bonus.percent, isFirstDeposit },
    },
  });

  res.json({
    transaction,
    bonus,
    note: "Your deposit request is pending admin approval.",
  });
});

// Called when the user lands back from the cashier page: refreshes the deposit from the
// gateway so the wallet updates even before (or without) the callback arriving.
walletRouter.post("/deposit/:id/refresh", async (req: AuthedRequest, res) => {
  const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!transaction || transaction.userId !== req.userId || transaction.type !== "DEPOSIT") {
    return res.status(404).json({ error: "Deposit not found." });
  }
  try {
    res.json({ transaction: await syncDeposit(transaction) });
  } catch (err) {
    console.error(`[ggusonepay] refresh failed for ${transaction.id}`, err);
    res.json({ transaction });
  }
});

const cashoutSchema = z.object({
  amount: z.number().positive(),
  fromFreePlay: z.boolean().optional().default(false),
  payout: z
    .object({ wayCode: z.string().max(30), account: z.string().trim().min(2).max(100) })
    .optional(),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mirrors the gateway's wayParam rules so bad details fail here, not at payout time.
function payoutAccountError(wayCode: string, account: string): string | null {
  switch (wayCode) {
    case "ecashapp":
      return /^\$[A-Za-z0-9_-]{3,20}$/.test(account) ? null : "Enter a valid $Cashtag (e.g. $yourname).";
    case "chime":
      return /^\$\S{3,49}$/.test(account) ? null : "Enter a valid $ChimeSign (e.g. $yourname).";
    case "paypal":
    case "venmo":
      return EMAIL_RE.test(account) ? null : "Enter a valid email address.";
    case "zelle":
      return EMAIL_RE.test(account) || /^\+?\d{10,15}$/.test(account) ? null : "Enter the email or phone number on your Zelle account.";
    default:
      return "Unsupported payout method.";
  }
}

walletRouter.post("/cashout", async (req: AuthedRequest, res) => {
  const parsed = cashoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid cashout amount." });
  const { amount, fromFreePlay, payout } = parsed.data;

  if (gateway.transferEnabled) {
    if (!payout) return res.status(400).json({ error: "Choose where to receive your payout." });
    if (!gateway.transferWayCodes.includes(payout.wayCode)) return res.status(400).json({ error: "Unsupported payout method." });
    const accountError = payoutAccountError(payout.wayCode, payout.account);
    if (accountError) return res.status(400).json({ error: accountError });
  }

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.userId! } });
  if (!wallet) return res.status(404).json({ error: "Wallet not found." });

  const available = fromFreePlay ? Number(wallet.freePlay) : Number(wallet.balance);
  if (amount > available) {
    return res.status(400).json({ error: "Cashout amount exceeds available balance." });
  }

  const settings = await getPlatformSettings();
  const evaluation = evaluateCashout(amount, Number(wallet.lastDepositAmount), fromFreePlay, settings);
  if (!evaluation.eligible) {
    return res.status(400).json({ error: evaluation.reason });
  }

  // The full requested amount is held immediately (payout + forfeited both leave the
  // spendable balance) so the same funds can't be cashed out twice while pending review.
  // Approval just finalizes the hold; rejection refunds it.
  const result = await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({
      where: { userId: req.userId! },
      data: fromFreePlay
        ? { freePlay: { decrement: amount } }
        : { balance: { decrement: amount } },
    });
    const transaction = await tx.transaction.create({
      data: {
        userId: req.userId!,
        type: "CASHOUT",
        amount,
        status: "PENDING",
        payoutAmount: evaluation.payout,
        forfeitedAmount: evaluation.forfeited,
        meta: gateway.transferEnabled && payout ? { fromFreePlay, payout } : { fromFreePlay },
      },
    });
    return { wallet: w, transaction };
  });

  res.json({
    wallet: result.wallet,
    transaction: result.transaction,
    payout: evaluation.payout,
    forfeited: evaluation.forfeited,
    note:
      "Your cashout request is pending admin approval." +
      (evaluation.forfeited > 0
        ? " You requested more than your max cashout for this tier — the excess will be forfeited."
        : ""),
  });
});
