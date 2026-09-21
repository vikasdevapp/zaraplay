import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { customAlphabet } from "../lib/nanoid";
import { prisma } from "../lib/prisma";
import { redis, sessionKey, pendingSignupKey, signupIpKey } from "../lib/redis";
import { limitSignupsByIp, recordSuccessfulSignupIp, getClientIp } from "../middleware/ipLimit";
import { getPlatformSettings } from "../lib/settings";
import { sendOtpEmail } from "../lib/email";

export const authRouter = Router();

const referralCode = customAlphabet();

const PENDING_SIGNUP_TTL_SECONDS = 10 * 60;
const MAX_OTP_ATTEMPTS = 5;

interface PendingSignup {
  fullName: string;
  username: string;
  email: string;
  passwordHash: string;
  referredById?: string;
  ip: string;
  otp: string;
  attempts: number;
}

const signupSchema = z.object({
  fullName: z.string().min(1).max(80),
  username: z
    .string()
    .min(4)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers and underscores."),
  email: z.string().email(),
  password: z.string().min(6).max(72),
  referralCode: z.string().optional(),
});

function signToken(userId: string, role: string) {
  return jwt.sign({ sub: userId, role }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  } as jwt.SignOptions);
}

async function issueSession(userId: string, role: string) {
  const token = signToken(userId, role);
  // Overwriting the key means any previously issued token stops working on its next use.
  await redis.set(sessionKey(userId), token);
  return token;
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

// Step 1: validate + stash the signup in Redis (not the database — no account exists until
// the OTP is confirmed) and email a 6-digit code. Nothing here consumes the IP signup quota
// yet, since the account isn't real until step 2.
authRouter.post("/signup", limitSignupsByIp, async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });
  }
  const { fullName, username, email, password, referralCode: incomingRefCode } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    return res.status(409).json({ error: "An account with that email or username already exists." });
  }

  let referredById: string | undefined;
  if (incomingRefCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: incomingRefCode } });
    if (referrer) referredById = referrer.id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const ip = getClientIp(req);
  const otp = generateOtp();

  const signupToken = crypto.randomUUID();
  const pending: PendingSignup = { fullName, username, email, passwordHash, referredById, ip, otp, attempts: 0 };
  await redis.set(pendingSignupKey(signupToken), JSON.stringify(pending), "EX", PENDING_SIGNUP_TTL_SECONDS);

  let previewUrl: string | false = false;
  try {
    const sent = await sendOtpEmail(email, otp);
    previewUrl = sent.previewUrl;
  } catch (err) {
    console.error("Failed to send OTP email:", err);
    return res.status(502).json({ error: "Could not send verification email. Please try again." });
  }

  res.status(200).json({
    signupToken,
    email,
    expiresInSeconds: PENDING_SIGNUP_TTL_SECONDS,
    // Dev-only aid: no real SMTP is configured, so this points at the test inbox where the
    // actual email landed. Remove once a real provider (SendGrid/SES) is wired up.
    devEmailPreviewUrl: previewUrl || undefined,
  });
});

const verifySchema = z.object({
  signupToken: z.string().min(1),
  otp: z.string().length(6),
});

authRouter.post("/signup/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });
  const { signupToken, otp } = parsed.data;

  const key = pendingSignupKey(signupToken);
  const raw = await redis.get(key);
  if (!raw) return res.status(400).json({ error: "This verification code has expired. Please sign up again." });

  const pending = JSON.parse(raw) as PendingSignup;

  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    await redis.del(key);
    return res.status(429).json({ error: "Too many incorrect attempts. Please sign up again." });
  }

  if (pending.otp !== otp) {
    pending.attempts += 1;
    const ttl = await redis.ttl(key);
    await redis.set(key, JSON.stringify(pending), "EX", ttl > 0 ? ttl : PENDING_SIGNUP_TTL_SECONDS);
    return res.status(400).json({ error: `Incorrect code. ${MAX_OTP_ATTEMPTS - pending.attempts} attempt(s) left.` });
  }

  // Re-check uniqueness in case someone else took the email/username while this was pending.
  const existing = await prisma.user.findFirst({ where: { OR: [{ email: pending.email }, { username: pending.username }] } });
  if (existing) {
    await redis.del(key);
    return res.status(409).json({ error: "An account with that email or username already exists." });
  }

  const settings = await getPlatformSettings();

  // Re-check the IP quota here too: starting a signup doesn't consume it (only a completed
  // one does), so without this check someone could start several pending signups while under
  // the cap and then verify all of them, creating more accounts than the daily limit allows.
  const currentIpCount = Number((await redis.get(signupIpKey(pending.ip))) || 0);
  if (currentIpCount >= settings.ipSignupMaxPerDay) {
    await redis.del(key);
    return res.status(429).json({ error: settings.ipBlockMessage.replace("{max}", String(settings.ipSignupMaxPerDay)) });
  }

  const freeplayGrant = Number(settings.freeplaySignupGrant);

  const user = await prisma.user.create({
    data: {
      fullName: pending.fullName,
      username: pending.username,
      email: pending.email,
      passwordHash: pending.passwordHash,
      signupIp: pending.ip,
      referralCode: referralCode(),
      referredById: pending.referredById,
      phoneVerified: false,
      wallet: {
        create: { freePlay: freeplayGrant },
      },
      transactions: {
        create: { type: "FREEPLAY_GRANT", amount: freeplayGrant, status: "COMPLETED" },
      },
    },
    include: { wallet: true },
  });

  await redis.del(key);
  await recordSuccessfulSignupIp(pending.ip);
  const token = await issueSession(user.id, user.role);

  res.status(201).json({
    token,
    user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role },
    wallet: user.wallet,
  });
});

const resendSchema = z.object({ signupToken: z.string().min(1) });

authRouter.post("/signup/resend", async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const key = pendingSignupKey(parsed.data.signupToken);
  const raw = await redis.get(key);
  if (!raw) return res.status(400).json({ error: "This signup session has expired. Please sign up again." });

  const pending = JSON.parse(raw) as PendingSignup;
  pending.otp = generateOtp();
  pending.attempts = 0;
  await redis.set(key, JSON.stringify(pending), "EX", PENDING_SIGNUP_TTL_SECONDS);

  let previewUrl: string | false = false;
  try {
    const sent = await sendOtpEmail(pending.email, pending.otp);
    previewUrl = sent.previewUrl;
  } catch (err) {
    console.error("Failed to resend OTP email:", err);
    return res.status(502).json({ error: "Could not send verification email. Please try again." });
  }

  res.json({ expiresInSeconds: PENDING_SIGNUP_TTL_SECONDS, devEmailPreviewUrl: previewUrl || undefined });
});

const loginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const { emailOrUsername, password } = parsed.data;
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] },
  });
  if (!user) return res.status(401).json({ error: "Invalid credentials." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials." });

  const token = await issueSession(user.id, user.role);
  res.json({
    token,
    user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role },
  });
});

authRouter.post("/logout", async (req, res) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string };
      await redis.del(sessionKey(payload.sub));
    } catch {
      // token already invalid; nothing to clean up
    }
  }
  res.json({ ok: true });
});
