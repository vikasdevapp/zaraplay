import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { redis, sessionKey } from "../lib/redis";

export interface AuthedRequest extends Request {
  userId?: string;
  role?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return res.status(401).json({ error: "Not authenticated." });

  let payload: { sub: string; role: string };
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; role: string };
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  // Single-device enforcement: the token must match the most recently issued one for this user.
  const activeToken = await redis.get(sessionKey(payload.sub));
  if (activeToken !== token) {
    return res.status(401).json({ error: "You have been logged out because this account was signed in on another device." });
  }

  req.userId = payload.sub;
  req.role = payload.role;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ error: "Forbidden." });
    }
    next();
  };
}
