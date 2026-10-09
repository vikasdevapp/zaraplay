import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { ModerationError, setUserBlocked, warnUser } from "../../lib/moderation";

export const adminUsersRouter = Router();

function sendError(res: import("express").Response, err: unknown) {
  if (err instanceof ModerationError) return res.status(err.status).json({ error: err.message });
  throw err;
}

adminUsersRouter.get("/", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const users = await prisma.user.findMany({
    where: search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { fullName: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      role: true,
      phoneVerified: true,
      blockedAt: true,
      createdAt: true,
      wallet: { select: { balance: true, withdrawable: true, totalDeposited: true } },
    },
  });
  res.json({ users });
});

adminUsersRouter.get("/:id", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      phone: true,
      phoneVerified: true,
      role: true,
      createdAt: true,
      signupIp: true,
      blockedAt: true,
      blockedReason: true,
      wallet: true,
      games: { include: { game: true } },
      transactions: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user });
});

const warnSchema = z.object({ message: z.string().min(1).max(500) });

adminUsersRouter.post("/:id/warn", async (req: AuthedRequest, res) => {
  const parsed = warnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a warning message." });
  try {
    await warnUser(req.params.id, parsed.data.message, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

const blockSchema = z.object({ reason: z.string().max(500).optional() });

adminUsersRouter.post("/:id/block", async (req: AuthedRequest, res) => {
  const parsed = blockSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });
  try {
    await setUserBlocked(req.params.id, true, parsed.data.reason, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

adminUsersRouter.post("/:id/unblock", async (req: AuthedRequest, res) => {
  try {
    await setUserBlocked(req.params.id, false, undefined, req.userId!);
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

const adjustSchema = z.object({
  amount: z.number().refine((n) => n !== 0, "Amount can't be zero."),
  reason: z.string().min(1).max(200),
  // "balance" = playable, locked until played through a game. "withdrawable" = directly cashable
  // (also raises balance, since withdrawable can never exceed balance).
  bucket: z.enum(["balance", "withdrawable"]).default("balance"),
});

adminUsersRouter.post("/:id/adjust-balance", async (req: AuthedRequest, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { amount, reason, bucket } = parsed.data;

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.params.id } });
  if (!wallet) return res.status(404).json({ error: "User wallet not found." });

  const current = bucket === "balance" ? Number(wallet.balance) : Number(wallet.withdrawable);
  if (current + amount < 0) {
    return res.status(400).json({ error: "Adjustment would make the balance negative." });
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { userId: req.params.id },
      // Withdrawable money is also balance, so a withdrawable adjustment moves both together.
      data: bucket === "balance" ? { balance: { increment: amount } } : { balance: { increment: amount }, withdrawable: { increment: amount } },
    });
    // Keep the invariant withdrawable <= balance (a balance reduction may push it below withdrawable).
    await tx.$executeRaw`UPDATE "Wallet" SET "withdrawable" = "balance" WHERE "userId" = ${req.params.id} AND "withdrawable" > "balance"`;
    const w = await tx.wallet.findUniqueOrThrow({ where: { userId: req.params.id } });
    const transaction = await tx.transaction.create({
      data: {
        userId: req.params.id,
        type: "ADMIN_ADJUSTMENT",
        amount,
        status: "COMPLETED",
        adminNote: reason,
        meta: { bucket },
      },
    });
    return { wallet: w, transaction };
  });

  await logAudit(req.userId!, "BALANCE_ADJUSTED", {
    targetType: "User",
    targetId: req.params.id,
    meta: { amount, bucket, reason },
  });
  res.json(result);
});
