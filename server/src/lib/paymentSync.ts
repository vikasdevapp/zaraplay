import { Prisma, Transaction } from "@prisma/client";
import { prisma } from "./prisma";
import { closePayOrder, FINAL_FAILURE_STATES, ORDER_STATE, PayOrderDetail, queryPayOrder, queryTransfer, toCents } from "./ggusonepay";
import { completeDeposit, rejectDeposit } from "../utils/deposit";
import { completeCashout, refundCashout } from "../utils/payout";
import { notifyUser } from "./webpush";

export const PROVIDER = "ggusonepay";

// Rows as the shared client returns them (payoutSecret is omitted globally).
type TxRow = Omit<Transaction, "payoutSecret">;

// Every state change is driven by the gateway's query API, never by callback fields alone:
// the callback only tells us *which* order to look at.

const money = (v: Prisma.Decimal | number | null) => `$${Number(v ?? 0).toFixed(2)}`;

function notify(userId: string, title: string, body: string) {
  notifyUser(userId, { title, body, kind: "WALLET", link: "/wallet" }).catch((err) => console.error("[ggusonepay] notify failed", err));
}

// A refund or dispute on money we already credited/paid can't be undone automatically (the
// user may have spent it), so it's flagged for an admin instead.
async function flagAlert(transaction: TxRow, alert: "REFUNDED" | "DISPUTED", gatewayMeta: Prisma.JsonObject) {
  const meta = (transaction.meta as Prisma.JsonObject) || {};
  if (meta.gatewayAlert === alert) return;
  await prisma.transaction.update({
    where: { id: transaction.id },
    data: {
      adminNote: `Gateway reports this ${transaction.type.toLowerCase()} as ${alert.toLowerCase()} after it was completed — review.`,
      meta: { ...meta, ...gatewayMeta, gatewayAlert: alert },
    },
  });
  console.warn(`[ggusonepay] ${transaction.type} ${transaction.id} ${alert} after completion`);
}

// Credits a gateway deposit at the amount the gateway says actually arrived. Idempotent: the
// completeDeposit status flip is conditional, so a racing caller just gets null. Used both for a
// normal SUCCESS and for the "paid but the order ended in a failure state" recovery below.
async function creditPaidDeposit(transaction: TxRow, order: PayOrderDetail, gatewayMeta: Prisma.JsonObject, extra: Prisma.JsonObject = {}) {
  const paid = order.realAmount ?? order.amount;
  const expected = toCents(Number(transaction.amount));
  const mismatch = paid !== expected;
  if (mismatch) console.warn(`[ggusonepay] deposit ${transaction.id} paid ${paid}c vs requested ${expected}c; crediting the paid amount`);
  const done = await completeDeposit(
    transaction.id,
    { ...gatewayMeta, state: order.state, ...extra, ...(mismatch ? { paidCents: paid } : {}) },
    { paidCents: paid }
  );
  if (done) {
    const bonus = Number(done.payoutAmount ?? 0);
    notify(
      done.userId,
      "Deposit received",
      `${money(done.amount)} added to your wallet${bonus > 0 ? ` + ${money(bonus)} bonus` : ""}.${mismatch ? ` (You sent ${money(paid / 100)}; the order was for ${money(expected / 100)}.)` : ""}`
    );
  } else if (paid <= 0) {
    console.warn(`[ggusonepay] deposit ${transaction.id} reported paid with no amount; left pending`);
  }
  return done;
}

