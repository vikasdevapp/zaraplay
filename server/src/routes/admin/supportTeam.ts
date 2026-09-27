import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { customAlphabet } from "../../lib/nanoid";
import { clearSession } from "../../lib/tokens";

// Admins create SUPPORT logins (support inbox only), hand the credentials to their team, and
// track each member's work from the replies they send (ChatMessage.sentById).
export const adminSupportTeamRouter = Router();

const referralCode = customAlphabet();
const DAY = 24 * 60 * 60 * 1000;
const STATS_WINDOW_DAYS = 30;

const memberSelect = { id: true, fullName: true, username: true, email: true, createdAt: true } as const;

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

const createSchema = z.object({
  fullName: z.string().trim().min(1).max(80),
  username: z
    .string()
    .min(4)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers and _"),
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
});

adminSupportTeamRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { fullName, username, email, password } = parsed.data;

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
  if (existing) return res.status(409).json({ error: "An account with that email or username already exists." });

  const member = await prisma.user.create({
    data: {
      fullName,
      username,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: "SUPPORT",
      signupIp: "admin-created",
      referralCode: referralCode(),
    },
    select: memberSelect,
  });

  await logAudit(req.userId!, "SUPPORT_CREATED", { targetType: "User", targetId: member.id });
  res.status(201).json({ member });
});

const passwordSchema = z.object({ password: z.string().min(8).max(72) });

adminSupportTeamRouter.post("/:id/password", async (req: AuthedRequest, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const member = await prisma.user.findFirst({ where: { id: req.params.id, role: "SUPPORT" } });
  if (!member) return res.status(404).json({ error: "Support account not found." });

  await prisma.user.update({ where: { id: member.id }, data: { passwordHash: await bcrypt.hash(parsed.data.password, 10) } });
  await clearSession(member.id); // signs them out everywhere; they log in with the new password
  await logAudit(req.userId!, "SUPPORT_PASSWORD_RESET", { targetType: "User", targetId: member.id });
  res.json({ ok: true });
});

adminSupportTeamRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const member = await prisma.user.findFirst({ where: { id: req.params.id, role: "SUPPORT" } });
  if (!member) return res.status(404).json({ error: "Support account not found." });

  // Demoted rather than deleted so their past replies stay attributed.
  await prisma.user.update({ where: { id: member.id }, data: { role: "USER" } });
  await clearSession(member.id);
  await logAudit(req.userId!, "SUPPORT_REMOVED", { targetType: "User", targetId: member.id });
  res.json({ ok: true });
});
