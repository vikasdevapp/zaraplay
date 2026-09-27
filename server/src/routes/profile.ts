import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import { logAudit } from "../lib/audit";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      phone: true,
      phoneVerified: true,
      avatarUrl: true,
      referralCode: true,
      createdAt: true,
    },
  });
  if (!user) return res.status(404).json({ error: "Not found." });
  res.json({ user });
});

const updateSchema = z.object({
  fullName: z.string().min(1).max(80).optional(),
  phone: z
    .string()
    .regex(/^\d{10}$/, "Enter a 10 digit phone number.")
    .optional(),
});

profileRouter.patch("/", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: parsed.data,
    select: { id: true, fullName: true, username: true, email: true, phone: true, phoneVerified: true },
  });
  res.json({ user });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(72),
});

// The current session stays valid (it is the only one), so the user isn't bounced to login.
profileRouter.post("/password", async (req: AuthedRequest, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { passwordHash: true, role: true } });
  if (!user) return res.status(404).json({ error: "Account not found." });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: "Current password is incorrect." });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "New password must be different from the current one." });
  }

  await prisma.user.update({ where: { id: req.userId! }, data: { passwordHash: await bcrypt.hash(newPassword, 10) } });
  if (user.role !== "USER") await logAudit(req.userId!, "PASSWORD_CHANGED", { targetType: "User", targetId: req.userId! });
  res.json({ ok: true });
});

// Simulated verification — a real deployment would send an OTP via Twilio here.
profileRouter.post("/verify-phone", async (req: AuthedRequest, res) => {
  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { phoneVerified: true },
  });
  await prisma.wallet.update({
    where: { userId: req.userId! },
    data: { freePlay: { increment: 5 } },
  });
  await prisma.transaction.create({
    data: { userId: req.userId!, type: "FREEPLAY_GRANT", amount: 5, status: "COMPLETED", meta: { reason: "phone_verification" } },
  });
  res.json({ user, freePlayGranted: 5 });
});