export async function syncDeposit(transaction: TxRow, opts: { closeIfExpired?: boolean } = {}) {
  if (transaction.type !== "DEPOSIT" || transaction.gatewayProvider !== PROVIDER) {
    return transaction;
  }
  let order = await queryPayOrder(transaction.id);
  const gatewayMeta = { gatewayState: order.state, payOrderNo: order.payOrderNo };
  const paidCents = order.realAmount ?? 0;
  // Money was genuinely collected when the gateway says SUCCESS, or when the order is CLOSED but
  // still shows a paid amount — the customer paid just as the order expired / was closed, so the
  // funds landed in the merchant account even though the order isn't "success". FAILED/CANCELLED
  // (no money) and REFUNDED/DISPUTED (money returned) are never treated as collected here.
  const collected = paidCents > 0 && (order.state === ORDER_STATE.SUCCESS || order.state === ORDER_STATE.CLOSED);

  if (transaction.status === "COMPLETED") {
    if (order.state === ORDER_STATE.REFUNDED) await flagAlert(transaction, "REFUNDED", gatewayMeta);
    if (order.state === ORDER_STATE.DISPUTED) await flagAlert(transaction, "DISPUTED", gatewayMeta);
    return (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!;
  }

  // Recovery: a deposit we already rejected (usually because the order was closed at expiry) that
  // the gateway now shows was actually paid. Re-open it (conditional, so only one caller wins) and
  // credit the real amount, so a paid deposit that landed late isn't lost.
  if (transaction.status === "REJECTED") {
    if (collected) {
      const reopened = await prisma.transaction.updateMany({
        where: { id: transaction.id, status: "REJECTED" },
        data: { status: "PENDING" },
      });
      if (reopened.count) {
        const pending = await prisma.transaction.findUnique({ where: { id: transaction.id } });
        if (pending) await creditPaidDeposit(pending as TxRow, order, gatewayMeta, { recoveredFromRejected: true });
      }
    }
    return (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!;
  }

  const meta = (transaction.meta as { expireTimestamp?: number } | null) || {};

  // Past expiry and still unpaid: close it at the gateway so a late payment can't land on an
  // order we've given up on, then re-read the final state.
  const unpaid = order.state === ORDER_STATE.CREATED || order.state === ORDER_STATE.IN_PROGRESS;
  if (opts.closeIfExpired && unpaid && meta.expireTimestamp && Date.now() > meta.expireTimestamp + 5 * 60_000) {
    await closePayOrder(transaction.id);
    order = await queryPayOrder(transaction.id);
  }

  // Re-read the paid/collected signals in case the close above changed the order.
  const paidAfter = order.realAmount ?? 0;
  const collectedAfter = paidAfter > 0 && (order.state === ORDER_STATE.SUCCESS || order.state === ORDER_STATE.CLOSED);

  if (collectedAfter) {
    // SUCCESS, or CLOSED-but-paid (the customer paid right as the order closed). Credit either way.
    await creditPaidDeposit(transaction, order, gatewayMeta, order.state === ORDER_STATE.SUCCESS ? {} : { creditedFromClosedOrder: true });
  } else if (FINAL_FAILURE_STATES.includes(order.state)) {
    // Only reject when nothing was collected.
    await rejectDeposit(transaction.id, "Payment was not completed.", { ...gatewayMeta, state: order.state });
  }
  return (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!;
}

export async function syncCashout(transaction: TxRow, callbackMeta: Prisma.JsonObject = {}) {
  if (transaction.type !== "CASHOUT" || transaction.gatewayProvider !== PROVIDER || transaction.status === "REJECTED") {
    return transaction;
  }
  const order = await queryTransfer(transaction.id);
  const gatewayMeta = { gatewayState: order.state, transferOrderNo: order.transferOrderNo, ...callbackMeta };

  if (transaction.status === "COMPLETED") {
    if (order.state === ORDER_STATE.REFUNDED) await flagAlert(transaction, "REFUNDED", gatewayMeta);
    return (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!;
  }

  if (order.state === ORDER_STATE.SUCCESS) {
    const done = await completeCashout(transaction.id, gatewayMeta);
    if (done) notify(done.userId, "Cashout sent", `Your ${money(done.payoutAmount ?? done.amount)} cashout has been paid.`);
  } else if (FINAL_FAILURE_STATES.includes(order.state)) {
    const done = await refundCashout(transaction.id, "Payout failed at the payment gateway; funds returned.", gatewayMeta);
    if (done) notify(done.userId, "Cashout failed", `We couldn't send your cashout — ${money(done.amount)} is back in your wallet. Check your payout details.`);
  }
  return (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!;
}
