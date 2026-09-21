import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";

export const adminUsersRouter = Router();

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
      createdAt: true,
      wallet: { select: { balance: true, freePlay: true, totalDeposited: true } },
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
      wallet: true,
      games: { include: { game: true } },
      transactions: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user });
});

const adjustSchema = z.object({
  amount: z.number().refine((n) => n !== 0, "Amount can't be zero."),
  reason: z.string().min(1).max(200),
  bucket: z.enum(["balance", "freePlay"]).default("balance"),
});

adminUsersRouter.post("/:id/adjust-balance", async (req: AuthedRequest, res) => {
  const parsed = adjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { amount, reason, bucket } = parsed.data;

  const wallet = await prisma.wallet.findUnique({ where: { userId: req.params.id } });
  if (!wallet) return res.status(404).json({ error: "User wallet not found." });

  const current = bucket === "balance" ? Number(wallet.balance) : Number(wallet.freePlay);
  if (current + amount < 0) {
    return res.status(400).json({ error: "Adjustment would make the balance negative." });
  }

  const result = await prisma.$transaction(async (tx) => {
    const w = await tx.wallet.update({
      where: { userId: req.params.id },
      data: bucket === "balance" ? { balance: { increment: amount } } : { freePlay: { increment: amount } },
    });
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
