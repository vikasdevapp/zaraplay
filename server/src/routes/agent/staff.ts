import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest, requireRole } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { customAlphabet } from "../../lib/nanoid";
import { clearSession } from "../../lib/tokens";

/**
 * Agent-run support staff. An AGENT creates SUPPORT logins for the games they own and hands over
 * the credentials; each staff member is scoped to one of the agent's games. Admins manage agents
 * (and can see everything) elsewhere — this router is for an agent running their own team.
 */
export const agentStaffRouter = Router();
// Only AGENTs run their own staff. (Admins oversee from the admin panel.)
agentStaffRouter.use(requireRole("AGENT"));

const referralCode = customAlphabet();
const tempPassword = customAlphabet(10);

const staffSelect = {
  id: true,
  fullName: true,
  username: true,
  email: true,
  createdAt: true,
  staffGame: { select: { id: true, name: true } },
} as const;

// The games this agent owns — the staff a new member can be assigned to.
agentStaffRouter.get("/my-games", async (req: AuthedRequest, res) => {
  const games = await prisma.game.findMany({
    where: { agentId: req.userId! },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  res.json({ games });
});

agentStaffRouter.get("/", async (req: AuthedRequest, res) => {
  const staff = await prisma.user.findMany({
    where: { managerId: req.userId!, role: "SUPPORT" },
    orderBy: { username: "asc" },
    select: staffSelect,
  });
  res.json({ staff });
});

const createSchema = z.object({
  fullName: z.string().trim().min(1).max(80),
  username: z
    .string()
    .min(4)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers and _"),
  email: z.string().trim().email(),
  // One of the agent's own games.
  gameId: z.string().min(1),
  // Optional: leave blank to have one generated and shown once.
  password: z.string().min(8).max(72).optional(),
});

agentStaffRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { fullName, username, email, gameId } = parsed.data;

  // The game must be one this agent owns.
  const game = await prisma.game.findFirst({ where: { id: gameId, agentId: req.userId! }, select: { id: true } });
  if (!game) return res.status(403).json({ error: "You can only add staff to a game you manage." });

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] }, select: { id: true } });
  if (existing) return res.status(409).json({ error: "An account with that email or username already exists." });

  const password = parsed.data.password || tempPassword();
  const member = await prisma.user.create({
    data: {
      fullName,
      username,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: "SUPPORT",
      signupIp: "agent-created",
      referralCode: referralCode(),
      managerId: req.userId!,
      staffGameId: game.id,
    },
    select: staffSelect,
  });

  await logAudit(req.userId!, "STAFF_CREATED", { targetType: "User", targetId: member.id, meta: { gameId: game.id } });
  // The generated password is returned once so the agent can hand it over; it isn't stored in clear.
  res.status(201).json({ member, password: parsed.data.password ? undefined : password });
});

// Only the agent's own staff can be managed.
async function ownStaff(agentId: string, staffId: string) {
  return prisma.user.findFirst({ where: { id: staffId, managerId: agentId, role: "SUPPORT" }, select: { id: true } });
}

const passwordSchema = z.object({ password: z.string().min(8).max(72).optional() });

agentStaffRouter.post("/:id/password", async (req: AuthedRequest, res) => {
  const parsed = passwordSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const member = await ownStaff(req.userId!, req.params.id);
  if (!member) return res.status(404).json({ error: "Staff account not found." });

  const password = parsed.data.password || tempPassword();
  // Also clears 2FA so staff who lost their phone can get back in with the new password.
  await prisma.user.update({
    where: { id: member.id },
    data: { passwordHash: await bcrypt.hash(password, 10), totpEnabled: false, totpSecret: null },
  });
  await clearSession(member.id);
  await logAudit(req.userId!, "STAFF_PASSWORD_RESET", { targetType: "User", targetId: member.id });
  res.json({ ok: true, password: parsed.data.password ? undefined : password });
});

agentStaffRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const member = await ownStaff(req.userId!, req.params.id);
  if (!member) return res.status(404).json({ error: "Staff account not found." });

  // Demoted rather than deleted so their past work stays attributed; they become a regular player.
  await prisma.user.update({ where: { id: member.id }, data: { role: "USER", managerId: null, staffGameId: null } });
  await prisma.wallet.upsert({ where: { userId: member.id }, create: { userId: member.id }, update: {} });
  await clearSession(member.id);
  await logAudit(req.userId!, "STAFF_REMOVED", { targetType: "User", targetId: member.id });
  res.json({ ok: true });
});
