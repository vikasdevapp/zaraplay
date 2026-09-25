import crypto from "crypto";

// AES-256-GCM for sensitive payout details (card numbers) that must sit in the DB between the
// user's cashout request and the admin's approval. Key: PAYOUT_ENCRYPTION_KEY, 64 hex chars
// (generate with `openssl rand -hex 32`). Losing the key only strands pending card payouts.

function key() {
  const hex = process.env.PAYOUT_ENCRYPTION_KEY || "";
  return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, "hex") : null;
}

export function isSecretBoxConfigured() {
  return key() !== null;
}

export function sealSecret(plain: string) {
  const k = key();
  if (!k) throw new Error("PAYOUT_ENCRYPTION_KEY is not configured.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function openSecret(sealed: string) {
  const k = key();
  if (!k) throw new Error("PAYOUT_ENCRYPTION_KEY is not configured.");
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized sealed secret.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
