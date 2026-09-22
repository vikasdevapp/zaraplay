import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return null;
    client = twilio(sid, token);
  }
  return client;
}

/**
 * Sends a real SMS via Twilio when TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER are set. If they
 * aren't configured yet, this falls back to logging the message to the server console.
 */
export async function sendSms(to: string, body: string): Promise<{ delivered: boolean }> {
  const from = process.env.TWILIO_FROM_NUMBER;
  const twilioClient = getClient();

  if (!twilioClient || !from) {
    console.log(`[SMS dev fallback] To ${to}: ${body}`);
    return { delivered: false };
  }

  await twilioClient.messages.create({ to, from, body });
  return { delivered: true };
}

export async function sendOtpSms(to: string, otp: string): Promise<{ delivered: boolean; devCode?: string }> {
  const result = await sendSms(to, `Your Zara Plays verification code is ${otp}. It expires in 10 minutes.`);
  return result.delivered ? { delivered: true } : { delivered: false, devCode: otp };
}
