import jwt from "jsonwebtoken";
import { redis, sessionKey } from "./redis";

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "30d";
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AccessTokenPayload {
  sub: string;
  role: string;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  role: string;
  type: "refresh";
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function signAccessToken(userId: string, role: string) {
  return jwt.sign({ sub: userId, role, type: "access" }, process.env.JWT_SECRET!, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  } as jwt.SignOptions);
}

function signRefreshToken(userId: string, role: string) {
  return jwt.sign({ sub: userId, role, type: "refresh" }, process.env.JWT_SECRET!, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  } as jwt.SignOptions);
}

/**
 * Issues a new access+refresh pair and makes it the only valid session for this user —
 * overwriting the Redis record invalidates whatever pair was issued before (the single-
 * device-login requirement: logging in elsewhere signs the previous device out).
 */
export async function issueSession(userId: string, role: string): Promise<TokenPair> {
  const pair: TokenPair = {
    accessToken: signAccessToken(userId, role),
    refreshToken: signRefreshToken(userId, role),
  };
  await redis.set(sessionKey(userId), JSON.stringify(pair), "EX", REFRESH_TOKEN_TTL_SECONDS);
  return pair;
}

export async function getSession(userId: string): Promise<TokenPair | null> {
  const raw = await redis.get(sessionKey(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenPair;
  } catch {
    return null;
  }
}

export async function clearSession(userId: string): Promise<void> {
  await redis.del(sessionKey(userId));
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
  if (payload.type !== "access") throw new Error("Not an access token.");
  return payload as unknown as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
  if (payload.type !== "refresh") throw new Error("Not a refresh token.");
  return payload as unknown as RefreshTokenPayload;
}
