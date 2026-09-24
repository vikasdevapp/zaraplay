import express, { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { isAllowedNotifyIp, verifySign } from "../lib/ggusonepay";
import { PROVIDER, syncCashout, syncDeposit } from "../lib/paymentSync";

// Server-to-server callbacks from the GGUSOnePay gateway. Unauthenticated by design, so every
// request must come from the gateway's IP and carry a valid signature, and even then we only
// act on what the gateway's query API reports. The gateway expects the exact body "success";
// anything else makes it retry (0/30/60/90/120/150s).
export const paymentsRouter = Router();
paymentsRouter.use(express.urlencoded({ extended: false }));

function handler(type: "DEPOSIT" | "CASHOUT") {
  return async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, string>;
    const ipAllowed = isAllowedNotifyIp(req.ip);
    const signatureValid = ipAllowed && verifySign(body);

    const reply = async (status: number, result: string) => {
      await prisma.gatewayEvent
        .create({
          data: {
            provider: PROVIDER,
            kind: type === "DEPOSIT" ? "pay_notify" : "transfer_notify",
            mchOrderNo: typeof body.mchOrderNo === "string" ? body.mchOrderNo.slice(0, 100) : null,
            ip: req.ip ?? null,
            signatureValid,
            payload: body,
            result,
          },
        })
        .catch((err) => console.error("[ggusonepay] could not record callback", err));
      res.status(status).type("text/plain").send(status === 200 ? "success" : "fail");
    };

    if (!ipAllowed) {
      // Not persisted: this endpoint is public, and anyone could otherwise fill the table.
      console.warn(`[ggusonepay] ${type} notify from unexpected IP ${req.ip}`);
      return res.status(403).type("text/plain").send("fail");
    }
    if (!signatureValid) {
      console.warn(`[ggusonepay] ${type} notify with bad signature for ${body.mchOrderNo}`);
      return reply(400, "rejected: bad signature");
    }

    const transaction = body.mchOrderNo
      ? await prisma.transaction.findUnique({ where: { id: body.mchOrderNo } })
      : null;
    if (!transaction || transaction.type !== type || transaction.gatewayProvider !== PROVIDER) {
      console.warn(`[ggusonepay] ${type} notify for unknown order ${body.mchOrderNo}`);
      return reply(404, "rejected: unknown order");
    }

    try {
      const synced =
        type === "DEPOSIT"
          ? await syncDeposit(transaction)
          : await syncCashout(transaction, {
              // Payout review/error codes only arrive on the callback (e.g. 12/13 partial, 2x tag problems).
              ...(body.reviewCode ? { reviewCode: body.reviewCode } : {}),
              ...(body.errCode ? { errCode: body.errCode } : {}),
              ...(body.errMsg ? { errMsg: body.errMsg } : {}),
            });
      await reply(200, `ok: ${synced.status}`);
    } catch (err) {
      console.error(`[ggusonepay] ${type} notify processing failed for ${transaction.id}`, err);
      await reply(500, `error: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };
}

paymentsRouter.post("/ggusonepay/notify/pay", handler("DEPOSIT"));
paymentsRouter.post("/ggusonepay/notify/transfer", handler("CASHOUT"));
