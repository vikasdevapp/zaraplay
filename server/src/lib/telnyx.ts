// Telnyx Verify API (OTP over SMS). Telnyx generates, delivers and checks the one-time code, so we
// don't manage the code ourselves — we just ask it to send a code to a number and later ask it to
// verify the code the user typed. Needs TELNYX_API_KEY and TELNYX_VERIFY_PROFILE_ID.
//
// Dashboard setup: Telnyx Portal -> Verify -> Verify Profiles -> create a profile (enable the SMS
// channel) -> copy its ID into TELNYX_VERIFY_PROFILE_ID; API Keys -> create a key -> TELNYX_API_KEY.

const TELNYX_API = "https://api.telnyx.com/v2";

function cfg() {
  const apiKey = process.env.TELNYX_API_KEY;
  const verifyProfileId = process.env.TELNYX_VERIFY_PROFILE_ID;
  if (!apiKey || !verifyProfileId) return null;
  return { apiKey, verifyProfileId };
}

/** True once the Telnyx Verify credentials are set, so the routes can use it instead of the dev fallback. */
export function telnyxVerifyConfigured(): boolean {
  return !!cfg();
}

/** Normalizes a number to E.164 (+<country><number>); a bare 10-digit number defaults to US (+1). */
export function toE164(raw: string): string {
  const cleaned = raw.replace(/[\s()-]/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  const digits = cleaned.replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

async function call(path: string, body: Record<string, unknown>) {
  const c = cfg();
  if (!c) throw new Error("Telnyx Verify is not configured (TELNYX_API_KEY / TELNYX_VERIFY_PROFILE_ID).");
  const res = await fetch(`${TELNYX_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, verify_profile_id: c.verifyProfileId }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep raw text for the error */
  }
  return { ok: res.ok, status: res.status, json: json as { data?: { response_code?: string } } | null, text };
}

/** Sends a fresh OTP over SMS to an E.164 number. Throws if Telnyx rejects the request. */
export async function sendSmsVerification(phoneE164: string): Promise<void> {
  const { ok, status, text } = await call("/verifications/sms", { phone_number: phoneE164 });
  if (!ok) throw new Error(`Telnyx send failed (${status}): ${text.slice(0, 200)}`);
}

/** Checks the code the user entered. Returns true only when Telnyx accepts it. */
export async function checkSmsVerification(phoneE164: string, code: string): Promise<boolean> {
  const { ok, json } = await call(`/verifications/by_phone_number/${encodeURIComponent(phoneE164)}/actions/verify`, { code });
  // Telnyx returns data.response_code = "accepted" | "rejected"; a non-2xx (e.g. expired) is a fail.
  return ok && json?.data?.response_code === "accepted";
}
