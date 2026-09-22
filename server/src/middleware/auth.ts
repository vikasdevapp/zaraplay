import { NextFunction, Request, Response } from "express";
import { getSession, verifyAccessToken } from "../lib/tokens";

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
    payload = verifyAccessToken(token);
  } catch {
    // Covers both "signature/format invalid" and "expired" — either way the client's fix is
    // the same: call POST /api/auth/refresh, or log in again if the refresh token is gone too.
    return res.status(401).json({ error: "Invalid or expired session." });
  }

  // Single-device enforcement: the access token must match the one from the most recently
  // issued session for this user (login or refresh both overwrite it).
  const session = await getSession(payload.sub);
  if (!session || session.accessToken !== token) {
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
