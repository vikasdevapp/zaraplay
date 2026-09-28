import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";
import { customAlphabet } from "../../lib/nanoid";
import { clearSession } from "../../lib/tokens";

// Create / reset password / remove for single-purpose staff logins (SUPPORT, AGENT). Admins
// create them and hand the credentials to their team; the per-team list + stats live in the
// team's own router.

const referralCode = customAlphabet();

export const staffMemberSelect = { id: true, fullName: true, username: true, email: true, createdAt: true } as const;

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

const passwordSchema = z.object({ password: z.string().min(8).max(72) });

export function mountStaffLoginRoutes(router: Router, role: "SUPPORT" | "AGENT") {
  const label = role === "SUPPORT" ? "Support" : "Agent";

  router.post("/", async (req: AuthedRequest, res) => {
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
        role,
        signupIp: "admin-created",
        referralCode: referralCode(),
      },
      select: staffMemberSelect,
    });

    await logAudit(req.userId!, `${role}_CREATED`, { targetType: "User", targetId: member.id });
    res.status(201).json({ member });
  });

  router.post("/:id/password", async (req: AuthedRequest, res) => {
    const parsed = passwordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const member = await prisma.user.findFirst({ where: { id: req.params.id, role } });
    if (!member) return res.status(404).json({ error: `${label} account not found.` });

    // Also clears two-factor: a reset is how staff who lost their phone get back in.
    await prisma.user.update({
      where: { id: member.id },
      data: { passwordHash: await bcrypt.hash(parsed.data.password, 10), totpEnabled: false, totpSecret: null },
    });
    await clearSession(member.id); // signs them out everywhere; they log in with the new password
    await logAudit(req.userId!, `${role}_PASSWORD_RESET`, { targetType: "User", targetId: member.id });
    res.json({ ok: true });
  });

  router.delete("/:id", async (req: AuthedRequest, res) => {
    const member = await prisma.user.findFirst({ where: { id: req.params.id, role } });
    if (!member) return res.status(404).json({ error: `${label} account not found.` });

    // Demoted rather than deleted so their past work stays attributed.
    await prisma.user.update({ where: { id: member.id }, data: { role: "USER" } });
    // Staff logins are created without a wallet; as a regular player they need one.
    await prisma.wallet.upsert({ where: { userId: member.id }, create: { userId: member.id }, update: {} });
    await clearSession(member.id);
    if (role === "AGENT") {
      // Anything they had picked up goes back to the shared queue.
      await prisma.gameRequest.updateMany({ where: { claimedById: member.id, status: "PENDING" }, data: { claimedById: null, claimedAt: null } });
    }
    await logAudit(req.userId!, `${role}_REMOVED`, { targetType: "User", targetId: member.id });
    res.json({ ok: true });
  });
}
