import { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { getPlatformSettings } from "../lib/settings";

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Lifetime cap on accounts per device/network: rejects signup once an IP has already created the
 * configured max accounts EVER (not per day). Counted straight from the users table (User.signupIp),
 * so it survives Redis/server restarts. (The settings field is still named ipSignupMaxPerDay for
 * backwards compatibility; it is now a lifetime limit.)
 */
export async function limitSignupsByIp(req: Request, res: Response, next: NextFunction) {
  const settings = await getPlatformSettings();
  const max = settings.ipSignupMaxPerDay;
  // 0 (or less) = unlimited: no cap at all.
  if (max > 0) {
    const ip = getClientIp(req);
    const count = await prisma.user.count({ where: { signupIp: ip } });
    if (count >= max) {
      return res.status(429).json({ error: settings.ipBlockMessage.replace("{max}", String(max)) });
    }
  }
  next();
}

/**
 * No-op kept for callers: the lifetime count is derived from User.signupIp at check time, so there
 * is nothing to record separately once the account (with its signupIp) has been created.
 */
export async function recordSuccessfulSignupIp(_ip: string) {
  // intentionally empty
}
