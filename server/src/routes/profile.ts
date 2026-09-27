import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth";

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

import bcrypt from "bcryptjs";
import { sendOtpEmail } from "../lib/email";
import { sendOtpSms } from "../lib/sms";
import { redis } from "../lib/redis";

const updateSchema = z.object({
  fullName: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  phone: z
    .string()
    .regex(/^\d{10}$/, "Enter a 10 digit phone number.")
    .optional(),
});

profileRouter.patch("/", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  const { fullName, email, phone } = parsed.data;

  // Check unique constraints if changing email or phone
  if (email) {
    const existingEmail = await prisma.user.findFirst({ where: { email, NOT: { id: req.userId! } } });
    if (existingEmail) return res.status(409).json({ error: "Email is already taken by another account." });
  }

  if (phone) {
    const existingPhone = await prisma.user.findFirst({ where: { phone, NOT: { id: req.userId! } } });
    if (existingPhone) return res.status(409).json({ error: "Phone number is already associated with another account." });
  }

  const currentUser = await prisma.user.findUnique({ where: { id: req.userId! } });

  const phoneChanged = phone !== undefined && phone !== currentUser?.phone;

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone, ...(phoneChanged ? { phoneVerified: false } : {}) } : {}),
    },
    select: { id: true, fullName: true, username: true, email: true, phone: true, phoneVerified: true },
  });
  res.json({ user });
});

// Change Password from inside profile
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(72),
});

profileRouter.post("/change-password", async (req: AuthedRequest, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "New password must be at least 6 characters." });

  const { currentPassword, newPassword } = parsed.data;
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });

  if (!user) return res.status(404).json({ error: "User not found." });

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) return res.status(400).json({ error: "Current password is incorrect." });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: req.userId! },
    data: { passwordHash },
  });

  res.json({ message: "Password updated successfully!" });
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

