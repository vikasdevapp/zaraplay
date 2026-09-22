import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redis, phoneOtpKey } from "../lib/redis";
import { sendOtpSms } from "../lib/sms";
import { getPlatformSettings } from "../lib/settings";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const phoneRouter = Router();
phoneRouter.use(requireAuth);

const OTP_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

interface PendingPhoneOtp {
  phone: string;
  otp: string;
  attempts: number;
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

const startSchema = z.object({ phone: z.string().min(7).max(20) });

phoneRouter.post("/start", async (req: AuthedRequest, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid phone number." });
  const { phone } = parsed.data;

  const existing = await prisma.user.findFirst({ where: { phone, phoneVerified: true, id: { not: req.userId! } } });
  if (existing) return res.status(409).json({ error: "This phone number is already verified on another account." });

  const otp = generateOtp();
  const pending: PendingPhoneOtp = { phone, otp, attempts: 0 };
  await redis.set(phoneOtpKey(req.userId!), JSON.stringify(pending), "EX", OTP_TTL_SECONDS);

  try {
    const sent = await sendOtpSms(phone, otp);
    res.json({ expiresInSeconds: OTP_TTL_SECONDS, devCode: sent.devCode });
  } catch (err) {
    console.error("Failed to send OTP SMS:", err);
    res.status(502).json({ error: "Could not send verification code. Please try again." });
  }
});

const verifySchema = z.object({ otp: z.string().length(6) });

phoneRouter.post("/verify", async (req: AuthedRequest, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid code." });

  const key = phoneOtpKey(req.userId!);
  const raw = await redis.get(key);
  if (!raw) return res.status(400).json({ error: "This code has expired. Please request a new one." });

  const pending = JSON.parse(raw) as PendingPhoneOtp;

  if (pending.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    return res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
  }

  if (pending.otp !== parsed.data.otp) {
    pending.attempts += 1;
    const ttl = await redis.ttl(key);
    await redis.set(key, JSON.stringify(pending), "EX", ttl > 0 ? ttl : OTP_TTL_SECONDS);
    return res.status(400).json({ error: `Incorrect code. ${MAX_ATTEMPTS - pending.attempts} attempt(s) left.` });
  }

  await redis.del(key);

  const settings = await getPlatformSettings();
  const bonus = Number(settings.phoneVerifyBonus);

  const user = await prisma.user.update({
    where: { id: req.userId! },
    data: { phone: pending.phone, phoneVerified: true },
  });

  if (bonus > 0) {
    await prisma.wallet.update({ where: { userId: req.userId! }, data: { freePlay: { increment: bonus } } });
    await prisma.transaction.create({
      data: { userId: req.userId!, type: "FREEPLAY_GRANT", amount: bonus, status: "COMPLETED", adminNote: "Phone verification bonus" },
    });
  }

  res.json({ phone: user.phone, phoneVerified: user.phoneVerified, bonusGranted: bonus });
});
