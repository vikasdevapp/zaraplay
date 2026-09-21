import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// Key for the single active session token per user (device-lock).
export const sessionKey = (userId: string) => `session:${userId}`;

// Key for the per-IP-per-day signup counter.
export const signupIpKey = (ip: string) => {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `signup:ip:${ip}:${day}`;
};

// Key for a pending (not-yet-created) signup awaiting email OTP verification.
export const pendingSignupKey = (signupToken: string) => `pending-signup:${signupToken}`;
