import { Prisma, Transaction } from "@prisma/client";
import { prisma } from "./prisma";
import { closePayOrder, FINAL_FAILURE_STATES, ORDER_STATE, queryPayOrder, queryTransfer, toCents } from "./ggusonepay";
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

export async function syncDeposit(transaction: TxRow, opts: { closeIfExpired?: boolean } = {}) {
  if (transaction.type !== "DEPOSIT" || transaction.gatewayProvider !== PROVIDER || transaction.status === "REJECTED") {
    return transaction;
  }
  let order = await queryPayOrder(transaction.id);
  const gatewayMeta = { gatewayState: order.state, payOrderNo: order.payOrderNo };

  if (transaction.status === "COMPLETED") {
    if (order.state === ORDER_STATE.REFUNDED) await flagAlert(transaction, "REFUNDED", gatewayMeta);
    if (order.state === ORDER_STATE.DISPUTED) await flagAlert(transaction, "DISPUTED", gatewayMeta);
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

  const expected = toCents(Number(transaction.amount));
  if (order.state === ORDER_STATE.SUCCESS) {
    const paid = order.realAmount ?? order.amount;
    // The gateway has confirmed the money arrived, so it's credited straight away — at what was
    // actually paid when that differs from the order (e.g. an ecashapp user typing their own
    // amount), with the bonus recomputed on it. No admin step.
    const mismatch = paid !== expected;
    if (mismatch) console.warn(`[ggusonepay] deposit ${transaction.id} paid ${paid}c vs requested ${expected}c; crediting the paid amount`);
    const done = await completeDeposit(
      transaction.id,
      { ...gatewayMeta, state: order.state, ...(mismatch ? { paidCents: paid } : {}) },
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
  } else if (FINAL_FAILURE_STATES.includes(order.state)) {
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
