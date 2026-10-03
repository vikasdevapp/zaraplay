import webpush from "web-push";
import { prisma } from "./prisma";

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@zaraplays.local", publicKey, privateKey);
  configured = true;
  return true;
}

interface PushPayload {
  title: string;
  body: string;
}

async function sendToSubscription(sub: { id: string; endpoint: string; p256dh: string; auth: string }, payload: PushPayload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    // 404/410 means the browser subscription is gone (uninstalled, expired) — clean it up.
    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    }
  }
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!ensureConfigured()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
}

interface NotifyOptions {
  title?: string;
  body: string;
  // In-app path the bell entry opens (e.g. "/games", "/wallet").
  link?: string;
  // GAME | WALLET | SUPPORT | SYSTEM — icon/grouping in the bell menu.
  kind?: string;
}

/**
 * The one call to tell a player something happened: records an in-app notification (the bell
 * menu) and fires the web-push at the same time, so both stay in step. Both are best-effort —
 * a failure here never breaks the action that triggered it.
 */
export async function notifyUser(userId: string, opts: NotifyOptions) {
  const title = opts.title || "Zara Plays";
  await prisma.notification
    .create({ data: { userId, title, body: opts.body, link: opts.link ?? null, kind: opts.kind || "SYSTEM" } })
    .catch(() => {});
  await sendPushToUser(userId, { title, body: opts.body }).catch(() => {});
}

export async function sendPushBroadcast(payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subs = await prisma.pushSubscription.findMany();
  await Promise.all(subs.map((sub) => sendToSubscription(sub, payload)));
  return subs.length;
}

export function isPushConfigured() {
  return ensureConfigured();
}
