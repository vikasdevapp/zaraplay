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
