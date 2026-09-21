import nodemailer, { Transporter } from "nodemailer";

let transporterPromise: Promise<Transporter> | null = null;

/**
 * Real SMTP delivery via Ethereal (nodemailer's free testing service) — no credentials
 * needed, and every send returns a preview URL where the actual email can be opened. This
 * is a stand-in for a real provider (SendGrid/SES/etc.) until one is configured; see README.
 */
async function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = nodemailer.createTestAccount().then((account) => {
      console.log(`Ethereal test inbox ready: ${account.user}`);
      return nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
    });
  }
  return transporterPromise;
}

export async function sendOtpEmail(to: string, otp: string): Promise<{ previewUrl: string | false }> {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: '"Zara Plays" <no-reply@zaraplays.local>',
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

  return { previewUrl: nodemailer.getTestMessageUrl(info) };
}
