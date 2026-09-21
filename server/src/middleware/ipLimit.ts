import { NextFunction, Request, Response } from "express";
import { redis, signupIpKey } from "../lib/redis";
import { getPlatformSettings } from "../lib/settings";

const ONE_DAY_SECONDS = 24 * 60 * 60;

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/** Rejects signup once an IP has created the configured max accounts within 24h (see Platform Rules > IP Security). */
export async function limitSignupsByIp(req: Request, res: Response, next: NextFunction) {
  const settings = await getPlatformSettings();
  const max = settings.ipSignupMaxPerDay;
  const ip = getClientIp(req);
  const key = signupIpKey(ip);

  const current = Number((await redis.get(key)) || 0);
  if (current >= max) {
    return res.status(429).json({ error: settings.ipBlockMessage.replace("{max}", String(max)) });
  }

  next();
}

/** Call only after a signup has actually succeeded, so failed/duplicate attempts don't burn the quota. */
export async function recordSuccessfulSignupIp(ip: string) {
  const key = signupIpKey(ip);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, ONE_DAY_SECONDS);
  }
}
