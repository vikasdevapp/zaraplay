import { Router } from "express";
import { Prisma, TransactionType } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const adminTransactionsRouter = Router();

const TYPE_GROUPS: Record<string, TransactionType[]> = {
  RECHARGE: ["DEPOSIT"],
  BONUS: ["SIGNUP_BONUS", "REFERRAL_BONUS", "DEPOSIT_BONUS", "WEEKEND_BONUS"],
  REDEEM: ["CASHOUT"],
  FREE_PLAY: ["FREEPLAY_GRANT"],
  ADJUSTMENT: ["ADMIN_ADJUSTMENT"],
};

adminTransactionsRouter.get("/", async (req, res) => {
  const group = typeof req.query.group === "string" ? req.query.group.toUpperCase() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 25;

  const where: Prisma.TransactionWhereInput = {};
  if (group && TYPE_GROUPS[group]) {
    where.type = { in: TYPE_GROUPS[group] };
  }
  if (from || to) {
    where.createdAt = {};
    if (from && !isNaN(from.getTime())) where.createdAt.gte = from;
    if (to && !isNaN(to.getTime())) where.createdAt.lte = to;
  }
  if (search) {
    where.user = {
      OR: [
        { username: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { fullName: { contains: search, mode: "insensitive" } },
      ],
    };
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { id: true, fullName: true, username: true } } },
    }),
    prisma.transaction.count({ where }),
  ]);

  res.json({ transactions, total, page, pageSize });
});
