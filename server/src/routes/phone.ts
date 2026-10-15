import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redis, phoneOtpKey } from "../lib/redis";
import { sendOtpSms } from "../lib/sms";
import { telnyxVerifyConfigured, sendSmsVerification, checkSmsVerification } from "../lib/telnyx";
import { getPlatformSettings } from "../lib/settings";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const phoneRouter = Router();
phoneRouter.use(requireAuth);

const OTP_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

interface PendingPhoneOtp {
  phone: string;
  // null => the code is managed by Telnyx Verify (we never see it); a string => the dev fallback code.
  otp: string | null;
  attempts: number;
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Telnyx needs E.164 (+<country><number>). Strip formatting; default a bare 10-digit number to US.
function toE164(raw: string): string {
  const cleaned = raw.replace(/[\s()-]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  const digits = cleaned.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

const startSchema = z.object({ phone: z.string().min(7).max(20) });

phoneRouter.post("/start", async (req: AuthedRequest, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid phone number." });
  const phone = toE164(parsed.data.phone);

  const existing = await prisma.user.findFirst({ where: { phone, phoneVerified: true, id: { not: req.userId! } } });
  if (existing) return res.status(409).json({ error: "This phone number is already verified on another account." });

  const useTelnyx = telnyxVerifyConfigured();
  // Telnyx generates and sends its own code; the dev fallback generates one we log to the console.
  const otp = useTelnyx ? null : generateOtp();
  const pending: PendingPhoneOtp = { phone, otp, attempts: 0 };
  await redis.set(phoneOtpKey(req.userId!), JSON.stringify(pending), "EX", OTP_TTL_SECONDS);

  try {
    if (useTelnyx) {
      await sendSmsVerification(phone);
      res.json({ expiresInSeconds: OTP_TTL_SECONDS });
    } else {
      const sent = await sendOtpSms(phone, otp!);
      res.json({ expiresInSeconds: OTP_TTL_SECONDS, devCode: sent.devCode });
    }
  } catch (err) {
    console.error("Failed to send OTP:", err);
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

  // Telnyx-managed codes (otp === null) are checked by Telnyx; the dev fallback compares locally.
  const accepted =
    pending.otp === null ? await checkSmsVerification(pending.phone, parsed.data.otp).catch(() => false) : pending.otp === parsed.data.otp;

  if (!accepted) {
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
    // Real (playable) balance, locked for direct cashout until played through a game.
    await prisma.wallet.update({ where: { userId: req.userId! }, data: { balance: { increment: bonus } } });
    await prisma.transaction.create({
      data: { userId: req.userId!, type: "SIGNUP_BONUS", amount: bonus, status: "COMPLETED", adminNote: "Phone verification bonus" },
    });
  }

  res.json({ phone: user.phone, phoneVerified: user.phoneVerified, bonusGranted: bonus });
});
