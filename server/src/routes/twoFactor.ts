import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { generateSecret, setupPayload, verifyCode } from "../lib/totp";
import { checkTwoFactor } from "../lib/twoFactor";

// Staff turn authenticator-app two-factor on and off here; login enforces it (routes/auth.ts).
export const twoFactorRouter = Router();
twoFactorRouter.use(requireAuth, requireRole("AGENT", "SUPPORT", "ADMIN", "MASTER_ADMIN"));

const pendingKey = (userId: string) => `2fa:pending:${userId}`;

twoFactorRouter.get("/", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { totpEnabled: true } });
  res.json({ enabled: !!user?.totpEnabled });
});

// A new secret waits in Redis until the user proves their app shows the right codes.
twoFactorRouter.post("/setup", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { username: true, totpEnabled: true } });
  if (!user) return res.status(404).json({ error: "Account not found." });
  if (user.totpEnabled) return res.status(409).json({ error: "Two-factor is already on. Turn it off first to set up a new device." });
  const secret = generateSecret();
  await redis.set(pendingKey(req.userId!), secret, "EX", 10 * 60);
  res.json(await setupPayload(secret, user.username));
});

const codeSchema = z.object({ code: z.string().min(6).max(10) });

twoFactorRouter.post("/enable", async (req: AuthedRequest, res) => {
  const parsed = codeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the 6-digit code." });
  const secret = await redis.get(pendingKey(req.userId!));
  if (!secret) return res.status(400).json({ error: "Setup expired. Start again to get a new QR code." });
  const step = verifyCode(secret, parsed.data.code);
  if (step === null) {
    return res.status(400).json({ error: "That code doesn't match. Check your phone's time is automatic and try the current code." });
  }
  // The confirming code counts as used, so it can't also be replayed at sign-in.
  await redis.set(`2fa:used:${req.userId}:${step}`, "1", "EX", 120);
  // Only flips off -> on, so a second tab can't overwrite an already-confirmed secret.
  const res2 = await prisma.user.updateMany({ where: { id: req.userId!, totpEnabled: false }, data: { totpSecret: secret, totpEnabled: true } });
  await redis.del(pendingKey(req.userId!));
  if (!res2.count) return res.status(409).json({ error: "Two-factor is already on." });
  await logAudit(req.userId!, "TWO_FACTOR_ENABLED", { targetType: "User", targetId: req.userId! });
  res.json({ enabled: true });
});

const disableSchema = z.object({ password: z.string().min(1), code: z.string().min(6).max(10) });

twoFactorRouter.post("/disable", async (req: AuthedRequest, res) => {
  const parsed = disableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter your password and the current 6-digit code." });
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user?.totpEnabled || !user.totpSecret) return res.status(400).json({ error: "Two-factor is not on." });
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(400).json({ error: "Password is incorrect." });
  const check = await checkTwoFactor(user.id, user.totpSecret, parsed.data.code);
  if (!check.ok) return res.status(check.status === 401 ? 400 : check.status).json({ error: check.error });
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } });
  await logAudit(req.userId!, "TWO_FACTOR_DISABLED", { targetType: "User", targetId: req.userId! });
  res.json({ enabled: false });
});
