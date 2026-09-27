import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { mountStaffLoginRoutes, staffMemberSelect as memberSelect } from "./staffLogins";

// Admins create SUPPORT logins (support inbox only), hand the credentials to their team, and
// track each member's work from the replies they send (ChatMessage.sentById).
export const adminSupportTeamRouter = Router();

const DAY = 24 * 60 * 60 * 1000;
const STATS_WINDOW_DAYS = 30;


interface MemberStats {
  repliesToday: number;
  replies7d: number;
  replies30d: number;
  chats7d: number;
  avgResponseMins: number | null;
  lastReplyAt: Date | null;
}

adminSupportTeamRouter.get("/", async (_req, res) => {
  const members = await prisma.user.findMany({ where: { role: "SUPPORT" }, orderBy: { createdAt: "desc" }, select: memberSelect });

  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since = new Date(now - STATS_WINDOW_DAYS * DAY);

  // One pass over the window's messages, thread by thread in time order. A reply's response
  // time runs from the oldest user message still waiting for an answer in that thread.
  const recent = await prisma.chatMessage.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { userId: true, agentId: true, sender: true, sentById: true, createdAt: true },
  });

  const stats = new Map<string, MemberStats & { responseTotalMs: number; responseCount: number; chatKeys: Set<string> }>();
  const statFor = (id: string) => {
    let s = stats.get(id);
    if (!s) {
      s = { repliesToday: 0, replies7d: 0, replies30d: 0, chats7d: 0, avgResponseMins: null, lastReplyAt: null, responseTotalMs: 0, responseCount: 0, chatKeys: new Set() };
      stats.set(id, s);
    }
    return s;
  };

  const waitingSince = new Map<string, Date>();
  for (const m of recent) {
    const key = `${m.userId}:${m.agentId}`;
    if (m.sender === "USER") {
      if (!waitingSince.has(key)) waitingSince.set(key, m.createdAt);
      continue;
    }
    const waited = waitingSince.get(key);
    waitingSince.delete(key);
    if (!m.sentById) continue;

    const s = statFor(m.sentById);
    s.replies30d++;
    if (m.createdAt >= startOfToday) s.repliesToday++;
    if (m.createdAt.getTime() >= now - 7 * DAY) {
      s.replies7d++;
      s.chatKeys.add(key);
    }
    if (waited) {
      s.responseTotalMs += m.createdAt.getTime() - waited.getTime();
      s.responseCount++;
    }
    s.lastReplyAt = m.createdAt;
  }

  // Older replies still count for "last active" even outside the stats window.
  const lastReplies = await prisma.chatMessage.groupBy({
    by: ["sentById"],
    where: { sentById: { in: members.map((m) => m.id) } },
    _max: { createdAt: true },
    _count: { _all: true },
  });
  const allTime = new Map(lastReplies.map((r) => [r.sentById, r]));

  const team = members.map((m) => {
    const s = stats.get(m.id);
    const t = allTime.get(m.id);
    return {
      ...m,
      stats: {
        repliesToday: s?.repliesToday ?? 0,
        replies7d: s?.replies7d ?? 0,
        replies30d: s?.replies30d ?? 0,
        repliesTotal: t?._count._all ?? 0,
        chats7d: s?.chatKeys.size ?? 0,
        avgResponseMins: s && s.responseCount > 0 ? Math.round(s.responseTotalMs / s.responseCount / 60000) : null,
        lastReplyAt: t?._max.createdAt ?? null,
      },
    };
  });

  // Conversations whose latest message is from the user, i.e. still waiting on the team.
  const latestPerThread = await prisma.chatMessage.findMany({
    distinct: ["userId", "agentId"],
    orderBy: [{ userId: "asc" }, { agentId: "asc" }, { createdAt: "desc" }],
    select: { sender: true, createdAt: true },
  });
  const waiting = latestPerThread.filter((m) => m.sender === "USER");
  const oldestWaitingAt = waiting.reduce<Date | null>((min, m) => (!min || m.createdAt < min ? m.createdAt : min), null);

  res.json({ team, pending: { count: waiting.length, oldestWaitingAt } });
});

// A member's latest replies, so admins can review the quality of their answers.
adminSupportTeamRouter.get("/:id/replies", async (req, res) => {
  const member = await prisma.user.findFirst({ where: { id: req.params.id, role: "SUPPORT" }, select: memberSelect });
  if (!member) return res.status(404).json({ error: "Support account not found." });

  const replies = await prisma.chatMessage.findMany({
    where: { sentById: member.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      body: true,
      createdAt: true,
      agent: { select: { name: true } },
      user: { select: { fullName: true, username: true } },
    },
  });
  res.json({ member, replies });
});

mountStaffLoginRoutes(adminSupportTeamRouter, "SUPPORT");
