import crypto from "crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

/** Small dependency-free stand-in for nanoid's customAlphabet, sized for referral codes. */
export function customAlphabet(length = 8) {
  return () => {
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) {
      out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
  };
}
