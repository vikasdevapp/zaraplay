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
    const body = req.body as Record<string, string>;
    if (!isAllowedNotifyIp(req.ip)) {
      console.warn(`[ggusonepay] ${type} notify from unexpected IP ${req.ip}`);
      return res.status(403).type("text/plain").send("fail");
    }
    if (!verifySign(body)) {
      console.warn(`[ggusonepay] ${type} notify with bad signature for ${body.mchOrderNo}`);
      return res.status(400).type("text/plain").send("fail");
    }

    const transaction = body.mchOrderNo
      ? await prisma.transaction.findUnique({ where: { id: body.mchOrderNo } })
      : null;
    if (!transaction || transaction.type !== type || transaction.gatewayProvider !== PROVIDER) {
      console.warn(`[ggusonepay] ${type} notify for unknown order ${body.mchOrderNo}`);
      return res.status(404).type("text/plain").send("fail");
    }

    try {
      if (type === "DEPOSIT") await syncDeposit(transaction);
      else await syncCashout(transaction);
      res.type("text/plain").send("success");
    } catch (err) {
      console.error(`[ggusonepay] ${type} notify processing failed for ${transaction.id}`, err);
      res.status(500).type("text/plain").send("fail");
    }
  };
}

paymentsRouter.post("/ggusonepay/notify/pay", handler("DEPOSIT"));
paymentsRouter.post("/ggusonepay/notify/transfer", handler("CASHOUT"));
