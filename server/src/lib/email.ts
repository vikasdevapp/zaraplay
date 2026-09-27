import crypto from "crypto";
import dns from "dns/promises";
import nodemailer, { Transporter } from "nodemailer";

// Real delivery goes through SMTP (Amazon SES: SES -> SMTP settings -> Create SMTP credentials)
// when SMTP_HOST/SMTP_USER/SMTP_PASS are set. Without them (local dev) mail goes to an Ethereal
// test inbox instead and each send returns a preview URL; nothing reaches a real mailbox.
const smtp = {
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
};
const FROM = process.env.EMAIL_FROM || '"Zara Plays" <no-reply@zaraplays.com>';

export const isEmailConfigured = () => !!(smtp.host && smtp.user && smtp.pass);

let transporterPromise: Promise<Transporter> | null = null;

function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    if (isEmailConfigured()) {
      transporterPromise = Promise.resolve(
        nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.port === 465, // 587 upgrades with STARTTLS
          auth: { user: smtp.user, pass: smtp.pass },
        })
      );
    } else {
      console.warn("[email] SMTP not configured - using an Ethereal test inbox; mail will NOT reach real users.");
      transporterPromise = nodemailer.createTestAccount().then((account) =>
        nodemailer.createTransport({
          host: account.smtp.host,
          port: account.smtp.port,
          secure: account.smtp.secure,
          auth: { user: account.user, pass: account.pass },
        })
      );
    }
    // A failed setup (e.g. Ethereal unreachable) shouldn't be cached forever.
    transporterPromise.catch(() => {
      transporterPromise = null;
    });
  }
  return transporterPromise;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}): Promise<{ previewUrl: string | false }> {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({ from: FROM, ...opts });
  return { previewUrl: isEmailConfigured() ? false : nodemailer.getTestMessageUrl(info) };
}

export async function sendOtpEmail(to: string, otp: string): Promise<{ previewUrl: string | false }> {
  return sendEmail({
    to,
    subject: `Your Zara Plays verification code: ${otp}`,
    text: `Your verification code is ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color:#dc2626;">Zara Plays</h2>
        <p>Your verification code is:</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 6px;">${otp}</p>
        <p style="color:#666; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

// Rejects addresses whose domain can't receive mail at all (typos, made-up domains), before
// an OTP is sent to them. A DNS outage shouldn't block signups, so lookup errors other than
// "no such domain / no records" let the address through.
export async function emailDomainAcceptsMail(email: string): Promise<boolean> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  try {
    const mx = await dns.resolveMx(domain);
    return mx.some((r) => r.exchange && r.exchange !== ".");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return !(code === "ENOTFOUND" || code === "ENODATA" || code === "ENONAME");
  }
}

// Signed per-user unsubscribe links for broadcast emails (no login needed to opt out).
function unsubscribeSignature(userId: string) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`unsubscribe:${userId}`).digest("hex").slice(0, 32);
}

export function unsubscribeToken(userId: string) {
  return `${userId}.${unsubscribeSignature(userId)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [userId, sig] = token.split(".");
  if (!userId || !sig) return null;
  const expected = unsubscribeSignature(userId);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? userId : null;
}
