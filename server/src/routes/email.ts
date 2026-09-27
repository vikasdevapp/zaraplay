import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { verifyUnsubscribeToken } from "../lib/email";

// Public (no login): the signed link in every broadcast email. GET is the link a person
// clicks; POST is the one-click List-Unsubscribe request mail providers send on their behalf.
export const emailRouter = Router();

async function unsubscribe(req: Request) {
  const token = String(req.query.token || "");
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return false;
  await prisma.user.updateMany({ where: { id: userId }, data: { emailOptOut: true } });
  return true;
}

function page(res: Response, status: number, message: string) {
  res
    .status(status)
    .type("html")
    .send(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zara Plays</title></head>` +
        `<body style="font-family:sans-serif;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:16px;">` +
        `<div style="max-width:420px;text-align:center;"><h2 style="color:#dc2626;">Zara Plays</h2><p>${message}</p></div></body></html>`
    );
}

emailRouter.get("/unsubscribe", async (req, res) => {
  if (await unsubscribe(req)) return page(res, 200, "You've been unsubscribed from Zara Plays announcement emails. You'll still get account emails like verification codes.");
  page(res, 400, "This unsubscribe link is invalid.");
});

emailRouter.post("/unsubscribe", async (req, res) => {
  res.sendStatus((await unsubscribe(req)) ? 200 : 400);
});
