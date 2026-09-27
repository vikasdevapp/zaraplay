import { prisma } from "./prisma";
import { sendEmail, unsubscribeToken } from "./email";

// SES caps sends per second (sandbox: 1/s, production starts at 14/s); stay under it.
const RATE_PER_SECOND = Math.max(1, Number(process.env.EMAIL_RATE_PER_SECOND) || 10);
const PROGRESS_EVERY = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function emailBroadcastRecipients() {
  return prisma.user.findMany({
    where: { role: "USER", emailOptOut: false },
    select: { id: true, email: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Sends one broadcast to every opted-in player, in the background (the admin request returns
 * straight away). Progress is written to the BroadcastMessage row as it goes. A server restart
 * mid-run stops it; the counts show how far it got.
 */
export async function runEmailBroadcast(broadcastId: string, subject: string, body: string) {
  const recipients = await emailBroadcastRecipients();
  const baseUrl = (process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");
  const bodyHtml = escapeHtml(body).replace(/\r?\n/g, "<br>");

  let delivered = 0;
  let failed = 0;
  const flush = () => prisma.broadcastMessage.update({ where: { id: broadcastId }, data: { deliveredCount: delivered, failedCount: failed } });

  for (let i = 0; i < recipients.length; i++) {
    const started = Date.now();
    const r = recipients[i];
    const unsubscribeUrl = `${baseUrl}/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(r.id))}`;
    try {
      await sendEmail({
        to: r.email,
        subject,
        text: `Hi ${r.fullName},\n\n${body}\n\n--\nZara Plays\nUnsubscribe: ${unsubscribeUrl}`,
        html: `
          <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color:#111;">
            <h2 style="color:#dc2626;">Zara Plays</h2>
            <p>Hi ${escapeHtml(r.fullName)},</p>
            <p style="line-height:1.5;">${bodyHtml}</p>
            <hr style="border:none; border-top:1px solid #eee; margin:24px 0;">
            <p style="color:#888; font-size:12px;">
              You're receiving this because you have a Zara Plays account.
              <a href="${unsubscribeUrl}" style="color:#888;">Unsubscribe</a>
            </p>
          </div>
        `,
        // One-click unsubscribe, which Gmail and Yahoo require from bulk senders.
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      delivered++;
    } catch (err) {
      failed++;
      console.error(`[broadcast ${broadcastId}] email to ${r.email} failed:`, err);
    }
    if ((i + 1) % PROGRESS_EVERY === 0) await flush().catch(() => {});
    const wait = 1000 / RATE_PER_SECOND - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  await flush();
}
