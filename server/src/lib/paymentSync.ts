import { Transaction } from "@prisma/client";
import { prisma } from "./prisma";
import { FINAL_FAILURE_STATES, ORDER_STATE, queryPayOrder, queryTransfer, toCents } from "./ggusonepay";
import { completeDeposit, rejectDeposit } from "../utils/deposit";
import { completeCashout, refundCashout } from "../utils/payout";

export const PROVIDER = "ggusonepay";

// Every state change is driven by the gateway's query API, never by callback fields alone:
// the callback only tells us *which* order to look at.

export async function syncDeposit(transaction: Transaction) {
  if (transaction.type !== "DEPOSIT" || transaction.gatewayProvider !== PROVIDER || transaction.status !== "PENDING") {
    return transaction;
  }
  const order = await queryPayOrder(transaction.id);
  const expected = toCents(Number(transaction.amount));
  const gatewayMeta = { gatewayState: order.state, payOrderNo: order.payOrderNo };

  if (order.state === ORDER_STATE.SUCCESS) {
    const paid = order.realAmount ?? order.amount;
    if (order.amount !== expected || paid !== expected) {
      // Underpaid/overpaid (e.g. ecashapp personal code): leave it for an admin to settle.
      await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          adminNote: `Gateway paid ${(paid / 100).toFixed(2)} vs requested ${(expected / 100).toFixed(2)} — review manually.`,
          meta: { ...((transaction.meta as object) || {}), ...gatewayMeta, amountMismatch: true, paidCents: paid },
        },
      });
      console.warn(`[ggusonepay] deposit ${transaction.id} amount mismatch: paid ${paid}, expected ${expected}`);
    } else {
      await completeDeposit(transaction.id, gatewayMeta);
    }
  } else if (FINAL_FAILURE_STATES.includes(order.state)) {
    await rejectDeposit(transaction.id, "Payment was not completed.", gatewayMeta);
  }
  return (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!;
}

export async function syncCashout(transaction: Transaction) {
  if (transaction.type !== "CASHOUT" || transaction.gatewayProvider !== PROVIDER || transaction.status !== "PENDING") {
    return transaction;
  }
  const order = await queryTransfer(transaction.id);
  const gatewayMeta = { gatewayState: order.state, transferOrderNo: order.transferOrderNo };

  if (order.state === ORDER_STATE.SUCCESS) {
    await completeCashout(transaction.id, gatewayMeta);
  } else if (FINAL_FAILURE_STATES.includes(order.state)) {
    await refundCashout(transaction.id, "Payout failed at the payment gateway; funds returned.", gatewayMeta);
  }
  return (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!;
}
