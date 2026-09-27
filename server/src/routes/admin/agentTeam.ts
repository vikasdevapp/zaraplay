import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { mountStaffLoginRoutes, staffMemberSelect } from "./staffLogins";

// Admins create AGENT logins (agent desk only) and track each agent's work from the game
// requests they finish (GameRequest.handledById).
export const adminAgentTeamRouter = Router();

const DAY = 24 * 60 * 60 * 1000;

adminAgentTeamRouter.get("/", async (_req, res) => {
  const members = await prisma.user.findMany({ where: { role: "AGENT" }, orderBy: { createdAt: "desc" }, select: staffMemberSelect });
  const ids = members.map((m) => m.id);

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since30 = new Date(Date.now() - 30 * DAY);
  const since7 = Date.now() - 7 * DAY;

  const [handled, open, lastAction, pending] = await Promise.all([
    prisma.gameRequest.findMany({
      where: { handledById: { in: ids }, completedAt: { gte: since30 } },
      select: { handledById: true, type: true, status: true, completedAmount: true, createdAt: true, completedAt: true },
    }),
    prisma.gameRequest.groupBy({ by: ["claimedById"], where: { status: "PENDING", claimedById: { in: ids } }, _count: { _all: true } }),
    prisma.gameRequest.groupBy({ by: ["handledById"], where: { handledById: { in: ids } }, _max: { completedAt: true }, _count: { _all: true } }),
    prisma.gameRequest.aggregate({ where: { status: "PENDING" }, _count: { _all: true }, _min: { createdAt: true } }),
  ]);

  const openBy = new Map(open.map((o) => [o.claimedById, o._count._all]));
  const lastBy = new Map(lastAction.map((l) => [l.handledById, l]));

  const team = members.map((m) => {
    const mine = handled.filter((h) => h.handledById === m.id);
    const done7 = mine.filter((h) => h.completedAt!.getTime() >= since7);
    const completed7 = done7.filter((h) => h.status === "COMPLETED");
    const handlingMs = mine.map((h) => h.completedAt!.getTime() - h.createdAt.getTime());
    const sumBy = (types: string[]) =>
      completed7.filter((h) => types.includes(h.type)).reduce((n, h) => n + Number(h.completedAmount || 0), 0);
    return {
      ...m,
      stats: {
        openNow: openBy.get(m.id) ?? 0,
        doneToday: mine.filter((h) => h.completedAt! >= startOfToday).length,
        completed7d: completed7.length,
        rejected7d: done7.filter((h) => h.status === "REJECTED").length,
        loaded7d: Math.round(sumBy(["CREATE_ACCOUNT", "RECHARGE"]) * 100) / 100,
        redeemed7d: Math.round(sumBy(["REDEEM"]) * 100) / 100,
        avgHandlingMins: handlingMs.length ? Math.round(handlingMs.reduce((a, b) => a + b, 0) / handlingMs.length / 60000) : null,
        totalHandled: lastBy.get(m.id)?._count._all ?? 0,
        lastActionAt: lastBy.get(m.id)?._max.completedAt ?? null,
      },
    };
  });

  res.json({ team, pending: { count: pending._count._all, oldestAt: pending._min.createdAt } });
});

// An agent's latest finished requests, for reviewing their work.
adminAgentTeamRouter.get("/:id/requests", async (req, res) => {
  const member = await prisma.user.findFirst({ where: { id: req.params.id, role: "AGENT" }, select: staffMemberSelect });
  if (!member) return res.status(404).json({ error: "Agent account not found." });

  const requests = await prisma.gameRequest.findMany({
    where: { handledById: member.id },
    orderBy: { completedAt: "desc" },
    take: 50,
    select: {
      id: true,
      type: true,
      status: true,
      amount: true,
      completedAmount: true,
      agentNote: true,
      createdAt: true,
      completedAt: true,
      user: { select: { fullName: true, username: true } },
      userGame: { select: { game: { select: { name: true } } } },
    },
  });
  res.json({ member, requests });
});

mountStaffLoginRoutes(adminAgentTeamRouter, "AGENT");
