import crypto from "crypto";
import QRCode from "qrcode";

// Time-based one-time passwords (RFC 6238, the scheme Google Authenticator / Authy use):
// HMAC-SHA1 over the 30-second step counter, 6 digits.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = "Zara Plays";

function base32Encode(buf: Buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string) {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 secret.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function codeAt(secret: Buffer, counter: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const currentCounter = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Returns the time-step the code belongs to (so the caller can refuse a replay of the same
 * step), or null. One step either side is accepted for phone clock drift.
 */
export function verifyCode(secretBase32: string, code: string, now = Date.now()): number | null {
  const digits = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  const counter = currentCounter(now);
  for (const c of [counter, counter - 1, counter + 1]) {
    const expected = codeAt(secret, c);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(digits))) return c;
  }
  return null;
}

/** For tests: the code a phone would show right now. */
export function codeFor(secretBase32: string, now = Date.now()) {
  return codeAt(base32Decode(secretBase32), currentCounter(now));
}

export async function setupPayload(secretBase32: string, accountName: string) {
  const label = encodeURIComponent(`${ISSUER}:${accountName}`);
  const url = `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  return { otpauthUrl: url, qrDataUrl, secret: secretBase32 };
}
