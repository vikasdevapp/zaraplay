import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export const adminAuditLogsRouter = Router();

adminAuditLogsRouter.get("/", async (req, res) => {
  const actorId = typeof req.query.actorId === "string" ? req.query.actorId : "";
  const action = typeof req.query.action === "string" ? req.query.action : "";
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 30;

  const where: Prisma.AuditLogWhereInput = {};
  if (actorId) where.actorId = actorId;
  if (action) where.action = action;
  if (from || to) {
    where.createdAt = {};
    if (from && !isNaN(from.getTime())) where.createdAt.gte = from;
    if (to && !isNaN(to.getTime())) where.createdAt.lte = to;
  }

  const [logs, total, actors] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, fullName: true, username: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ where: { role: { in: ["ADMIN", "MASTER_ADMIN"] } }, select: { id: true, fullName: true, username: true } }),
  ]);

  res.json({ logs, total, page, pageSize, actors });
});
