import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { customAlphabet } from "../lib/nanoid";
import { prisma } from "../lib/prisma";
import { redis, pendingSignupKey, signupIpKey } from "../lib/redis";
import { limitSignupsByIp, recordSuccessfulSignupIp, getClientIp } from "../middleware/ipLimit";
import { getPlatformSettings } from "../lib/settings";
import { emailDomainAcceptsMail, sendOtpEmail } from "../lib/email";
import { sendOtpSms } from "../lib/sms";
import { issueSession, getSession, clearSession, verifyRefreshToken } from "../lib/tokens";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { checkTwoFactor } from "../lib/twoFactor";

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

  // The account is only created once the emailed code is entered, so a fake address can never
  // finish signup; this just stops obviously undeliverable ones before sending anything.
  if (!(await emailDomainAcceptsMail(email))) {
    return res.status(400).json({ error: "This email address can't receive mail. Please use a real email address." });
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
  const { accessToken, refreshToken } = await issueSession(user.id, user.role);

  res.status(201).json({
    accessToken,
    refreshToken,
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
  // Agent Desk sign-in picks a role; the account must have exactly that role.
  loginAs: z.enum(["STAFF", "ADMIN", "MASTER_ADMIN"]).optional(),
  // Staff with two-factor on: the current 6-digit code.
  totp: z.string().max(10).optional(),
});

// "Staff" covers both agents and the per-game support staff they create.
const LOGIN_AS_ROLES = { STAFF: ["AGENT", "SUPPORT"], ADMIN: ["ADMIN"], MASTER_ADMIN: ["MASTER_ADMIN"] } as const;
const LOGIN_AS_LABEL = { STAFF: "Staff", ADMIN: "Admin (Group)", MASTER_ADMIN: "Master Admin" } as const;

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const { emailOrUsername, password, loginAs, totp } = parsed.data;
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: emailOrUsername }, { username: emailOrUsername }] },
  });
  if (!user) return res.status(401).json({ error: "Invalid credentials." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials." });

  if (user.blockedAt) {
    return res.status(403).json({ error: `Your account has been blocked.${user.blockedReason ? ` ${user.blockedReason}` : ""} Contact support if you think this is a mistake.` });
  }

  // Agent Desk sign-in is role locked: the chosen role must be the account's role. Checked
  // after the password, so it reveals nothing about accounts the caller can't open.
  if (loginAs && !(LOGIN_AS_ROLES[loginAs] as readonly string[]).includes(user.role)) {
    return res.status(403).json({ error: `This account can't sign in as ${LOGIN_AS_LABEL[loginAs]}. Choose its correct role.` });
  }

  if (user.totpEnabled && user.totpSecret) {
    const check = await checkTwoFactor(user.id, user.totpSecret, totp);
    if (!check.ok) return res.status(check.status).json({ error: check.error, needs2fa: true });
  }

  const { accessToken, refreshToken } = await issueSession(user.id, user.role);
  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role },
  });
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

// Silently mints a new short-lived access token from a still-valid refresh token, so the
// user isn't forced to log in again every 15 minutes. The refresh token itself is rotated
// (a fresh one is issued each time) and must still match what's on record in Redis — the
// same single-device check used everywhere else, so a refresh token invalidated by a login
// on another device stops working here too, not just for the access token.
authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  let payload;
  try {
    payload = verifyRefreshToken(parsed.data.refreshToken);
  } catch {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }

  const session = await getSession(payload.sub);
  if (!session || session.refreshToken !== parsed.data.refreshToken) {
    return res.status(401).json({ error: "This session is no longer valid — you may have signed in elsewhere. Please log in again." });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return res.status(401).json({ error: "Account no longer exists." });
  if (user.blockedAt) {
    await clearSession(user.id).catch(() => {});
    return res.status(403).json({ error: "Your account has been blocked. Please log in again or contact support." });
  }

  const { accessToken, refreshToken } = await issueSession(user.id, user.role);
  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, fullName: user.fullName, username: user.username, email: user.email, role: user.role },
  });
});

authRouter.post("/logout", requireAuth, async (req: AuthedRequest, res) => {
  await clearSession(req.userId!);
  res.json({ ok: true });
});

// FORGOT PASSWORD FLOW
const forgotPasswordKey = (token: string) => `forgot-password:${token}`;
const FORGOT_PASSWORD_TTL_SECONDS = 10 * 60;

const forgotPasswordSchema = z.object({
  identifier: z.string().min(1), // email or phone
});

authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input." });

  const { identifier } = parsed.data;
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }, { username: identifier }] },
  });

  if (!user) {
    // Return success to avoid user enumeration
    return res.json({ message: "If an account exists, a reset OTP has been sent." });
  }

  const resetToken = crypto.randomUUID();
  const otp = generateOtp();

  const resetData = {
    userId: user.id,
    otp,
    attempts: 0,
  };

  await redis.set(forgotPasswordKey(resetToken), JSON.stringify(resetData), "EX", FORGOT_PASSWORD_TTL_SECONDS);

  let devOtpPreview: string | undefined;

  // Send via email or phone
  if (identifier.includes("@") || user.email === identifier) {
    try {
      await sendOtpEmail(user.email, otp);
    } catch (err) {
      console.error("Failed to send reset email:", err);
      await redis.del(forgotPasswordKey(resetToken));
      return res.status(502).json({ error: "Could not send the reset email. Please try again in a few minutes." });
    }
  } else {
    // SMS send
    const phone = user.phone || identifier;
    const smsRes = await sendOtpSms(phone, otp);
    if (smsRes.devCode) devOtpPreview = smsRes.devCode;
  }

  res.json({
    resetToken,
    message: "OTP sent successfully.",
    expiresInSeconds: FORGOT_PASSWORD_TTL_SECONDS,
    devOtpPreview,
  });
});

const resetPasswordSchema = z.object({
  resetToken: z.string().min(1),
  otp: z.string().length(6),
  newPassword: z.string().min(6).max(72),
});

authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input. Password must be at least 6 characters." });

  const { resetToken, otp, newPassword } = parsed.data;
  const key = forgotPasswordKey(resetToken);
  const raw = await redis.get(key);

  if (!raw) return res.status(400).json({ error: "Reset token expired or invalid. Please request again." });

  const data = JSON.parse(raw) as { userId: string; otp: string; attempts: number };

  if (data.attempts >= MAX_OTP_ATTEMPTS) {
    await redis.del(key);
    return res.status(429).json({ error: "Too many incorrect attempts. Please request again." });
  }

  if (data.otp !== otp) {
    data.attempts += 1;
    const ttl = await redis.ttl(key);
    await redis.set(key, JSON.stringify(data), "EX", ttl > 0 ? ttl : FORGOT_PASSWORD_TTL_SECONDS);
    return res.status(400).json({ error: `Incorrect OTP. ${MAX_OTP_ATTEMPTS - data.attempts} attempt(s) left.` });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: data.userId },
    data: { passwordHash },
  });

  await redis.del(key);
  // Clear any existing user sessions
  await clearSession(data.userId);

  res.json({ message: "Password updated successfully! Please log in with your new password." });
});

