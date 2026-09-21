import { Router } from "express";
import { z } from "zod";
import { getPlatformSettings } from "../../lib/settings";
import { prisma } from "../../lib/prisma";
import { AuthedRequest } from "../../middleware/auth";
import { logAudit } from "../../lib/audit";

export const adminSettingsRouter = Router();

adminSettingsRouter.get("/", async (_req, res) => {
  const settings = await getPlatformSettings();
  res.json({ settings });
});

const updateSchema = z.object({
  minDeposit: z.number().nonnegative().optional(),
  maxDeposit: z.number().positive().optional(),
  minWithdrawal: z.number().nonnegative().optional(),
  maxWithdrawal: z.number().positive().optional(),
  signupBonusPercent: z.number().min(0).max(1000).optional(),
  weekendBonusPercent: z.number().min(0).max(1000).optional(),
  regularBonusPercent: z.number().min(0).max(1000).optional(),
  referralBonusPercent: z.number().min(0).max(1000).optional(),
  freeplaySignupGrant: z.number().nonnegative().optional(),
  freeplayCashoutCap: z.number().nonnegative().optional(),
  cashoutTierBoundary: z.number().positive().optional(),
  cashoutTier1MinMultiplier: z.number().nonnegative().optional(),
  cashoutTier1MaxMultiplier: z.number().nonnegative().optional(),
  cashoutTier2MinMultiplier: z.number().nonnegative().optional(),
  ipSignupMaxPerDay: z.number().int().min(0).optional(),
  ipBlockMessage: z.string().min(1).max(300).optional(),
});

adminSettingsRouter.patch("/", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input." });

  await getPlatformSettings(); // ensure the singleton row exists
  const settings = await prisma.platformSettings.update({
    where: { id: "default" },
    data: parsed.data,
  });

  await logAudit(req.userId!, "SETTINGS_UPDATED", { targetType: "PlatformSettings", targetId: "default", meta: parsed.data });
  res.json({ settings });
});
